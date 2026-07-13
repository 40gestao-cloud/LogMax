-- =================================================================
-- LogMax — ponto_qr_registros: remove auth_all remanescente
-- =================================================================
-- Mesma classe de bug corrigida em 20260713b_limpeza_rls_bypass_
-- generico.sql (auth_all sobrevivente do rollback pré-hardening),
-- escapou daquela lista por engano. `pontoqr_select`/`pontoqr_insert`/
-- `pontoqr_modify`/`pontoqr_delete` (20260516_rls_hardening) já
-- cobrem o mesmo caso de forma restrita (RH vê tudo, colaborador só
-- os próprios registros de ponto) — dropar a genérica só fecha o
-- furo.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "auth_all" ON public.ponto_qr_registros;

COMMIT;
