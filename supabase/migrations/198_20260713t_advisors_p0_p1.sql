-- =================================================================
-- LogMax — Fechar findings P0/P1 do Supabase advisors (2026-07-13)
-- =================================================================
-- Auditoria pós-convergência via mcp__supabase__get_advisors achou 3
-- problemas objetivos que valem corrigir agora:
--
-- P0:
--   1. `v_campanha_roi` é SECURITY DEFINER — bypassa RLS. Marketing
--      SuperMax lê receita de campanhas MaxLook/TechMax via a view
--      (usada pelo CampanhasMarketingView.tsx sem filtro filial no
--      client). Fix: security_invoker=true — RLS de marketing_campanhas
--      + vendas volta a valer.
--
--   2. `perfil_fotos_public_read` deixa qualquer anon/authenticated
--      LISTAR `storage.objects` do bucket, o que expõe todos os user_id
--      + paths de foto. URLs públicas individuais continuam via endpoint
--      `/storage/v1/object/public/…` (bypass RLS), então avatares dos
--      colegas seguem visíveis; só se fecha a enumeração via LIST.
--      Front nunca chama `.list()` no bucket — confirmado por grep.
--
-- P1:
--   3. 5 pares de índices identicos em `created_at` (marketing_arte_
--      feedback, marketing_artes, notificacoes, pesquisas, tarefas).
--      Convenção: mantemos o nome completo `idx_<tabela>_created_at` e
--      dropamos o gêmeo.
--
-- Idempotente. Rode nos 4 projetos.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- P0.1 — v_campanha_roi passa a rodar como o querying user
-- ═══════════════════════════════════════════════════════════════════

ALTER VIEW public.v_campanha_roi SET (security_invoker = true);

-- ═══════════════════════════════════════════════════════════════════
-- P0.2 — perfil-fotos SELECT vira owner-only (+ admin/CEO/conselheiro)
--        URL pública individual segue funcionando (endpoint public
--        bypassa RLS); só fecha enumeração via LIST.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS perfil_fotos_public_read ON storage.objects;
DROP POLICY IF EXISTS perfil_fotos_auth_read   ON storage.objects;

CREATE POLICY perfil_fotos_auth_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'perfil-fotos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- P1 — Drop 5 índices duplicados em created_at
-- ═══════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_arte_feedback_created;      -- gêmeo de idx_marketing_arte_feedback_created_at
DROP INDEX IF EXISTS public.idx_artes_created_at;           -- gêmeo de idx_marketing_artes_created_at
DROP INDEX IF EXISTS public.idx_notif_created_at;           -- gêmeo de idx_notificacoes_created_at
DROP INDEX IF EXISTS public.pesquisas_created_at_idx;       -- gêmeo de idx_pesquisas_created_at
DROP INDEX IF EXISTS public.tarefas_created_at_idx;         -- gêmeo de idx_tarefas_created_at

COMMIT;
