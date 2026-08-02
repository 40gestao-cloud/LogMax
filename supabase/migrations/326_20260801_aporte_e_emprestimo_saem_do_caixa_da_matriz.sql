-- =================================================================
-- LogMax — O dinheiro da holding é finito: aporte e empréstimo saem do caixa
-- =================================================================
-- O buraco que esta migração fecha: até aqui o dinheiro da Matriz nascia do
-- nada. Três sintomas do mesmo problema:
--
--   • APORTE. Era um INSERT direto em `capital_filial`. Nenhuma conta era
--     debitada. Dava pra aportar R$ 1 milhão pra SuperMax tendo registrado
--     R$ 10 de capital social — e o número fechava.
--   • EMPRÉSTIMO. `aprovar_emprestimo` (281) creditava o banco escolhido e
--     gerava as parcelas em `contas_pagar` da filial. A Matriz não era
--     debitada e não ficava com NADA a receber: a filial pagava parcela
--     contra o nada, e o dinheiro emprestado nunca voltava pro caixa.
--   • CAPITAL PRÓPRIO DA MATRIZ (323). Era um número solto. Não estava em
--     conta nenhuma e não limitava nada.
--
-- Enquanto a Matriz não tinha caixa próprio (migr. 325) isso passava batido.
-- Agora que tem, a incoerência fica visível na tela — e o ERP é didático:
-- o aluno precisa ver que aporte e empréstimo são transferência entre duas
-- contas reais, não um número digitado.
--
-- O QUE PASSA A VALER
--
--   1. APORTE vira transferência. `registrar_aporte_capital` exige conta de
--      ORIGEM (da Matriz) e conta de DESTINO (da filial), debita uma, credita
--      a outra e grava a linha de capital — tudo na mesma transação. Não sai
--      o que não há em caixa na origem. Capital próprio da holding é o caso
--      especial: é dinheiro dos SÓCIOS entrando, então não tem origem interna
--      — só destino.
--
--   2. EMPRÉSTIMO vira transferência + par intercompany. Debita a conta da
--      Matriz, credita a da filial, e cada parcela nasce DUAS vezes: conta a
--      pagar da filial (como já era) e conta a RECEBER da Matriz (novo). É o
--      mesmo par que o rateio administrativo (323) já usa. Quando a filial
--      paga, o dinheiro volta pro caixa da holding de verdade.
--
--   3. CAPITAL DA MATRIZ FICA FINITO. `calcular_saldo_capital('Matriz')`
--      passa a descontar do capital próprio o que já foi empurrado pras
--      unidades (aportes concedidos + empréstimos aprovados). Para as três
--      filiais o cálculo continua byte-a-byte o mesmo.
--
--   4. A PORTA DOS FUNDOS FECHA. `capital_filial` perde a policy de INSERT
--      pra `authenticated`: aporte só entra pela RPC, que é quem move o
--      caixa. Sem isso bastava o F12 pra criar capital do nada de novo.
--      E aporte que moveu dinheiro não pode mais ser deletado — deletar a
--      linha não devolveria o saldo pra conta de origem.
--
-- Depende da 325 (caixa da Matriz existe e é da própria unidade).
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Colunas de rastro — de qual conta saiu, pra qual conta entrou
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.capital_filial
  ADD COLUMN IF NOT EXISTS banco_origem_id  uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS banco_destino_id uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.capital_filial.banco_origem_id IS
  'Conta da Matriz de onde o aporte saiu (migr. 326). NULL no capital próprio da holding (dinheiro dos sócios, sem origem interna) e nos aportes anteriores à 326.';
COMMENT ON COLUMN public.capital_filial.banco_destino_id IS
  'Conta da unidade onde o aporte entrou (migr. 326). NULL nos aportes anteriores à 326.';

ALTER TABLE public.parcelas_emprestimo
  ADD COLUMN IF NOT EXISTS contas_receber_id uuid REFERENCES public.contas_receber(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.parcelas_emprestimo.contas_receber_id IS
  'Contrapartida da parcela no lado da Matriz (migr. 326). A filial tem a conta a pagar; a holding tem a conta a receber.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. registrar_aporte_capital — aporte é transferência, não digitação
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_aporte_capital(
  p_filial           text,
  p_valor            numeric,
  p_banco_destino_id uuid,
  p_banco_origem_id  uuid DEFAULT NULL,
  p_observacao       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dest_filial  text;
  v_dest_ok      boolean;
  v_orig_filial  text;
  v_orig_saldo   numeric;
  v_orig_nome    text;
  v_id           uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF COALESCE(public.auth_user_role(), '') NOT IN ('admin', 'ceo')
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas admin ou CEO registram capital e aporte.'
      USING ERRCODE = '42501';
  END IF;

  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax', 'MaxLook', 'TechMax', 'Matriz') THEN
    RAISE EXCEPTION 'Unidade inválida: %', COALESCE(p_filial, '(vazio)') USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF p_banco_destino_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de destino: o dinheiro precisa entrar em algum caixa.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Destino: conta da unidade que recebe ──────────────────────────
  SELECT filial, true INTO v_dest_filial, v_dest_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_destino_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT COALESCE(v_dest_ok, false) THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- Conta global/legada (filial NULL) serve a qualquer unidade — ver 325.
  IF v_dest_filial IS NOT NULL AND v_dest_filial <> p_filial THEN
    RAISE EXCEPTION 'A conta de destino é de % e o aporte é pra %.', v_dest_filial, p_filial
      USING ERRCODE = 'P0001';
  END IF;

  IF p_filial = 'Matriz' THEN
    -- Capital próprio da holding: dinheiro dos SÓCIOS entrando. Não sai de
    -- conta nenhuma do grupo, então origem interna aqui seria errado.
    IF p_banco_origem_id IS NOT NULL THEN
      RAISE EXCEPTION 'Capital próprio da holding não sai de outra conta do grupo — é aporte dos sócios.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- ── Origem: conta da Matriz, com saldo suficiente ───────────────
    IF p_banco_origem_id IS NULL THEN
      RAISE EXCEPTION 'Informe a conta da Matriz de onde sai o aporte.' USING ERRCODE = 'P0001';
    END IF;

    SELECT filial, COALESCE(saldo, 0), COALESCE(banco, conta)
      INTO v_orig_filial, v_orig_saldo, v_orig_nome
      FROM public.caixa_bancos
     WHERE id = p_banco_origem_id AND COALESCE(ativo, true)
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_orig_filial, '') <> 'Matriz' THEN
      RAISE EXCEPTION 'O aporte sai do caixa da Matriz. A conta escolhida é de %.',
        COALESCE(v_orig_filial, 'uso global') USING ERRCODE = 'P0001';
    END IF;
    -- Sem to_char com máscara de grupo: o separador vem do lc_numeric do
    -- servidor (en_US), então "1.234,56" sairia como "1,234.56" numa tela
    -- pt-BR. O número cru é menos bonito e não mente.
    IF v_orig_saldo < p_valor THEN
      RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e o aporte é de R$ %.',
        v_orig_nome, round(v_orig_saldo, 2), round(p_valor, 2)
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - p_valor
     WHERE id = p_banco_origem_id;
  END IF;

  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + p_valor
   WHERE id = p_banco_destino_id;

  INSERT INTO public.capital_filial
    (filial, valor, registrado_por, registrado_por_nome, observacao,
     banco_origem_id, banco_destino_id)
  VALUES
    (p_filial, p_valor, auth.uid(),
     (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
     p_observacao, p_banco_origem_id, p_banco_destino_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_aporte_capital(text, numeric, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_aporte_capital(text, numeric, uuid, uuid, text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 3. capital_filial — aporte só entra pela RPC
-- ═══════════════════════════════════════════════════════════════════
-- A policy antiga deixava admin/CEO/conselheiro inserirem direto. Como a RPC
-- é SECURITY DEFINER, ela continua escrevendo; o que some é o atalho que
-- criava capital sem mover caixa nenhum.
--
-- Conferido antes de dropar: a única outra policy de INSERT da tabela é a
-- `zz_desligado_bloqueia_insert`, e ela é RESTRICTIVE. Restrictive não
-- concede nada — sem nenhuma permissive sobrando, `authenticated` fica sem
-- INSERT, que é o objetivo. (Se fosse permissive, dropar a granular abriria
-- a tabela pra qualquer usuário ativo, o oposto do que se quer.)

DROP POLICY IF EXISTS capital_filial_insert ON public.capital_filial;

-- Deletar aporte que moveu dinheiro devolveria o capital mas não o saldo:
-- a conta de origem ficaria debitada pra sempre. Estorno é lançamento novo,
-- não apagar histórico. Linhas antigas (sem banco) seguem deletáveis.
CREATE OR REPLACE FUNCTION public.bloqueia_delete_aporte_com_caixa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.banco_destino_id IS NOT NULL OR OLD.banco_origem_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este aporte movimentou caixa e não pode ser excluído. Registre o lançamento de estorno.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueia_delete_aporte_com_caixa ON public.capital_filial;
CREATE TRIGGER trg_bloqueia_delete_aporte_com_caixa
  BEFORE DELETE ON public.capital_filial
  FOR EACH ROW EXECUTE FUNCTION public.bloqueia_delete_aporte_com_caixa();

-- ═══════════════════════════════════════════════════════════════════
-- 4. aprovar_emprestimo — sai do caixa da Matriz e volta pra ela
-- ═══════════════════════════════════════════════════════════════════
-- Assinatura muda (ganha p_banco_origem_id), então precisa de DROP com a
-- lista de argumentos EXATA da versão vigente (281) — lista errada vira
-- no-op silencioso e deixa duas sobrecargas que o PostgREST recusa.

DROP FUNCTION IF EXISTS public.aprovar_emprestimo(uuid, uuid, text, numeric, integer, text);

CREATE FUNCTION public.aprovar_emprestimo(
  p_emprestimo_id       uuid,
  p_banco_id            uuid,
  p_banco_nome          text,
  p_taxa_juros          numeric,
  p_num_parcelas        integer,
  p_justificativa_resp  text,
  p_banco_origem_id     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_emp        RECORD;
  v_valor_par  numeric;
  v_valor_tot  numeric;
  v_valor_this numeric;
  v_soma_par   numeric := 0;
  i            int;
  v_venc       date;
  v_cp_id      uuid;
  v_cr_id      uuid;
  v_dest_filial text;
  v_dest_ok    boolean;
  v_orig_filial text;
  v_orig_saldo numeric;
  v_orig_nome  text;
  v_desc       text;
BEGIN
  PERFORM public._assert_capital_holding();

  SELECT * INTO v_emp FROM public.emprestimos_filial
   WHERE id = p_emprestimo_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empréstimo não encontrado'; END IF;
  IF v_emp.status <> 'Pendente' THEN RAISE EXCEPTION 'Empréstimo já processado'; END IF;

  -- Segregação: quem pediu não decide.
  PERFORM public._assert_nao_e_o_solicitante(v_emp.solicitado_por);

  -- ── Destino: conta da filial que pediu ────────────────────────────
  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de % que recebe o valor.', v_emp.filial USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, true INTO v_dest_filial, v_dest_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT COALESCE(v_dest_ok, false) THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_dest_filial IS NOT NULL AND v_dest_filial <> v_emp.filial THEN
    RAISE EXCEPTION 'A conta de destino é de % e o empréstimo é pra %.', v_dest_filial, v_emp.filial
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Origem: caixa da Matriz, com saldo (migr. 326) ────────────────
  IF p_banco_origem_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta da Matriz de onde sai o empréstimo.' USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, COALESCE(saldo, 0), COALESCE(banco, conta)
    INTO v_orig_filial, v_orig_saldo, v_orig_nome
    FROM public.caixa_bancos
   WHERE id = p_banco_origem_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_orig_filial, '') <> 'Matriz' THEN
    RAISE EXCEPTION 'O empréstimo sai do caixa da Matriz. A conta escolhida é de %.',
      COALESCE(v_orig_filial, 'uso global') USING ERRCODE = 'P0001';
  END IF;
  IF v_orig_saldo < v_emp.valor THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e o empréstimo é de R$ %.',
      v_orig_nome, round(v_orig_saldo, 2), round(v_emp.valor, 2)
      USING ERRCODE = 'P0001';
  END IF;

  v_valor_tot := ROUND(v_emp.valor * (1 + p_taxa_juros / 100), 2);
  v_valor_par := ROUND(v_valor_tot / p_num_parcelas, 2);

  UPDATE public.emprestimos_filial SET
    status                 = 'Aprovado',
    banco_id               = p_banco_id,
    banco_nome             = p_banco_nome,
    taxa_juros             = p_taxa_juros,
    num_parcelas           = p_num_parcelas,
    aprovado_por           = auth.uid(),
    aprovado_por_nome      = (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
    justificativa_resposta = p_justificativa_resp
  WHERE id = p_emprestimo_id;

  -- Transferência do principal (sem juros): sai da Matriz, entra na filial.
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) - v_emp.valor
   WHERE id = p_banco_origem_id;
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + v_emp.valor
   WHERE id = p_banco_id;

  -- Parcelas: conta a pagar da filial + conta a receber da Matriz.
  FOR i IN 1..p_num_parcelas LOOP
    v_venc := public.acre_today() + ((i) * interval '1 month');

    -- #5: última parcela absorve diferença de arredondamento
    IF i = p_num_parcelas THEN
      v_valor_this := v_valor_tot - v_soma_par;
    ELSE
      v_valor_this := v_valor_par;
      v_soma_par := v_soma_par + v_valor_par;
    END IF;

    v_desc := 'Parcela ' || i || '/' || p_num_parcelas || ' — Empréstimo ' || COALESCE(p_banco_nome, 'Banco');

    INSERT INTO public.contas_pagar (descricao, valor, vencimento, status, filial, origem)
    VALUES (v_desc, v_valor_this, v_venc, 'Pendente', v_emp.filial, 'emprestimo')
    RETURNING id INTO v_cp_id;

    -- Contrapartida na holding: sem ela a filial pagava a parcela pro nada e
    -- o principal emprestado nunca voltava pro caixa da Matriz.
    INSERT INTO public.contas_receber (descricao, valor, vencimento, status, filial, origem)
    VALUES (
      'Parcela ' || i || '/' || p_num_parcelas || ' — Empréstimo a ' || v_emp.filial,
      v_valor_this, v_venc, 'Aberto', 'Matriz', 'emprestimo'
    )
    RETURNING id INTO v_cr_id;

    INSERT INTO public.parcelas_emprestimo
      (emprestimo_id, num_parcela, valor_parcela, data_vencimento, contas_pagar_id, contas_receber_id)
    VALUES
      (p_emprestimo_id, i, v_valor_this, v_venc, v_cp_id, v_cr_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_emprestimo(uuid, uuid, text, numeric, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_emprestimo(uuid, uuid, text, numeric, integer, text, uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 5. calcular_saldo_capital — o capital da Matriz encolhe quando ela financia
-- ═══════════════════════════════════════════════════════════════════
-- Só o ramo 'Matriz' muda. Para SuperMax/MaxLook/TechMax o resultado continua
-- idêntico, inclusive na DRE.
--
-- Leitura pra Matriz: `capital_total` = capital próprio dos sócios MENOS o
-- que já foi empurrado pras unidades (aporte concedido + empréstimo aprovado).
-- É o "quanto da holding ainda é da holding". Aporte não volta; empréstimo
-- volta como receita quando a filial paga a parcela — e aí entra em
-- `receitas`, pelas contas a receber criadas no item 4.

CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(p_filial text)
-- Nomes das colunas de saída são os da versão vigente: CREATE OR REPLACE
-- recusa qualquer renomeação de parâmetro de saída.
RETURNS TABLE (
  capital_total         numeric,
  despesas_pagas        numeric,
  despesas_operacionais numeric,
  despesas_financeiras  numeric,
  receitas_pagas        numeric,
  lucro_operacional     numeric,
  lucro_liquido         numeric,
  reserva_valor         numeric,
  reserva_pct           numeric,
  saldo_livre           numeric,
  saldo_real            numeric,
  bloqueado             boolean,
  em_reserva            boolean,
  data_inicio           date,
  data_fim              date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg         RECORD;
  v_capital     numeric := 0;
  v_emprest     numeric := 0;
  v_saida_hold  numeric := 0;
  v_aporte_out  numeric := 0;
  v_emp_out     numeric := 0;
  v_emp_back    numeric := 0;
  v_desp_op     numeric := 0;
  v_desp_fin    numeric := 0;
  v_receitas    numeric := 0;
  v_reserva_pct numeric := 0;
  v_reserva_val numeric := 0;
  v_saldo_real  numeric := 0;
  v_saldo_livre numeric := 0;
  v_desp_total  numeric := 0;
  v_lucro_op    numeric := 0;
  v_lucro_liq   numeric := 0;
BEGIN
  PERFORM public._assert_rpc();
  SELECT * INTO v_cfg FROM public.capital_config
   ORDER BY created_at DESC LIMIT 1;

  SELECT COALESCE(SUM(valor), 0) INTO v_capital
    FROM public.capital_filial
   WHERE filial = p_filial
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(valor), 0) INTO v_emprest
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND status = 'Aprovado'
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Saída da holding: só existe pra 'Matriz'. `emprestimos_filial` é sempre
  -- de unidade operacional (o CHECK não aceita 'Matriz'), então somar tudo
  -- aqui é somar o que a Matriz concedeu.
  --
  -- Aporte é definitivo: sai e não volta. Empréstimo VOLTA — e é por isso que
  -- a conta desconta `concedido - devolvido`, não só o concedido. Com o
  -- desconto cru, emprestar derrubava o capital da holding pra sempre: a
  -- filial pagava as 12 parcelas e o número da Matriz continuava lá embaixo,
  -- como se o dinheiro tivesse evaporado.
  --
  -- Não há clamp em zero de propósito: quando a filial termina de pagar,
  -- `devolvido` passa de `concedido` exatamente pelo valor dos juros, o termo
  -- fica negativo e o capital da holding sobe. É o lucro da operação de
  -- crédito aparecendo onde deve.
  IF p_filial = 'Matriz' THEN
    SELECT COALESCE(SUM(cf.valor), 0) INTO v_aporte_out
      FROM public.capital_filial cf
     WHERE cf.filial <> 'Matriz'
       AND (v_cfg IS NULL OR cf.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cf.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    SELECT COALESCE(SUM(e.valor), 0) INTO v_emp_out
      FROM public.emprestimos_filial e
     WHERE e.status = 'Aprovado'
       AND (v_cfg IS NULL OR e.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR e.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    SELECT COALESCE(SUM(cr.valor), 0) INTO v_emp_back
      FROM public.contas_receber cr
     WHERE cr.filial = 'Matriz' AND cr.origem = 'emprestimo'
       AND cr.status IN ('Pago', 'Recebido')
       AND COALESCE(cr.ativo, true) = true
       AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    v_saida_hold := v_aporte_out + v_emp_out - v_emp_back;
  END IF;

  SELECT COALESCE(SUM(cp.valor), 0) INTO v_desp_op
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status = 'Pago'
     AND COALESCE(cp.ativo, true) = true
     AND COALESCE(cp.origem, '') <> 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(cp.valor), 0) INTO v_desp_fin
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status = 'Pago'
     AND COALESCE(cp.ativo, true) = true
     AND cp.origem = 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Parcela de empréstimo que volta pra Matriz NÃO é receita: é devolução do
  -- principal, e já entra acima em `v_emp_back` recompondo o capital. Contar
  -- nos dois lugares faria a holding parecer lucrativa por ter emprestado o
  -- próprio dinheiro. O espelho disso já existe do lado da filial, onde a
  -- parcela cai em `despesas_financeiras` e não nas operacionais.
  --
  -- Efeito colateral aceito: o juros do empréstimo aparece como capital a
  -- mais na holding (v_emp_back supera v_emp_out no fim), não como receita
  -- na DRE. Separar principal de juros exigiria guardar os dois por parcela.
  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial
     AND cr.status IN ('Pago', 'Recebido')     -- frontend grava 'Pago'
     AND COALESCE(cr.ativo, true) = true
     AND NOT (p_filial = 'Matriz' AND COALESCE(cr.origem, '') = 'emprestimo')
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  v_capital     := v_capital - v_saida_hold;   -- zero fora da Matriz
  v_desp_total  := v_desp_op + v_desp_fin;
  v_reserva_pct := COALESCE(v_cfg.reserva_min_pct, 0);
  v_reserva_val := ROUND((v_capital + v_emprest) * v_reserva_pct / 100, 2);
  v_saldo_real  := (v_capital + v_emprest) - v_desp_total;
  v_saldo_livre := v_saldo_real - v_reserva_val;
  v_lucro_op    := v_receitas - v_desp_op;
  v_lucro_liq   := v_lucro_op - v_desp_fin - v_reserva_val;

  RETURN QUERY SELECT
    (v_capital + v_emprest),
    v_desp_total,
    v_desp_op,
    v_desp_fin,
    v_receitas,
    v_lucro_op,
    v_lucro_liq,
    v_reserva_val,
    v_reserva_pct,
    v_saldo_livre,
    v_saldo_real,
    (v_saldo_real < 0),
    (v_saldo_livre <= 0 AND v_saldo_real >= 0),
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_inicio ELSE public.acre_today() END,
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_fim ELSE NULL END;
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_saldo_capital(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_saldo_capital(text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
