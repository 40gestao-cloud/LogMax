-- =================================================================
-- LogMax — Sync automático de saldo em caixa_bancos ao pagar/receber
-- =================================================================
-- Feature que existia só no LogMax-ERP (drift benigno). Diff via MCP
-- confirmou que as outras 3 turmas (aprendiz/contabilidade/Adm) não
-- tinham o sync automático — o saldo do banco em caixa_bancos ficava
-- desatualizado depois de pagar/receber contas até que alguém rodasse
-- update manual.
--
-- Regra: quando `contas_pagar` transita pra status='Pago' com banco_id
-- setado, debita o valor do saldo do banco correspondente. Reverte se
-- volta pra qualquer status ≠ 'Pago'. Idempotente em UPDATE do valor
-- ou banco (ajusta o delta). `contas_receber` faz o inverso (credita).
--
-- Origem: extraído do próprio LogMax-ERP via MCP (auditoria 2026-07-13).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. sync_saldo_caixa_pagar — debita caixa_bancos.saldo ao pagar
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_pagar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trg_sync_saldo_contas_pagar ON public.contas_pagar;
CREATE TRIGGER trg_sync_saldo_contas_pagar
  AFTER INSERT OR DELETE OR UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.sync_saldo_caixa_pagar();

-- ═══════════════════════════════════════════════════════════════════
-- 2. sync_saldo_caixa_receber — credita caixa_bancos.saldo ao receber
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_receber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trg_sync_saldo_contas_receber ON public.contas_receber;
CREATE TRIGGER trg_sync_saldo_contas_receber
  AFTER INSERT OR DELETE OR UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public.sync_saldo_caixa_receber();

COMMIT;
