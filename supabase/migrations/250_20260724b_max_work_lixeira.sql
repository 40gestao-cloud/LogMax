-- =================================================================
-- Max Work — lixeira (soft delete) para docs e planilhas
-- =================================================================
-- Contexto: aluno excluir sem querer é problema real no contexto
-- didático. Solução: soft delete via `deleted_at`, com aba Lixeira
-- visível ao próprio usuário (restaurar / excluir permanentemente).
-- Auto-purge após 30 dias — feito lazy no client ao abrir a lixeira
-- (fire-and-forget), sem precisar de cron.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

ALTER TABLE public.max_docs      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.max_planilhas ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Índice para a listagem principal (WHERE deleted_at IS NULL) e a lixeira.
DROP INDEX IF EXISTS max_docs_user_ativo_idx;
DROP INDEX IF EXISTS max_planilhas_user_ativo_idx;
CREATE INDEX IF NOT EXISTS max_docs_user_deleted_idx
  ON public.max_docs (user_id, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS max_planilhas_user_deleted_idx
  ON public.max_planilhas (user_id, deleted_at, updated_at DESC);

COMMIT;

-- Recarrega cache PostgREST (colunas novas).
NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name IN ('max_docs','max_planilhas') AND column_name='deleted_at';
-- =================================================================
