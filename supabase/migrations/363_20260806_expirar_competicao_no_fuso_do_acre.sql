-- =================================================================
-- 363 — `expirar_competicoes` passa a olhar a data do Acre.
--
-- Bug: a função filtrava `data_fim < CURRENT_DATE`, e CURRENT_DATE é a
-- data UTC do servidor. A operação roda em America/Rio_Branco (UTC-5),
-- então a partir das 19h do Acre o CURRENT_DATE do banco já é o dia
-- seguinte. O cron das 03:10 UTC — que no Acre são 22:10 do dia
-- anterior — encontrava `data_fim < CURRENT_DATE` verdadeiro ainda
-- DENTRO do último dia da competição e a movia pra
-- 'aguardando_encerramento'.
--
-- Efeito prático: o conselho perdia as últimas ~2h do dia final, e a
-- tela passava a dizer "a competição saiu de em andamento e não aceita
-- mais nota" num dia em que, pelo calendário da operação, ela ainda
-- estava valendo. Confirmado no LogMax-ERP: competição com data_fim
-- 2026-08-04 marcada como expirada em 2026-08-06 03:10:57 UTC.
--
-- Correção: comparar com a data no fuso da operação, como já fazem
-- `lembrar_avaliacoes_pendentes` (345) e o resto do projeto. Assim a
-- competição só expira depois de o último dia terminar de fato no Acre.
--
-- Idempotente. Não altera nada já expirado — só muda o critério daqui
-- pra frente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.expirar_competicoes()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_hoje  date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
BEGIN
  UPDATE competicoes_matriz
     SET status = 'aguardando_encerramento', updated_at = now()
   WHERE ativo = true
     AND status = 'em_andamento'
     AND data_fim < v_hoje;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expirar_competicoes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expirar_competicoes() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
