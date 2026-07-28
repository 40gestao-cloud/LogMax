-- Financeiro: para de mentir sobre juros, sobre caixa reaberto e sobre
-- aprovação de pedido.
--
-- Três achados, todos da mesma família: a UI afirmava uma coisa e o banco
-- fazia outra.
--
--   F1  ContasPagar/Receber exibiam "R$ X debitado (inclui R$ Y de juros)",
--       mas o UPDATE só gravava status='Pago' e o trigger debitava `valor` —
--       o principal. Os juros nunca saíam de lugar nenhum e não havia coluna
--       onde pudessem cair. O módulo Juros & Multa era decorativo.
--
--   F3  Reabrir caixa zerava `diferenca`/`valor_fechamento` sem registrar
--       nada. Uma falta de caixa sumia com dois cliques, sem rastro de quem
--       apagou nem de quanto era.
--
--   REC-2  "Aprovar Pedido" era um gate de mentira: sem nenhum RBAC (qualquer
--       um que enxergasse o módulo Compras clicava) e cuja única função real
--       era gerar a Conta a Pagar. Some. A conta nasce junto com o pedido.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- F1.a  Onde o valor efetivamente pago passa a morar
-- ────────────────────────────────────────────────────────────────────────────
-- `valor` continua sendo o valor de face (o que foi contratado). `valor_pago`
-- é o que saiu/entrou do banco de verdade. Separados de propósito: o relatório
-- de inadimplência precisa dos dois para mostrar quanto o atraso custou.

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS valor_pago numeric(15,2),
  ADD COLUMN IF NOT EXISTS juros_pago numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multa_pago numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pago_em    date;

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS valor_pago numeric(15,2),
  ADD COLUMN IF NOT EXISTS juros_pago numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multa_pago numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pago_em    date;

COMMENT ON COLUMN public.contas_pagar.valor_pago IS
  'Valor que realmente saiu do banco (principal + juros + multa). NULL = ainda '
  'não pago. O trigger de saldo usa COALESCE(valor_pago, valor). Migração 267.';

-- Contas já quitadas antes desta migração foram debitadas pelo principal —
-- registra isso em vez de deixar NULL fingindo que não foram pagas.
UPDATE public.contas_pagar   SET valor_pago = valor WHERE status = 'Pago' AND valor_pago IS NULL;
UPDATE public.contas_receber SET valor_pago = valor WHERE status IN ('Pago','Recebido') AND valor_pago IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- F1.b  Triggers de saldo passam a usar o valor efetivo
-- ────────────────────────────────────────────────────────────────────────────
-- A ordem das cláusulas do OR importa: em INSERT não existe OLD, e é o
-- `NOT v_ant_ok` na frente que faz o short-circuit evitar tocar em (OLD).

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_pagar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_novo_ok  boolean := false;
  v_ant_ok   boolean := false;
  v_novo_val numeric(15,2) := 0;
  v_ant_val  numeric(15,2) := 0;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_novo_ok  := (NEW).status = 'Pago' AND COALESCE((NEW).ativo, true)
              AND (NEW).banco_id IS NOT NULL;
    v_novo_val := COALESCE((NEW).valor_pago, (NEW).valor);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_ant_ok  := (OLD).status = 'Pago' AND COALESCE((OLD).ativo, true)
             AND (OLD).banco_id IS NOT NULL;
    v_ant_val := COALESCE((OLD).valor_pago, (OLD).valor);
  END IF;

  IF v_ant_ok AND (
       NOT v_novo_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + v_ant_val
     WHERE id = (OLD).banco_id;
  END IF;

  IF v_novo_ok AND (
       NOT v_ant_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - v_novo_val
     WHERE id = (NEW).banco_id;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_receber()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_novo_ok  boolean := false;
  v_ant_ok   boolean := false;
  v_novo_val numeric(15,2) := 0;
  v_ant_val  numeric(15,2) := 0;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_novo_ok  := (NEW).status IN ('Pago', 'Recebido') AND COALESCE((NEW).ativo, true)
              AND (NEW).banco_id IS NOT NULL;
    v_novo_val := COALESCE((NEW).valor_pago, (NEW).valor);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_ant_ok  := (OLD).status IN ('Pago', 'Recebido') AND COALESCE((OLD).ativo, true)
             AND (OLD).banco_id IS NOT NULL;
    v_ant_val := COALESCE((OLD).valor_pago, (OLD).valor);
  END IF;

  IF v_ant_ok AND (
       NOT v_novo_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - v_ant_val
     WHERE id = (OLD).banco_id;
  END IF;

  IF v_novo_ok AND (
       NOT v_ant_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + v_novo_val
     WHERE id = (NEW).banco_id;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- F1.c  RPC de pagamento — o juros é calculado no banco, não no cliente
-- ────────────────────────────────────────────────────────────────────────────
-- O cliente não manda mais o valor. Ele pergunta quanto é e o banco responde
-- com o mesmo número que vai gravar, usando `calcular_valor_atualizado` (a
-- mesma função que o resto do Financeiro já usa). Assim o toast não tem como
-- divergir do débito.

CREATE OR REPLACE FUNCTION public.registrar_pagamento_conta(
  p_tipo     text,
  p_conta_id uuid,
  p_banco_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_calc   jsonb;
  v_total  numeric(15,2);
  v_juros  numeric(15,2);
  v_multa  numeric(15,2);
  v_status text;
  v_filial text;
BEGIN
  -- Sem lista de setores: a régua real é verificada abaixo, depois de saber a
  -- filial da conta — Financeiro OU gerente daquela filial (régua canônica
  -- "gerente opera a filial inteira").
  PERFORM public._assert_rpc();

  IF p_tipo NOT IN ('pagar', 'receber') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;
  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'pagar' THEN
    SELECT status, filial INTO v_status, v_filial
      FROM public.contas_pagar WHERE id = p_conta_id AND COALESCE(ativo, true) FOR UPDATE;
  ELSE
    SELECT status, filial INTO v_status, v_filial
      FROM public.contas_receber WHERE id = p_conta_id AND COALESCE(ativo, true) FOR UPDATE;
  END IF;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IN ('Pago', 'Recebido') THEN
    RAISE EXCEPTION 'Esta conta já está quitada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_filial IS NOT NULL AND NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.auth_in_setor('financeiro')
          OR public.auth_gerente_da(v_filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial registram baixa de conta.'
      USING ERRCODE = '42501';
  END IF;

  v_calc  := public.calcular_valor_atualizado(p_tipo, p_conta_id);
  v_total := (v_calc->>'total')::numeric;
  v_juros := COALESCE((v_calc->>'juros')::numeric, 0);
  v_multa := COALESCE((v_calc->>'multa')::numeric, 0);

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Valor da conta inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'pagar' THEN
    UPDATE public.contas_pagar
       SET status = 'Pago', banco_id = p_banco_id,
           valor_pago = v_total, juros_pago = v_juros, multa_pago = v_multa,
           pago_em = public.acre_today()
     WHERE id = p_conta_id;
  ELSE
    UPDATE public.contas_receber
       SET status = 'Pago', banco_id = p_banco_id,
           valor_pago = v_total, juros_pago = v_juros, multa_pago = v_multa,
           pago_em = public.acre_today()
     WHERE id = p_conta_id;
  END IF;

  RETURN v_calc;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pagamento_conta(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_conta(text, uuid, uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- F3  Reabertura de caixa vira evento auditável
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.controle_caixa_reaberturas (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  controle_caixa_id uuid NOT NULL REFERENCES public.controle_caixa(id) ON DELETE CASCADE,
  filial            text,
  data_caixa        date,
  valor_fechamento  numeric(15,2),
  valor_esperado    numeric(15,2),
  diferenca         numeric(15,2),
  tipo_diferenca    text,
  motivo            text NOT NULL,
  reaberto_por      uuid,
  reaberto_por_nome text,
  reaberto_em       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.controle_caixa_reaberturas IS
  'Toda reabertura de caixa guarda aqui o fechamento que foi descartado. Sem '
  'isto uma falta de caixa sumia sem rastro. Migração 267.';

ALTER TABLE public.controle_caixa_reaberturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caixa_reab_select ON public.controle_caixa_reaberturas;
CREATE POLICY caixa_reab_select ON public.controle_caixa_reaberturas
  FOR SELECT TO authenticated
  USING (public.auth_in_setor('financeiro') OR public.auth_pode_filial(filial));

-- Escrita só pela RPC (SECURITY DEFINER). Ninguém insere direto: um registro
-- de auditoria que o auditado pode forjar não é auditoria.
REVOKE ALL ON public.controle_caixa_reaberturas FROM PUBLIC, anon;
GRANT SELECT ON public.controle_caixa_reaberturas TO authenticated;
GRANT ALL ON public.controle_caixa_reaberturas TO service_role;

CREATE OR REPLACE FUNCTION public.reabrir_caixa(p_caixa_id uuid, p_motivo text)
RETURNS public.controle_caixa
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cx   public.controle_caixa;
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Descreva o motivo da reabertura (mínimo 5 caracteres).'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cx FROM public.controle_caixa WHERE id = p_caixa_id FOR UPDATE;
  IF v_cx.id IS NULL THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(v_cx.filial) THEN
    RAISE EXCEPTION 'Caixa de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.auth_in_setor('financeiro')
          OR public.auth_gerente_da(v_cx.filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial reabrem um caixa.'
      USING ERRCODE = '42501';
  END IF;
  IF v_cx.status = 'Aberto' THEN
    RAISE EXCEPTION 'Este caixa já está aberto.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  -- Grava o fechamento descartado ANTES de limpar.
  INSERT INTO public.controle_caixa_reaberturas (
    controle_caixa_id, filial, data_caixa, valor_fechamento, valor_esperado,
    diferenca, tipo_diferenca, motivo, reaberto_por, reaberto_por_nome
  ) VALUES (
    v_cx.id, v_cx.filial, v_cx.data, v_cx.valor_fechamento, v_cx.valor_esperado,
    v_cx.diferenca, v_cx.tipo_diferenca, trim(p_motivo), auth.uid(), v_nome
  );

  UPDATE public.controle_caixa
     SET status = 'Aberto',
         valor_fechamento = NULL, valor_esperado = NULL,
         diferenca = NULL, tipo_diferenca = NULL,
         fechado_por = NULL, fechado_por_nome = NULL, fechado_em = NULL,
         origem_fechamento = NULL
   WHERE id = p_caixa_id
  RETURNING * INTO v_cx;

  RETURN v_cx;
END;
$$;

REVOKE ALL ON FUNCTION public.reabrir_caixa(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_caixa(uuid, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- REC-2  A Conta a Pagar nasce junto com o pedido
-- ────────────────────────────────────────────────────────────────────────────
-- Substitui a versão da migração 266. O pedido já sai 'Aprovado': ele veio de
-- uma cotação que o Financeiro aprovou: aprovar de novo, sem RBAC, numa tela
-- de Compras, não era controle nenhum. O que a etapa realmente fazia — gerar a
-- conta — acontece agora aqui dentro, no mesmo COMMIT.

CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(p_cotacao_id uuid)
RETURNS public.pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cot        public.cotacoes;
  v_req        public.requisicoes;
  v_pedido     public.pedidos;
  v_prazo      date;
  v_vencimento date;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_cotacao_id FOR UPDATE;

  IF v_cot.id IS NULL THEN
    RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(v_cot.filial) THEN
    RAISE EXCEPTION 'Cotação de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_cot.ativo IS NOT TRUE OR v_cot.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só cotação aprovada e ativa gera pedido (status atual: %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pedidos WHERE cotacao_id = v_cot.id AND ativo) THEN
    RAISE EXCEPTION 'Esta cotação já tem pedido gerado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cot.requisicao_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.pedidos WHERE requisicao_id = v_cot.requisicao_id AND ativo
     ) THEN
    RAISE EXCEPTION 'Esta requisição já foi atendida por outro pedido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = v_cot.requisicao_id;

  v_prazo := CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
                  THEN v_cot.prazo_entrega::date END;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd
  )
  RETURNING * INTO v_pedido;

  IF v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.requisicoes SET status = 'Atendida'
     WHERE id = v_cot.requisicao_id AND status = 'Aprovado';
  END IF;

  -- +30 dias quando a cotação não trouxe prazo — a conta precisa de vencimento.
  v_vencimento := COALESCE(v_prazo, public.acre_today() + 30);

  INSERT INTO public.contas_pagar (
    fornecedor_id, descricao, valor, vencimento, status, pedido_id, filial
  ) VALUES (
    v_cot.fornecedor_id,
    'Pedido #' || upper(right(v_pedido.id::text, 6)) || ' — ' || COALESCE(v_req.item, 'Compra'),
    v_cot.valor_total, v_vencimento, 'Pendente', v_pedido.id, v_cot.filial
  );

  RETURN v_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_pedido_de_cotacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_pedido_de_cotacao(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Backfill do valor pago (nenhuma linha Pago pode ficar com valor_pago NULL):
-- SELECT count(*) FROM contas_pagar WHERE status='Pago' AND valor_pago IS NULL;
--
-- 2) Pagar uma conta vencida pelo app e conferir que o débito bate com o toast:
-- SELECT valor, valor_pago, juros_pago, multa_pago FROM contas_pagar
--  WHERE status='Pago' ORDER BY pago_em DESC LIMIT 1;
--
-- 3) Reabrir um caixa fechado com diferença e conferir o rastro:
-- SELECT * FROM controle_caixa_reaberturas ORDER BY reaberto_em DESC LIMIT 1;
