-- =================================================================
-- Max Show — módulo didático de apresentações (slides)
-- =================================================================
-- Contexto: docente pediu (2026-07-25) uma terceira ferramenta no
-- Max Work, imitando PowerPoint/Google Slides, com IA (MaxAI) capaz
-- de gerar apresentações a partir de um tópico. Preserva o padrão
-- de max_docs/max_planilhas — dono edita, docente (admin/CEO/
-- conselheiro) enxerga tudo pra corrigir.
--
-- Estrutura salva em conteudo jsonb:
--   { version: 1, theme: 'dark'|'light', slides: [{
--       id, layout: 'title'|'content'|'two-col'|'image'|'quote',
--       title?, bullets?: string[], body?: string,
--       imageUrl?, notes? }] }
--
-- Já nasce com deleted_at (soft delete) — mesmo padrão da migr 250.
-- Sem endpoint em api/ — reusa /api/ai-chat (12/12 Vercel mantido).
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- Shows ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.max_shows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo       text NOT NULL DEFAULT 'Apresentação sem título',
  conteudo     jsonb NOT NULL DEFAULT '{"version":1,"theme":"dark","slides":[]}'::jsonb,
  ativo        boolean NOT NULL DEFAULT true,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS max_shows_user_deleted_idx
  ON public.max_shows (user_id, deleted_at, updated_at DESC);

-- updated_at trigger (reusa a function criada em 249_max_work)
DROP TRIGGER IF EXISTS max_shows_touch ON public.max_shows;
CREATE TRIGGER max_shows_touch
  BEFORE UPDATE ON public.max_shows
  FOR EACH ROW EXECUTE FUNCTION public.max_work_touch_updated_at();

-- RLS --------------------------------------------------------------
ALTER TABLE public.max_shows ENABLE ROW LEVEL SECURITY;

-- Docs policies (mesma régua de max_docs / max_planilhas)
DROP POLICY IF EXISTS max_shows_select ON public.max_shows;
CREATE POLICY max_shows_select ON public.max_shows
  FOR SELECT
  USING (user_id = auth.uid() OR public.max_work_is_docente());

DROP POLICY IF EXISTS max_shows_insert ON public.max_shows;
CREATE POLICY max_shows_insert ON public.max_shows
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS max_shows_update ON public.max_shows;
CREATE POLICY max_shows_update ON public.max_shows
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS max_shows_delete ON public.max_shows;
CREATE POLICY max_shows_delete ON public.max_shows
  FOR DELETE
  USING (user_id = auth.uid() OR public.max_work_is_docente());

-- Recarrega cache PostgREST (evita PGRST202 no primeiro acesso)
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='max_shows';
--   SELECT policyname FROM pg_policies WHERE tablename='max_shows';
--   SELECT column_name FROM information_schema.columns WHERE table_name='max_shows';
-- =================================================================
