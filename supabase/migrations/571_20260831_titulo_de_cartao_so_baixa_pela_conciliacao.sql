-- Título de cartão só baixa pela conciliação.
--
-- A migr. 570 deu ao Financeiro o caminho certo para receber da adquirente —
-- receita pelo bruto, taxa como despesa. Mas deixou a porta velha aberta: em
-- Financeiro → Contas a Receber o mesmo título aceita baixa avulsa, e por ali
-- entra o valor CHEIO no banco, sem taxa nenhuma. Dois caminhos para o mesmo
-- recebimento, e o errado é o de menos cliques.
--
-- O estrago é silencioso, que é o pior tipo: a conta fica 'Pago', o saldo do
-- banco sobe além do que a adquirente depositou, a despesa da maquininha nunca
-- existe e o título some da fila de conciliação. Ninguém vê erro — vê um saldo
-- que não bate com o extrato, semanas depois, sem pista de onde saiu.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUAL TÍTULO É "DE CARTÃO"
--
-- A pergunta difícil não é a trava: é saber em qual título ela vale. E a
-- resposta tem de vir de dado ESTRUTURADO, nunca de interpretar prosa que o
-- aluno digitou — foi assim que a migr. 562 teve de desfazer a dedução do
-- dinheiro pelo texto da forma de pagamento.
--
-- A marca vira coluna (`exige_conciliacao`), preenchida por gatilho no INSERT,
-- a partir de três fontes, nesta ordem:
--
--   1. `forma_pagamento_id` — o título nasceu de orçamento (migr. 570) e
--      aponta para a linha do cadastro. Exige conciliação quando a forma
--      retém taxa E não é crédito da própria loja:
--          taxa > 0 AND NOT exige_limite_credito
--      Crediário fica de fora com razão: quem financia é a filial, o cliente
--      paga direto no caixa, e a baixa avulsa é o caminho CERTO.
--      Taxa zero também fica de fora — sem taxa, bruto e líquido são o mesmo
--      número e travar seria implicância.
--
--   2. `venda_id` → `vendas.forma_pagamento` IN ('Cartão Crédito',
--      'Cartão Débito'). Não é "ler texto livre": é igualdade exata sobre o
--      MESMO valor que a `criar_venda_pdv` já usa para decidir se parcela a
--      venda. Se esse valor não fosse confiável, o parcelamento do PDV também
--      não seria.
--
--   3. O misto. `pdv_registrar_credito_misto` (migr. 415) insere as parcelas
--      do crédito com o sufixo literal ' (Cartão Crédito no misto)' — string
--      constante no corpo da própria função, e é ela que a idempotência dessa
--      RPC já usa como chave. Mesmo raciocínio do item 2: marcador que o
--      sistema escreveu, não frase que o usuário compôs.
--
-- De quebra, esta migração faz `pdv_registrar_credito_misto` gravar
-- `venda_id` nas parcelas que cria. A coluna nasceu depois dela — o comentário
-- no corpo ainda diz "contas_receber não tem venda_id" — e sem o elo essas
-- parcelas eram as únicas do sistema sem volta para a venda.
--
-- ────────────────────────────────────────────────────────────────────────────
-- COMO A CONCILIAÇÃO PASSA PELA PRÓPRIA TRAVA
--
-- `conciliar_maquininha` chama `baixar_conta_receber` — ou seja, bateria na
-- trava que acabamos de criar. A saída é a do padrão `fn_block_estoque_manual`
-- já usado no projeto: flag de transação `app.conciliando_maquininha` acesa
-- com `set_config(..., is_local => true)` imediatamente antes da baixa e
-- apagada logo depois.
--
-- `is_local` faz a flag morrer no fim da transação, e não existe caminho por
-- onde um cliente PostgREST a acenda sozinho. Afrouxar o guard com
-- `auth_is_admin()` seria pior — ele inclui aluno.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. A marca no título
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS exige_conciliacao boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contas_receber.exige_conciliacao IS
  'true = quem paga é a adquirente, e ela retém taxa. Baixa avulsa recusada; o dinheiro entra por Financeiro → Conciliação da Maquininha. Preenchido pelo gatilho trg_exige_conciliacao.';

CREATE INDEX IF NOT EXISTS idx_contas_receber_exige_conciliacao
  ON public.contas_receber(filial, vencimento) WHERE ativo AND exige_conciliacao;

CREATE OR REPLACE FUNCTION public.fn_conta_receber_exige_conciliacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_taxa   numeric;
  v_credit boolean;
  v_forma  text;
BEGIN
  -- No UPDATE só recalcula se a origem mudou. A marca é do nascimento do
  -- título; recalcular a cada toque faria uma edição de descrição reabrir (ou
  -- fechar) a trava sem ninguém pedir.
  IF TG_OP = 'UPDATE'
     AND NEW.forma_pagamento_id IS NOT DISTINCT FROM OLD.forma_pagamento_id
     AND NEW.venda_id           IS NOT DISTINCT FROM OLD.venda_id THEN
    RETURN NEW;
  END IF;

  NEW.exige_conciliacao := false;

  -- 1) Veio de orçamento: a forma cadastrada responde.
  IF NEW.forma_pagamento_id IS NOT NULL THEN
    SELECT taxa, COALESCE(exige_limite_credito, false)
      INTO v_taxa, v_credit
      FROM public.formas_pagamento
     WHERE id = NEW.forma_pagamento_id;

    NEW.exige_conciliacao := COALESCE(v_taxa, 0) > 0 AND NOT COALESCE(v_credit, false);
    RETURN NEW;
  END IF;

  -- 2) Veio do PDV: a forma da venda, em igualdade exata.
  IF NEW.venda_id IS NOT NULL THEN
    SELECT forma_pagamento INTO v_forma FROM public.vendas WHERE id = NEW.venda_id;
    IF v_forma IN ('Cartão Crédito', 'Cartão Débito') THEN
      NEW.exige_conciliacao := true;
      RETURN NEW;
    END IF;
  END IF;

  -- 3) Parcela de crédito dentro de venda mista (migr. 415). O sufixo é
  --    literal no corpo da RPC que a cria.
  IF NEW.descricao LIKE '%(Cartão Crédito no misto)' THEN
    NEW.exige_conciliacao := true;
  END IF;

  RETURN NEW;
END;
$function$;

-- Ordem alfabética entre gatilhos BEFORE: `trg_auditoria` vem antes e não
-- encosta nesta coluna, então não há disputa (migr. 445).
DROP TRIGGER IF EXISTS trg_exige_conciliacao ON public.contas_receber;
CREATE TRIGGER trg_exige_conciliacao
  BEFORE INSERT OR UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_receber_exige_conciliacao();

-- ── Retroativo ──────────────────────────────────────────────────────────────
-- Só o que ainda está em aberto: título já pago é história, e reescrevê-lo
-- não devolve taxa nenhuma. Quem já baixou avulso continua como está.
UPDATE public.contas_receber cr
   SET exige_conciliacao = true
 WHERE COALESCE(cr.ativo, true)
   AND cr.status NOT IN ('Pago', 'Recebido', 'Cancelado')
   AND NOT cr.exige_conciliacao
   AND (
     EXISTS (SELECT 1 FROM public.formas_pagamento f
              WHERE f.id = cr.forma_pagamento_id
                AND COALESCE(f.taxa, 0) > 0
                AND NOT COALESCE(f.exige_limite_credito, false))
     OR EXISTS (SELECT 1 FROM public.vendas v
                 WHERE v.id = cr.venda_id
                   AND v.forma_pagamento IN ('Cartão Crédito', 'Cartão Débito'))
     OR cr.descricao LIKE '%(Cartão Crédito no misto)'
   );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. A trava na baixa
-- ════════════════════════════════════════════════════════════════════════════
-- Corpo lido do banco com `pg_get_functiondef` antes de editar (migr. 422 +
-- ajustes posteriores). A única mudança é o bloco marcado MIGR 571.

CREATE OR REPLACE FUNCTION public.baixar_conta_receber(p_conta_id uuid, p_banco_id uuid, p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conta        contas_receber;
  v_banco_filial text;
  v_banco_ok     boolean;
  v_calc         jsonb;
  v_saldo        numeric(15,2);
  v_juros        numeric(15,2);
  v_multa        numeric(15,2);
  v_devido       numeric(15,2);
  v_principal    numeric(15,2);
  v_quita        boolean;
  v_recebido_ant numeric(15,2);
BEGIN
  PERFORM public._assert_rpc();

  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária de crédito.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'O valor recebido precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_conta
    FROM public.contas_receber
   WHERE id = p_conta_id AND COALESCE(ativo, true)
     FOR UPDATE;

  IF v_conta.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status IN ('Pago', 'Recebido') THEN
    RAISE EXCEPTION 'Esta conta já está quitada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Conta cancelada não recebe baixa.' USING ERRCODE = 'P0001';
  END IF;

  -- Mesma régua do resto do Financeiro: a filial da conta e quem opera nela.
  -- COALESCE porque auth_pode_filial devolve NULL para quem está sem filial, e
  -- NULL num IF não barra ninguém.
  IF v_conta.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_conta.filial), false) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.auth_in_setor('financeiro') OR public.auth_gerente_da(v_conta.filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial registram baixa de conta.'
      USING ERRCODE = '42501';
  END IF;

  -- ── MIGR 571 ─────────────────────────────────────────────────────────────
  -- Quem paga este título é a adquirente, e ela retém taxa. Baixar por aqui
  -- creditaria o valor cheio no banco e a despesa da maquininha nunca
  -- existiria. A flag é acesa só por `conciliar_maquininha`, com is_local, no
  -- instante da chamada.
  IF COALESCE(v_conta.exige_conciliacao, false)
     AND COALESCE(current_setting('app.conciliando_maquininha', true), '') <> 'true' THEN
    RAISE EXCEPTION
      'Este título é de cartão: quem paga é a adquirente, e ela desconta a taxa. Receba em Financeiro → Conciliação da Maquininha, que credita o líquido e lança a taxa como despesa.'
      USING ERRCODE = 'P0001';
  END IF;

  -- O dinheiro tem de entrar numa conta da mesma unidade (migr. 325).
  SELECT filial, true INTO v_banco_filial, v_banco_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true);

  IF NOT COALESCE(v_banco_ok, false) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_banco_filial IS NOT NULL
     AND v_banco_filial IS DISTINCT FROM COALESCE(v_conta.filial, 'Matriz') THEN
    RAISE EXCEPTION 'O destino escolhido é caixa/banco de % e esta conta é de %. Use uma conta da própria unidade.',
      v_banco_filial, COALESCE(v_conta.filial, 'Matriz') USING ERRCODE = 'P0001';
  END IF;

  -- Saldo + encargos do momento. `calcular_valor_atualizado` já desconta o
  -- principal das baixas anteriores.
  v_calc   := public.calcular_valor_atualizado('receber', p_conta_id);
  v_saldo  := COALESCE((v_calc->>'valor_original')::numeric, 0);
  v_juros  := COALESCE((v_calc->>'juros')::numeric, 0);
  v_multa  := COALESCE((v_calc->>'multa')::numeric, 0);
  v_devido := COALESCE((v_calc->>'total')::numeric, 0);

  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Esta conta não tem saldo em aberto.' USING ERRCODE = 'P0001';
  END IF;

  -- Tolerância de meio centavo: o valor vem de máscara de moeda no front.
  IF p_valor > v_devido + 0.005 THEN
    RAISE EXCEPTION 'Recebido (R$ %) é maior que o devido (R$ %). Para quitar, informe o valor exato.',
      to_char(p_valor,  'FM999G999G990D00'),
      to_char(v_devido, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  v_quita := p_valor >= v_devido - 0.005;

  IF v_quita THEN
    -- Quitação: leva o saldo inteiro e os encargos acumulados.
    v_principal := v_saldo;
  ELSE
    -- Parcial: abate só principal. Ver a simplificação no cabeçalho.
    v_principal := ROUND(p_valor, 2);
    v_juros     := 0;
    v_multa     := 0;
  END IF;

  INSERT INTO public.contas_receber_baixas
    (conta_id, principal, juros, multa, banco_id, filial, criado_por)
  VALUES
    (p_conta_id, v_principal, v_juros, v_multa, p_banco_id,
     COALESCE(v_conta.filial, 'Matriz'), auth.uid());

  -- `valor_pago` acumula TUDO que entrou (principal + encargos) porque é ele
  -- que o trigger de saldo credita no banco.
  SELECT COALESCE(SUM(total), 0) INTO v_recebido_ant
    FROM public.contas_receber_baixas WHERE conta_id = p_conta_id;

  UPDATE public.contas_receber
     SET status     = CASE WHEN v_quita THEN 'Pago' ELSE 'Parcial' END,
         banco_id   = p_banco_id,
         valor_pago = v_recebido_ant,
         juros_pago = COALESCE(juros_pago, 0) + v_juros,
         multa_pago = COALESCE(multa_pago, 0) + v_multa,
         pago_em    = CASE WHEN v_quita THEN public.acre_today() ELSE pago_em END,
         updated_at = now()
   WHERE id = p_conta_id;

  RETURN jsonb_build_object(
    'quitada',        v_quita,
    'principal',      v_principal,
    'juros',          v_juros,
    'multa',          v_multa,
    'recebido_agora', ROUND(v_principal + v_juros + v_multa, 2),
    'recebido_total', v_recebido_ant,
    'saldo_restante', ROUND(GREATEST(v_saldo - v_principal, 0), 2)
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. A conciliação acende a flag
-- ════════════════════════════════════════════════════════════════════════════
-- Igual à migr. 570, com duas linhas a mais em volta da baixa. A janela é a
-- menor possível: acende, chama, apaga.

CREATE OR REPLACE FUNCTION public.conciliar_maquininha(
  p_forma_pagamento_id uuid,
  p_banco_id           uuid,
  p_contas             uuid[],
  p_data_repasse       date DEFAULT NULL,
  p_observacoes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  f              public.formas_pagamento;
  v_filial       text;
  v_banco_filial text;
  v_banco_ok     boolean;
  v_data         date;
  v_conta        public.contas_receber;
  v_calc         jsonb;
  v_devido       numeric(15,2);
  v_bruto        numeric(15,2) := 0;
  v_taxa         numeric(15,2);
  v_liquido      numeric(15,2);
  v_qtd          integer := 0;
  v_lote_id      uuid;
  v_baixa_id     uuid;
  v_cp_id        uuid;
  c              uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF p_forma_pagamento_id IS NULL THEN
    RAISE EXCEPTION 'Escolha a forma de pagamento do repasse.' USING ERRCODE = 'P0001';
  END IF;
  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária em que o repasse caiu.' USING ERRCODE = 'P0001';
  END IF;
  IF p_contas IS NULL OR array_length(p_contas, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um título para conciliar.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO f FROM public.formas_pagamento
   WHERE id = p_forma_pagamento_id AND COALESCE(ativo, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forma de pagamento não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  v_filial := COALESCE(f.filial, 'Matriz');
  v_data   := COALESCE(p_data_repasse, public.acre_today());

  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Forma de pagamento de outra unidade.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(
       public.auth_in_setor('financeiro') OR public.auth_gerente_da(v_filial), false) THEN
    RAISE EXCEPTION 'Só o Financeiro ou o gerente da filial concilia repasse de maquininha.'
      USING ERRCODE = '42501';
  END IF;

  SELECT filial, true INTO v_banco_filial, v_banco_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true);
  IF NOT COALESCE(v_banco_ok, false) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_banco_filial IS NOT NULL AND v_banco_filial IS DISTINCT FROM v_filial THEN
    RAISE EXCEPTION 'O destino escolhido é caixa/banco de % e o repasse é de %.',
      v_banco_filial, v_filial USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conciliacoes_maquininha (
    filial, forma_pagamento_id, forma_pagamento, banco_id, data_repasse,
    taxa_percentual, observacoes
  ) VALUES (
    v_filial, f.id, f.descricao, p_banco_id, v_data,
    COALESCE(f.taxa, 0), NULLIF(btrim(COALESCE(p_observacoes, '')), '')
  )
  RETURNING id INTO v_lote_id;

  FOR c IN SELECT DISTINCT u FROM unnest(p_contas) AS u WHERE u IS NOT NULL ORDER BY 1 LOOP
    SELECT * INTO v_conta FROM public.contas_receber
     WHERE id = c AND COALESCE(ativo, true) FOR UPDATE;

    IF v_conta.id IS NULL THEN
      RAISE EXCEPTION 'Título não encontrado no lote.' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_conta.filial, 'Matriz') IS DISTINCT FROM v_filial THEN
      RAISE EXCEPTION 'O título "%" é da unidade %, e o repasse é de %.',
        v_conta.descricao, COALESCE(v_conta.filial, 'Matriz'), v_filial USING ERRCODE = 'P0001';
    END IF;
    IF v_conta.status IN ('Pago', 'Recebido') THEN
      RAISE EXCEPTION 'O título "%" já está quitado — refaça a seleção.', v_conta.descricao
        USING ERRCODE = 'P0001';
    END IF;
    IF v_conta.status = 'Cancelado' THEN
      RAISE EXCEPTION 'O título "%" está cancelado.', v_conta.descricao USING ERRCODE = 'P0001';
    END IF;

    v_calc   := public.calcular_valor_atualizado('receber', c);
    v_devido := ROUND(COALESCE((v_calc->>'total')::numeric, 0), 2);
    IF v_devido <= 0 THEN
      RAISE EXCEPTION 'O título "%" não tem saldo em aberto.', v_conta.descricao
        USING ERRCODE = 'P0001';
    END IF;

    -- MIGR 571: a baixa é a que já existe, e ela agora recusa título de
    -- cartão. Flag local acesa só em volta da chamada.
    PERFORM set_config('app.conciliando_maquininha', 'true', true);
    PERFORM public.baixar_conta_receber(c, p_banco_id, v_devido);
    PERFORM set_config('app.conciliando_maquininha', 'false', true);

    SELECT b.id INTO v_baixa_id
      FROM public.contas_receber_baixas b
     WHERE b.conta_id = c
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT 1;

    INSERT INTO public.conciliacao_maquininha_itens (
      conciliacao_id, conta_receber_id, baixa_id, descricao, valor_bruto
    ) VALUES (
      v_lote_id, c, v_baixa_id, v_conta.descricao, v_devido
    );

    v_bruto := v_bruto + v_devido;
    v_qtd   := v_qtd + 1;
  END LOOP;

  IF v_qtd = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um título para conciliar.' USING ERRCODE = 'P0001';
  END IF;

  v_taxa    := ROUND(v_bruto * COALESCE(f.taxa, 0) / 100, 2);
  v_liquido := v_bruto - v_taxa;

  IF v_taxa > 0 THEN
    INSERT INTO public.contas_pagar (
      descricao, valor, vencimento, status, filial, banco_id,
      valor_pago, pago_em, natureza, origem
    ) VALUES (
      format('Taxa da adquirente — %s — repasse de %s (%s título(s))',
             f.descricao, to_char(v_data, 'DD/MM/YYYY'), v_qtd),
      v_taxa, v_data, 'Pago', v_filial, p_banco_id,
      v_taxa, v_data, 'despesa', 'conciliacao_maquininha'
    )
    RETURNING id INTO v_cp_id;
  END IF;

  UPDATE public.conciliacoes_maquininha
     SET valor_bruto    = v_bruto,
         valor_taxa     = v_taxa,
         valor_liquido  = v_liquido,
         qtd_titulos    = v_qtd,
         conta_pagar_id = v_cp_id
   WHERE id = v_lote_id;

  RETURN jsonb_build_object(
    'id',            v_lote_id,
    'qtd_titulos',   v_qtd,
    'valor_bruto',   v_bruto,
    'taxa_percentual', COALESCE(f.taxa, 0),
    'valor_taxa',    v_taxa,
    'valor_liquido', v_liquido,
    'conta_pagar_id', v_cp_id
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. A parcela do misto passa a saber de que venda veio
-- ════════════════════════════════════════════════════════════════════════════
-- `contas_receber.venda_id` foi criada depois da migr. 415 — o comentário no
-- corpo dela ainda afirma que a coluna não existe. Preencher agora dá a essas
-- parcelas o mesmo elo que todas as outras têm, e o gatilho da marca deixa de
-- depender só do sufixo da descrição para elas.

CREATE OR REPLACE FUNCTION public.pdv_registrar_credito_misto(p_venda_id uuid, p_valor_credito numeric, p_parcelas integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venda        vendas;
  v_short_id     text;
  v_today        date := public.acre_today();
  v_conta        contas_receber;
  v_restante     numeric(15,2);
  v_parcela      numeric(15,2);
  v_acumulado    numeric(15,2) := 0;
  v_valor_atual  numeric(15,2);
  v_desc_base    text;
  v_parcelas     integer := COALESCE(p_parcelas, 1);
  i              integer;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_venda FROM vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda % não encontrada.', p_venda_id USING ERRCODE = 'P0002';
  END IF;

  -- Mesma régua de filial do resto do PDV: quem não opera a unidade não
  -- remexe no financeiro dela. COALESCE porque auth_pode_filial devolve NULL
  -- para quem está sem filial, e NULL num IF não barra ninguém.
  IF NOT COALESCE(public.auth_pode_filial(v_venda.filial), false) THEN
    RAISE EXCEPTION 'Sem permissão sobre a filial %.', v_venda.filial USING ERRCODE = 'P0001';
  END IF;

  -- Só venda mista. Crédito puro já é parcelado pela criar_venda_pdv, e
  -- deixar essa função mexer nele criaria duas fontes para o mesmo lançamento.
  IF v_venda.forma_pagamento IS NULL OR v_venda.forma_pagamento NOT LIKE 'Misto:%' THEN
    RAISE EXCEPTION 'Venda % não é pagamento misto (forma: %).',
      p_venda_id, COALESCE(v_venda.forma_pagamento, '—') USING ERRCODE = 'P0001';
  END IF;

  IF p_valor_credito IS NULL OR p_valor_credito <= 0 THEN
    RAISE EXCEPTION 'Valor do crédito precisa ser positivo.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_credito > v_venda.total_final + 0.01 THEN
    RAISE EXCEPTION 'Crédito (R$ %) maior que o total da venda (R$ %).',
      to_char(p_valor_credito,      'FM999G999G990D00'),
      to_char(v_venda.total_final,  'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  v_short_id  := UPPER(RIGHT(p_venda_id::text, 6));
  v_restante  := ROUND(v_venda.total_final - p_valor_credito, 2);

  -- IDEMPOTÊNCIA. Chamada repetida (duplo clique, retry de rede) não pode
  -- lançar a segunda leva de parcelas. O teste é a existência das parcelas,
  -- não o estado da conta à vista: depois do ajuste ela continua 'Pago' e
  -- ativa, e voltaria a casar com a busca abaixo.
  IF EXISTS (
    SELECT 1 FROM contas_receber
     WHERE descricao LIKE '%#' || v_short_id || '%(Cartão Crédito no misto)'
       AND filial = v_venda.filial
       AND ativo  = true
  ) THEN
    RETURN 0;
  END IF;

  -- A conta que a criar_venda_pdv gerou: paga, no dia, com o #shortId na
  -- descrição. O recorte por filial evita que uma colisão dos 6 caracteres do
  -- id alcance o financeiro de outra loja.
  SELECT * INTO v_conta
    FROM contas_receber
   WHERE descricao LIKE '%#' || v_short_id || '%'
     AND filial = v_venda.filial
     AND ativo = true
     AND status = 'Pago'
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Venda antiga, ou conta já baixada/editada pelo Financeiro. Não inventa
    -- lançamento em cima do que alguém mexeu à mão.
    RETURN 0;
  END IF;

  -- Tira só o sufixo de forma de pagamento que a criar_venda_pdv acrescenta no
  -- fim: '... #A1B2C3 (Misto: Dinheiro R$ 50,00 + Cartão Crédito R$ 200,00)'.
  -- `split_part(descricao, ' (', 1)` seria mais curto e estaria errado —
  -- corta no PRIMEIRO parêntese, e nome de produto com parêntese ("Arroz
  -- (5kg)") entra na descrição da venda. A base perderia o #shortId, que é a
  -- única amarração que essas contas têm.
  v_desc_base := regexp_replace(v_conta.descricao, ' \([^()]*\)$', '');

  IF v_restante > 0.005 THEN
    UPDATE contas_receber
       SET valor      = v_restante,
           descricao  = v_desc_base || ' (à vista no misto)',
           updated_at = now()
     WHERE id = v_conta.id;
  ELSE
    -- Misto inteiro no crédito (ex.: dois cartões): não sobra nada à vista.
    -- Soft-delete, que é como o resto do Financeiro remove lançamento.
    UPDATE contas_receber
       SET ativo = false, updated_at = now()
     WHERE id = v_conta.id;
  END IF;

  v_parcela := ROUND(p_valor_credito / v_parcelas, 2);
  FOR i IN 1..v_parcelas LOOP
    IF i = v_parcelas THEN
      v_valor_atual := p_valor_credito - v_acumulado;
    ELSE
      v_valor_atual := v_parcela;
      v_acumulado   := v_acumulado + v_parcela;
    END IF;
    -- MIGR 571: `venda_id` preenchido. A coluna nasceu depois desta função.
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
    VALUES (
      v_venda.cliente_id,
      v_desc_base || ' - Parcela ' || i || '/' || v_parcelas || ' (Cartão Crédito no misto)',
      v_valor_atual,
      v_today + (30 * i),
      'Aberto',
      v_venda.filial,
      p_venda_id
    );
  END LOOP;

  RETURN v_parcelas;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
