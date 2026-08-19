-- 474 — Os dois caminhos que faltavam entre a Matriz e as filiais.
--
-- A migr. 473 consertou o mútuo: taxa ao mês, Price, juro separado do
-- principal. Faltavam duas pontas, e elas são simétricas.
--
-- ─── 1. A MATRIZ NÃO PODIA APLICAR — SÓ RESPONDER ──────────────────────────
--
-- O empréstimo nascia de uma solicitação da filial (`solicitado_por`) e a
-- Matriz aprovava. Mas o movimento real do professor é o contrário: ele decide
-- aplicar R$ 50.000 numa unidade. Para isso, o único instrumento que a holding
-- originava era o aporte — que por definição não rende.
--
-- `conceder_mutuo_capital` cria o empréstimo já decidido e chama a mesma
-- `aprovar_emprestimo` que a via da solicitação usa. Uma conta só, um caminho
-- só: se a Price mudar, muda nos dois.
--
-- Segregação de funções: `_assert_nao_e_o_solicitante` já tolera solicitante
-- NULL, e é assim que o mútuo originado entra — não houve solicitante, então
-- não há de quem separar. Isso não abre porta nova: `registrar_aporte_capital`
-- (migr. 326) já move dinheiro da Matriz por decisão de um só admin/CEO, e o
-- mútuo é a versão MENOS arriscada disso, porque volta.
--
-- A filial é notificada. Receber dívida que não pediu, com parcela vencendo em
-- 30 dias, não pode ser descoberto por acaso na tela de Contas a Pagar.
--
-- ─── 2. O APORTE NÃO TINHA RETORNO NENHUM ──────────────────────────────────
--
-- Aporte é dinheiro de sócio: entra no patrimônio e não rende juros. Mas o
-- sócio não aplica por caridade — o retorno dele é DISTRIBUIÇÃO DE LUCRO. Sem
-- isso o aluno aprendia metade da história: que dívida custa, mas não que
-- capital cobra.
--
-- `distribuir_lucro_filial` move dinheiro da filial para a Matriz com três
-- travas que são o conteúdo da aula:
--
--   · não se distribui o que não se lucrou — o teto é o lucro líquido apurado
--     pelo próprio `calcular_saldo_capital`, menos o que já foi distribuído;
--   · o lucro líquido já vem descontado da reserva mínima, então a reserva
--     deixa de ser um número decorativo e passa a limitar de fato o quanto sai;
--   · o caixa de origem precisa ter o dinheiro. Lucro é resultado, não saldo:
--     dá para ter lucro no papel e não ter como pagar.
--
-- Distribuir NÃO é despesa da filial — é resultado saindo, e por isso reduz o
-- saldo sem tocar no lucro (mesma regra da amortização na 473). Do lado da
-- Matriz é receita, não capital que retorna: capital que retorna é o principal
-- do mútuo.
--
-- ─── O QUE CONTINUA FORA ───────────────────────────────────────────────────
--
-- IOF, preço de transferência, JCP e imposto sobre lucro distribuído. Ambiente
-- didático — a mecânica importa, a apuração fiscal não.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. `brl()` — dinheiro escrito como brasileiro escreve
--
-- O banco roda com `lc_numeric = en_US.UTF-8`, então `to_char(1045.32,
-- 'FM999G999G990D00')` devolve "1,045.32". Toda mensagem de RPC que fala de
-- dinheiro estava saindo em formato inglês — inclusive a descrição da parcela
-- que o aluno lê em Contas a Pagar todo mês, num curso onde escrever certo é
-- parte do conteúdo.
--
-- Trocar o `lc_numeric` do cluster mexeria em ordenação e parsing de tudo. O
-- caminho barato é inverter os separadores na saída.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.brl(p_valor numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT translate(to_char(COALESCE(p_valor, 0), 'FM999G999G999G990D00'), ',.', '.,');
$function$;

COMMENT ON FUNCTION public.brl(numeric) IS
  'Migr. 474 — formata dinheiro em pt-BR (1.045,32). O cluster roda em lc_numeric en_US, então to_char sozinho sai em formato inglês.';

GRANT EXECUTE ON FUNCTION public.brl(numeric) TO authenticated, anon;

-- A descrição da parcela nasceu na migr. 473 com `to_char` cru e por isso saía
-- "juros R$ 1,045.32". Redeclarada aqui só para passar pelo `brl()` — é o
-- texto que o aluno lê em Contas a Pagar toda vez que a parcela vence.

CREATE OR REPLACE FUNCTION public.aprovar_emprestimo(
  p_emprestimo_id     uuid,
  p_banco_id          uuid,
  p_banco_nome        text,
  p_taxa_juros        numeric,
  p_num_parcelas      integer,
  p_justificativa_resp text,
  p_banco_origem_id   uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_emp        RECORD;
  v_i          numeric;
  v_fator      numeric;
  v_parcela    numeric;
  v_saldo      numeric;
  v_juros      numeric;
  v_amort      numeric;
  v_valor_this numeric;
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

  PERFORM public._assert_nao_e_o_solicitante(v_emp.solicitado_por);

  IF COALESCE(p_num_parcelas, 0) < 1 THEN
    RAISE EXCEPTION 'O empréstimo precisa de ao menos 1 parcela.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_taxa_juros, 0) < 0 THEN
    RAISE EXCEPTION 'Taxa de juros não pode ser negativa.' USING ERRCODE = 'P0001';
  END IF;

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
      v_orig_nome, public.brl(v_orig_saldo), public.brl(v_emp.valor)
      USING ERRCODE = 'P0001';
  END IF;

  -- Tabela Price. `p_taxa_juros` é % AO MÊS (migr. 473).
  v_i := COALESCE(p_taxa_juros, 0) / 100;

  IF v_i = 0 THEN
    v_parcela := ROUND(v_emp.valor / p_num_parcelas, 2);
  ELSE
    v_fator   := power(1 + v_i, p_num_parcelas::numeric);
    v_parcela := ROUND(v_emp.valor * v_i * v_fator / (v_fator - 1), 2);
  END IF;

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

  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) - v_emp.valor
   WHERE id = p_banco_origem_id;
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + v_emp.valor
   WHERE id = p_banco_id;

  v_saldo := v_emp.valor;

  FOR i IN 1..p_num_parcelas LOOP
    v_venc  := public.acre_today() + ((i) * interval '1 month');
    v_juros := ROUND(v_saldo * v_i, 2);

    IF i = p_num_parcelas THEN
      v_amort      := ROUND(v_saldo, 2);
      v_valor_this := ROUND(v_amort + v_juros, 2);
    ELSE
      v_amort      := ROUND(v_parcela - v_juros, 2);
      v_valor_this := v_parcela;
    END IF;

    v_saldo := ROUND(v_saldo - v_amort, 2);

    v_desc := 'Parcela ' || i || '/' || p_num_parcelas
           || ' — Empréstimo ' || COALESCE(p_banco_nome, 'Banco')
           || CASE WHEN v_juros > 0
                   THEN ' · juros R$ ' || public.brl(v_juros)
                   ELSE '' END;

    INSERT INTO public.contas_pagar (descricao, valor, vencimento, status, filial, origem)
    VALUES (v_desc, v_valor_this, v_venc, 'Pendente', v_emp.filial, 'emprestimo')
    RETURNING id INTO v_cp_id;

    INSERT INTO public.contas_receber (descricao, valor, vencimento, status, filial, origem)
    VALUES (
      'Parcela ' || i || '/' || p_num_parcelas || ' — Empréstimo a ' || v_emp.filial,
      v_valor_this, v_venc, 'Aberto', 'Matriz', 'emprestimo'
    )
    RETURNING id INTO v_cr_id;

    INSERT INTO public.parcelas_emprestimo
      (emprestimo_id, num_parcela, valor_parcela, data_vencimento,
       contas_pagar_id, contas_receber_id, juros, amortizacao, saldo_devedor)
    VALUES
      (p_emprestimo_id, i, v_valor_this, v_venc,
       v_cp_id, v_cr_id, v_juros, v_amort, v_saldo);
  END LOOP;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A Matriz aplica capital por decisão dela
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.conceder_mutuo_capital(
  p_filial           text,
  p_valor            numeric,
  p_taxa_juros       numeric,
  p_num_parcelas     integer,
  p_banco_origem_id  uuid,
  p_banco_destino_id uuid,
  p_observacao       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id         uuid;
  v_nome_dest  text;
  v_just       text;
  v_quem       text;
BEGIN
  PERFORM public._assert_capital_holding();

  IF p_filial NOT IN ('SuperMax', 'MaxLook', 'TechMax') THEN
    RAISE EXCEPTION 'A aplicação de capital é para uma unidade operacional, não para %.', p_filial
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor a aplicar.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_num_parcelas, 0) < 1 OR p_num_parcelas > 60 THEN
    RAISE EXCEPTION 'O prazo vai de 1 a 60 parcelas.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(banco, '') || ' — ' || COALESCE(conta, '')
    INTO v_nome_dest
    FROM public.caixa_bancos WHERE id = p_banco_destino_id;

  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');

  -- `justificativa` é NOT NULL na tabela e, na via da solicitação, é a filial
  -- dizendo por que precisa. Aqui é a Matriz dizendo por que aplicou — quem
  -- lê o histórico depois precisa distinguir os dois casos sem adivinhar.
  v_just := 'Aplicação de capital decidida pela Matriz'
         || COALESCE(' — ' || NULLIF(btrim(p_observacao), ''), '');

  INSERT INTO public.emprestimos_filial
    (filial, valor, num_parcelas, taxa_juros, justificativa, status,
     solicitado_por, solicitado_por_nome)
  VALUES
    -- solicitado_por NULL de propósito: não houve solicitante. É o que faz
    -- `_assert_nao_e_o_solicitante` deixar passar, e é o registro honesto de
    -- que a iniciativa foi da holding.
    (p_filial, p_valor, p_num_parcelas, COALESCE(p_taxa_juros, 0), v_just, 'Pendente',
     NULL, v_quem || ' (Matriz)')
  RETURNING id INTO v_id;

  -- Uma conta só para os dois caminhos: quem aprova pedido e quem aplica por
  -- decisão própria passam pela mesma Price da migr. 473.
  PERFORM public.aprovar_emprestimo(
    v_id, p_banco_destino_id, v_nome_dest, COALESCE(p_taxa_juros, 0),
    p_num_parcelas, 'Aplicação de capital da Matriz', p_banco_origem_id);

  PERFORM public.notificar_setor(
    p_setor     => 'financeiro',
    p_tipo      => 'info',
    p_titulo    => 'A Matriz aplicou capital na sua unidade',
    p_mensagem  => 'R$ ' || public.brl(p_valor) || ' a ' ||
                   translate(to_char(COALESCE(p_taxa_juros, 0), 'FM990D00'), '.', ',') || '% ao mês em ' ||
                   p_num_parcelas || 'x. As parcelas já estão em Contas a Pagar.',
    p_link_view => 'financeiro-capital',
    p_urgencia  => 'Alta',
    p_ref_id    => v_id,
    p_filial    => p_filial);

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.conceder_mutuo_capital(text, numeric, numeric, integer, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conceder_mutuo_capital(text, numeric, numeric, integer, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.conceder_mutuo_capital(text, numeric, numeric, integer, uuid, uuid, text) IS
  'Migr. 474 — a Matriz aplica capital numa filial por decisão própria: cria o empréstimo já decidido e delega a Price a aprovar_emprestimo. Só admin/CEO.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Distribuição de lucro — o retorno do aporte
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.distribuicoes_lucro (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial            text NOT NULL CHECK (filial IN ('SuperMax', 'MaxLook', 'TechMax')),
  valor             numeric(15,2) NOT NULL CHECK (valor > 0),
  -- Quanto havia de lucro disponível quando a decisão foi tomada. Guardado
  -- porque o lucro se move: sem o carimbo, ninguém consegue mais responder
  -- "distribuiu quanto do que tinha?".
  base_lucro        numeric(15,2),
  banco_origem_id   uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  banco_destino_id  uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  decidido_por      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decidido_por_nome text,
  observacao        text,
  ativo             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.distribuicoes_lucro IS
  'Migr. 474 — lucro da filial distribuído para a Matriz. É o retorno do aporte, que não rende juros. Escrita só pela RPC distribuir_lucro_filial.';

ALTER TABLE public.distribuicoes_lucro ENABLE ROW LEVEL SECURITY;

-- Só leitura, e sem policy de escrita de propósito: quem move dinheiro é a
-- RPC. Mesma régua do aporte desde a migr. 326 — INSERT direto conseguiria
-- registrar distribuição sem tirar o dinheiro de lugar nenhum.
DROP POLICY IF EXISTS distribuicoes_lucro_select ON public.distribuicoes_lucro;
CREATE POLICY distribuicoes_lucro_select ON public.distribuicoes_lucro
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin', 'ceo', 'conselheiro')
           OR (p.role = 'gerente' AND p.is_conselheiro = true)
           OR (p.filial = distribuicoes_lucro.filial AND p.role = 'gerente')
           OR (p.filial = distribuicoes_lucro.filial
               AND (p.setor = 'financeiro' OR 'financeiro' = ANY (p.setores_extras)))
         )
    )
  );

GRANT SELECT ON public.distribuicoes_lucro TO authenticated;

CREATE INDEX IF NOT EXISTS idx_distribuicoes_lucro_filial
  ON public.distribuicoes_lucro (filial, created_at DESC);

CREATE OR REPLACE FUNCTION public.distribuir_lucro_filial(
  p_filial           text,
  p_valor            numeric,
  p_banco_origem_id  uuid,
  p_banco_destino_id uuid,
  p_observacao       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id           uuid;
  v_saldo_filial RECORD;
  v_ja           numeric := 0;
  v_disponivel   numeric := 0;
  v_orig_filial  text;
  v_orig_saldo   numeric;
  v_orig_nome    text;
  v_dest_filial  text;
  v_cfg          RECORD;
BEGIN
  PERFORM public._assert_capital_holding();

  IF p_filial NOT IN ('SuperMax', 'MaxLook', 'TechMax') THEN
    RAISE EXCEPTION 'Quem distribui lucro é a unidade operacional, não %.', p_filial
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor a distribuir.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cfg FROM public.capital_config ORDER BY created_at DESC LIMIT 1;

  -- ── Teto: o lucro apurado, menos o que já saiu ────────────────────────────
  SELECT * INTO v_saldo_filial FROM public.calcular_saldo_capital(p_filial);

  SELECT COALESCE(SUM(d.valor), 0) INTO v_ja
    FROM public.distribuicoes_lucro d
   WHERE d.filial = p_filial AND d.ativo = true
     AND (v_cfg IS NULL OR d.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL
          OR d.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  v_disponivel := ROUND(COALESCE(v_saldo_filial.lucro_liquido, 0) - v_ja, 2);

  IF v_disponivel <= 0 THEN
    RAISE EXCEPTION 'Não há lucro a distribuir em %: o resultado disponível é R$ %.',
      p_filial, public.brl(v_disponivel) USING ERRCODE = 'P0001';
  END IF;
  IF p_valor > v_disponivel THEN
    RAISE EXCEPTION 'Distribuição de R$ % acima do lucro disponível de % (R$ %). Lucro já distribuído no período: R$ %.',
      public.brl(p_valor), p_filial,
      public.brl(v_disponivel), public.brl(v_ja)
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Origem: caixa da filial, com dinheiro de verdade ──────────────────────
  -- Lucro é resultado, não saldo. Dá para ter lucro no papel e não ter como
  -- pagar — e essa é justamente a lição que a trava ensina.
  IF p_banco_origem_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de % de onde sai o dinheiro.', p_filial USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, COALESCE(saldo, 0), COALESCE(banco, conta)
    INTO v_orig_filial, v_orig_saldo, v_orig_nome
    FROM public.caixa_bancos
   WHERE id = p_banco_origem_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_orig_filial, '') <> p_filial THEN
    RAISE EXCEPTION 'A conta de origem é de % e a distribuição é de %.',
      COALESCE(v_orig_filial, 'uso global'), p_filial USING ERRCODE = 'P0001';
  END IF;
  IF v_orig_saldo < p_valor THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e a distribuição é de R$ %. Lucro existe, caixa não.',
      v_orig_nome, public.brl(v_orig_saldo), public.brl(p_valor)
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Destino: caixa da Matriz ──────────────────────────────────────────────
  IF p_banco_destino_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta da Matriz que recebe.' USING ERRCODE = 'P0001';
  END IF;
  SELECT filial INTO v_dest_filial
    FROM public.caixa_bancos
   WHERE id = p_banco_destino_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_dest_filial, '') <> 'Matriz' THEN
    RAISE EXCEPTION 'O lucro distribuído vai para o caixa da Matriz. A conta escolhida é de %.',
      COALESCE(v_dest_filial, 'uso global') USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.caixa_bancos SET saldo = COALESCE(saldo, 0) - p_valor
   WHERE id = p_banco_origem_id;
  UPDATE public.caixa_bancos SET saldo = COALESCE(saldo, 0) + p_valor
   WHERE id = p_banco_destino_id;

  INSERT INTO public.distribuicoes_lucro
    (filial, valor, base_lucro, banco_origem_id, banco_destino_id,
     decidido_por, decidido_por_nome, observacao)
  VALUES
    (p_filial, p_valor, v_disponivel, p_banco_origem_id, p_banco_destino_id,
     auth.uid(), (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
     NULLIF(btrim(p_observacao), ''))
  RETURNING id INTO v_id;

  PERFORM public.notificar_setor(
    p_setor     => 'financeiro',
    p_tipo      => 'info',
    p_titulo    => 'Distribuição de lucro para a Matriz',
    p_mensagem  => 'R$ ' || public.brl(p_valor) ||
                   ' do resultado da unidade foram distribuídos à Matriz. ' ||
                   'Não é despesa: é lucro saindo.',
    p_link_view => 'financeiro-capital',
    p_urgencia  => 'Média',
    p_ref_id    => v_id,
    p_filial    => p_filial);

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.distribuir_lucro_filial(text, numeric, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.distribuir_lucro_filial(text, numeric, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.distribuir_lucro_filial(text, numeric, uuid, uuid, text) IS
  'Migr. 474 — distribui lucro da filial para a Matriz. Teto = lucro líquido apurado menos o já distribuído; exige caixa na conta de origem. Só admin/CEO.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. `calcular_saldo_capital` — o lucro que saiu não volta a ser distribuível
--
-- Corpo da 473 com dois termos novos: `v_distribuido` (filial) e
-- `v_dividendo_in` (Matriz).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(p_filial text)
RETURNS TABLE (
  capital_total          numeric,
  despesas_pagas         numeric,
  despesas_operacionais  numeric,
  despesas_financeiras   numeric,
  receitas_pagas         numeric,
  lucro_operacional      numeric,
  lucro_liquido          numeric,
  reserva_valor          numeric,
  reserva_pct            numeric,
  saldo_livre            numeric,
  saldo_real             numeric,
  bloqueado              boolean,
  em_reserva             boolean,
  data_inicio            date,
  data_fim               date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cfg          RECORD;
  v_capital      numeric := 0;
  v_emprest      numeric := 0;
  v_saida_hold   numeric := 0;
  v_aporte_out   numeric := 0;
  v_emp_out      numeric := 0;
  v_emp_back     numeric := 0;
  v_juros_in     numeric := 0;
  v_dividendo_in numeric := 0;
  v_desp_op      numeric := 0;
  v_juros_pago   numeric := 0;
  v_amort_paga   numeric := 0;
  v_distribuido  numeric := 0;
  v_receitas     numeric := 0;
  v_reserva_pct  numeric := 0;
  v_reserva_val  numeric := 0;
  v_saldo_real   numeric := 0;
  v_saldo_livre  numeric := 0;
  v_desp_total   numeric := 0;
  v_lucro_op     numeric := 0;
  v_lucro_liq    numeric := 0;
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

  -- Saída da holding: aporte é definitivo, empréstimo volta. O que volta é o
  -- PRINCIPAL (migr. 473) — o juro é receita, e o dividendo também.
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

    SELECT COALESCE(SUM(COALESCE(pe.amortizacao, cr.valor)), 0),
           COALESCE(SUM(COALESCE(pe.juros, 0)), 0)
      INTO v_emp_back, v_juros_in
      FROM public.contas_receber cr
      LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_receber_id = cr.id
     WHERE cr.filial = 'Matriz' AND cr.origem = 'emprestimo'
       AND cr.status IN ('Pago', 'Recebido')
       AND COALESCE(cr.ativo, true) = true
       AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    -- Dividendo recebido é RECEITA da holding, não capital que retorna. O que
    -- retorna como capital é só o principal do mútuo: o aporte, esse, saiu e
    -- não volta — o que volta dele é o resultado que ele ajudou a gerar.
    SELECT COALESCE(SUM(d.valor), 0) INTO v_dividendo_in
      FROM public.distribuicoes_lucro d
     WHERE d.ativo = true
       AND (v_cfg IS NULL OR d.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR d.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    v_saida_hold := v_aporte_out + v_emp_out - v_emp_back;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN cp.status = 'Pago' THEN cp.valor ELSE COALESCE(cp.valor_pago, 0) END), 0) INTO v_desp_op
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND COALESCE(cp.origem, '') <> 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Parcela paga, separada em juro e principal (migr. 473).
  SELECT COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.juros, 0)
                ELSE ROUND(COALESCE(pe.juros, 0)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0),
         COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.amortizacao, cp.valor)
                ELSE ROUND(COALESCE(pe.amortizacao, cp.valor)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0)
    INTO v_juros_pago, v_amort_paga
    FROM public.contas_pagar cp
    LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_pagar_id = cp.id
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND cp.origem = 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Lucro que a unidade já mandou para a Matriz (migr. 474). Sai do caixa, mas
  -- NÃO do lucro: descontar dos dois seria punir a filial duas vezes pelo
  -- mesmo resultado. O controle de não distribuir de novo é a própria
  -- `distribuir_lucro_filial`, que soma o já distribuído antes de liberar.
  SELECT COALESCE(SUM(d.valor), 0) INTO v_distribuido
    FROM public.distribuicoes_lucro d
   WHERE d.filial = p_filial AND d.ativo = true
     AND (v_cfg IS NULL OR d.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR d.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial
     AND cr.status IN ('Pago', 'Recebido')
     AND COALESCE(cr.ativo, true) = true
     AND NOT (p_filial = 'Matriz' AND COALESCE(cr.origem, '') = 'emprestimo')
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- O retorno dos dois instrumentos da holding aparece no lucro dela: juro do
  -- mútuo e dividendo do capital.
  v_receitas    := v_receitas + v_juros_in + v_dividendo_in;

  v_capital     := v_capital - v_saida_hold;   -- zero fora da Matriz
  v_desp_total  := v_desp_op + v_juros_pago + v_amort_paga;
  v_reserva_pct := COALESCE(v_cfg.reserva_min_pct, 0);
  v_reserva_val := ROUND((v_capital + v_emprest) * v_reserva_pct / 100, 2);
  -- Distribuição entra aqui e não em `v_desp_total`: no painel aquele número
  -- se chama "despesas pagas", e lucro distribuído não é despesa nenhuma.
  v_saldo_real  := (v_capital + v_emprest) - v_desp_total - v_distribuido;
  v_saldo_livre := v_saldo_real - v_reserva_val;
  v_lucro_op    := v_receitas - v_desp_op;
  v_lucro_liq   := v_lucro_op - v_juros_pago - v_reserva_val;

  RETURN QUERY SELECT
    (v_capital + v_emprest),
    v_desp_total,
    v_desp_op,
    v_juros_pago,
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
$function$;

COMMIT;

-- Verificação:
--
--   -- A Matriz aplica 50 mil a 2,3% a.m. em 12x (parcela 4.815,52):
--   SELECT conceder_mutuo_capital('SuperMax', 50000, 2.3, 12,
--            '<conta Matriz>', '<conta SuperMax>', 'Reforço de estoque');
--
--   -- Distribuir mais do que o lucro tem que falhar (P0001):
--   SELECT distribuir_lucro_filial('SuperMax', 999999999,
--            '<conta SuperMax>', '<conta Matriz>');
--
--   -- Aluno não pode chamar nenhuma das duas (42501):
--   SELECT conceder_mutuo_capital(...);  -- logado como gerente
