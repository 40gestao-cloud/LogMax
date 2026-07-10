-- =====================================================================
-- Capital efetivo — 3 mudanças estruturais:
--
--  #1  RPC calcular_saldo_capital ganha DRE detalhado
--      (despesas operacionais x financeiras, lucro operacional x líquido)
--      e passa a aceitar 'Pago' OU 'Recebido' em contas_receber — hoje o
--      frontend grava 'Pago', mas a RPC procurava só 'Recebido', então
--      NENHUMA receita entrava no cálculo. Bug silencioso corrigido aqui.
--
--  #2  Bloqueio efetivo em contas_pagar quando a filial estourou o capital.
--      Trigger BEFORE INSERT + BEFORE UPDATE OF status. Passa livre pra
--      parcelas de empréstimo já contratado (origem='emprestimo').
--
--  #3  Trigger sincroniza caixa_bancos.saldo com o pagamento/recebimento.
--      Substitui o UPDATE em 2 queries do client (race condition
--      documentada nos Views). Reage a INSERT/UPDATE/DELETE + soft-delete
--      via ativo=false, e reverte se voltar de 'Pago' pra outro status.
-- =====================================================================

BEGIN;

-- ── #0 Pré-requisitos (idempotente) ─────────────────────────────────
-- Alguns ambientes ainda não aplicaram 20260601_filial_contas.sql.
-- Sem essa coluna, tanto a RPC quanto o trigger de bloqueio quebram
-- com "column filial does not exist". Recriar aqui é seguro (IF NOT
-- EXISTS) e mantém a migração autoconsistente.
ALTER TABLE public.contas_pagar   ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';
ALTER TABLE public.contas_receber ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';

-- ── #1 RPC com DRE detalhado ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.calcular_saldo_capital(text);
CREATE FUNCTION public.calcular_saldo_capital(p_filial text)
RETURNS TABLE (
  capital_total         numeric,
  despesas_pagas        numeric,   -- total (operacionais + financeiras)
  despesas_operacionais numeric,   -- origem != 'emprestimo'
  despesas_financeiras  numeric,   -- origem  = 'emprestimo'
  receitas_pagas        numeric,
  lucro_operacional     numeric,   -- receita − despesa operacional
  lucro_liquido         numeric,   -- lucro operacional − financeiras − reserva
  reserva_valor         numeric,
  reserva_pct           numeric,
  saldo_livre           numeric,   -- capital+empréstimo − despesas − reserva
  saldo_real            numeric,   -- capital+empréstimo − despesas (sem reserva)
  bloqueado             boolean,
  em_reserva            boolean,
  data_inicio           date,
  data_fim              date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg         RECORD;
  v_capital     numeric := 0;
  v_emprest     numeric := 0;
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

  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial
     AND cr.status IN ('Pago', 'Recebido')     -- frontend grava 'Pago'
     AND COALESCE(cr.ativo, true) = true
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

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
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_inicio ELSE CURRENT_DATE END,
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_fim ELSE NULL END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcular_saldo_capital(text) TO authenticated;


-- ── #2 Bloqueio efetivo em contas_pagar ────────────────────────────
CREATE OR REPLACE FUNCTION public.bloqueia_conta_pagar_estourado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bloqueado boolean;
BEGIN
  -- Parcelas de empréstimo já contratado passam (dívida existe)
  IF NEW.origem = 'emprestimo' THEN RETURN NEW; END IF;
  -- Sem filial (Matriz global) não passa pelo bloqueio
  IF NEW.filial IS NULL OR NEW.filial = 'Matriz' THEN RETURN NEW; END IF;

  SELECT bloqueado INTO v_bloqueado
    FROM public.calcular_saldo_capital(NEW.filial)
    LIMIT 1;

  IF v_bloqueado THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Capital da filial ' || NEW.filial ||
                ' estourado. Solicite empréstimo à Matriz antes de lançar/pagar despesas.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contas_pagar_bloqueio_insert ON public.contas_pagar;
CREATE TRIGGER trg_contas_pagar_bloqueio_insert
  BEFORE INSERT ON public.contas_pagar
  FOR EACH ROW
  EXECUTE FUNCTION public.bloqueia_conta_pagar_estourado();

DROP TRIGGER IF EXISTS trg_contas_pagar_bloqueio_pagar ON public.contas_pagar;
CREATE TRIGGER trg_contas_pagar_bloqueio_pagar
  BEFORE UPDATE OF status ON public.contas_pagar
  FOR EACH ROW
  WHEN (NEW.status = 'Pago' AND OLD.status IS DISTINCT FROM 'Pago')
  EXECUTE FUNCTION public.bloqueia_conta_pagar_estourado();


-- ── #3 Sincroniza caixa_bancos.saldo com pagamento/recebimento ─────
-- Substitui a lógica atual do frontend (dois UPDATEs sequenciais com
-- race condition). Reage a soft-delete (ativo=false) e a reversão.

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_pagar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_novo_ok boolean := false;
  v_ant_ok  boolean := false;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_novo_ok := (NEW).status = 'Pago' AND COALESCE((NEW).ativo, true)
             AND (NEW).banco_id IS NOT NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_ant_ok  := (OLD).status = 'Pago' AND COALESCE((OLD).ativo, true)
             AND (OLD).banco_id IS NOT NULL;
  END IF;

  -- Reverte débito antigo se saiu do estado 'pago' ou mudou banco/valor
  IF v_ant_ok AND (
       NOT v_novo_ok
       OR (OLD).banco_id <> (NEW).banco_id
       OR (OLD).valor    <> (NEW).valor
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + (OLD).valor
     WHERE id = (OLD).banco_id;
  END IF;

  -- Aplica débito novo
  IF v_novo_ok AND (
       NOT v_ant_ok
       OR (OLD).banco_id <> (NEW).banco_id
       OR (OLD).valor    <> (NEW).valor
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - (NEW).valor
     WHERE id = (NEW).banco_id;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_receber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_novo_ok boolean := false;
  v_ant_ok  boolean := false;
BEGIN
  -- Receitas: frontend grava 'Pago'; RPC aceita 'Recebido' também.
  IF TG_OP <> 'DELETE' THEN
    v_novo_ok := (NEW).status IN ('Pago', 'Recebido') AND COALESCE((NEW).ativo, true)
             AND (NEW).banco_id IS NOT NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_ant_ok  := (OLD).status IN ('Pago', 'Recebido') AND COALESCE((OLD).ativo, true)
             AND (OLD).banco_id IS NOT NULL;
  END IF;

  IF v_ant_ok AND (
       NOT v_novo_ok
       OR (OLD).banco_id <> (NEW).banco_id
       OR (OLD).valor    <> (NEW).valor
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - (OLD).valor
     WHERE id = (OLD).banco_id;
  END IF;

  IF v_novo_ok AND (
       NOT v_ant_ok
       OR (OLD).banco_id <> (NEW).banco_id
       OR (OLD).valor    <> (NEW).valor
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + (NEW).valor
     WHERE id = (NEW).banco_id;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_saldo_contas_pagar ON public.contas_pagar;
CREATE TRIGGER trg_sync_saldo_contas_pagar
  AFTER INSERT OR UPDATE OR DELETE ON public.contas_pagar
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_saldo_caixa_pagar();

DROP TRIGGER IF EXISTS trg_sync_saldo_contas_receber ON public.contas_receber;
CREATE TRIGGER trg_sync_saldo_contas_receber
  AFTER INSERT OR UPDATE OR DELETE ON public.contas_receber
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_saldo_caixa_receber();

COMMIT;
