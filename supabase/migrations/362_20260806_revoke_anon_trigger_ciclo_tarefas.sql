-- =================================================================
-- 362 — Fecha `anon` na trigger function da 361.
--
-- Sobra da 361: `trg_ciclo_tarefas_updated_at` nasceu com EXECUTE pra
-- anon/authenticated, porque o Supabase mantém ALTER DEFAULT PRIVILEGES
-- concedendo EXECUTE em toda função nova do schema public — o mesmo
-- mecanismo descrito na 346. As 9 RPCs da 361 revogaram anon
-- nominalmente; a trigger function passou batido.
--
-- Superfície real: nenhuma. O PostgREST recusa invocar função que
-- retorna `trigger`, e fora de um trigger o corpo quebraria no `NEW`.
-- Isto é higiene de régua ("função nova não fica aberta pro anon"), não
-- correção de falha.
--
-- Revogar não afeta o disparo: o Postgres checa EXECUTE na criação do
-- trigger, não a cada linha.
--
-- Idempotente.
-- =================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.trg_ciclo_tarefas_updated_at()
  FROM public, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
