-- =================================================================
-- Max Work — módulo didático de documentos e planilhas
-- =================================================================
-- Contexto: docente pediu (2026-07-24) tela dentro do LogMax onde
-- alunos elaboram relatórios (imitação Word, via Tiptap) e planilhas
-- (imitação Excel, via Fortune-sheet). Cada aluno vê só o próprio
-- material; admin/CEO/conselheiro leem tudo pra corrigir.
--
-- Duas tabelas paralelas — separadas pra ficar simples e permitir
-- storages diferentes no futuro (docx ↔ html; xlsx ↔ jsonb celdata).
--
-- Sem endpoint em api/ — Supabase direto (segura 12/12 do Vercel).
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- Docs -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.max_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo       text NOT NULL DEFAULT 'Documento sem título',
  conteudo     text NOT NULL DEFAULT '',
  ativo        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS max_docs_user_ativo_idx
  ON public.max_docs (user_id, ativo, updated_at DESC);

-- Planilhas --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.max_planilhas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo       text NOT NULL DEFAULT 'Planilha sem título',
  conteudo     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS max_planilhas_user_ativo_idx
  ON public.max_planilhas (user_id, ativo, updated_at DESC);

-- updated_at trigger -----------------------------------------------
CREATE OR REPLACE FUNCTION public.max_work_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS max_docs_touch ON public.max_docs;
CREATE TRIGGER max_docs_touch
  BEFORE UPDATE ON public.max_docs
  FOR EACH ROW EXECUTE FUNCTION public.max_work_touch_updated_at();

DROP TRIGGER IF EXISTS max_planilhas_touch ON public.max_planilhas;
CREATE TRIGGER max_planilhas_touch
  BEFORE UPDATE ON public.max_planilhas
  FOR EACH ROW EXECUTE FUNCTION public.max_work_touch_updated_at();

-- RLS --------------------------------------------------------------
ALTER TABLE public.max_docs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.max_planilhas ENABLE ROW LEVEL SECURITY;

-- Helper: docente que pode enxergar TODOS os trabalhos
CREATE OR REPLACE FUNCTION public.max_work_is_docente()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
      AND (role IN ('admin', 'ceo') OR is_conselheiro = true)
  );
$$;

-- Docs policies
DROP POLICY IF EXISTS max_docs_select ON public.max_docs;
CREATE POLICY max_docs_select ON public.max_docs
  FOR SELECT
  USING (user_id = auth.uid() OR public.max_work_is_docente());

DROP POLICY IF EXISTS max_docs_insert ON public.max_docs;
CREATE POLICY max_docs_insert ON public.max_docs
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS max_docs_update ON public.max_docs;
CREATE POLICY max_docs_update ON public.max_docs
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS max_docs_delete ON public.max_docs;
CREATE POLICY max_docs_delete ON public.max_docs
  FOR DELETE
  USING (user_id = auth.uid() OR public.max_work_is_docente());

-- Planilhas policies (mesma régua)
DROP POLICY IF EXISTS max_planilhas_select ON public.max_planilhas;
CREATE POLICY max_planilhas_select ON public.max_planilhas
  FOR SELECT
  USING (user_id = auth.uid() OR public.max_work_is_docente());

DROP POLICY IF EXISTS max_planilhas_insert ON public.max_planilhas;
CREATE POLICY max_planilhas_insert ON public.max_planilhas
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS max_planilhas_update ON public.max_planilhas;
CREATE POLICY max_planilhas_update ON public.max_planilhas
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS max_planilhas_delete ON public.max_planilhas;
CREATE POLICY max_planilhas_delete ON public.max_planilhas
  FOR DELETE
  USING (user_id = auth.uid() OR public.max_work_is_docente());

-- Recarrega cache PostgREST (evita PGRST202 no primeiro acesso)
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'max_%';
--   SELECT policyname FROM pg_policies WHERE tablename IN ('max_docs','max_planilhas');
-- =================================================================
