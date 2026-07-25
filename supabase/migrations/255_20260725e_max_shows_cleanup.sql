-- =================================================================
-- Max Show — limpeza de colunas mortas (após virar PDF-only)
-- =================================================================
-- Contexto: a decisão de 2026-07-25 foi remover o editor nativo de
-- slides e manter apenas upload + apresentação de PDF. Estas colunas
-- vieram das migrações 253 (tabela original) e 254 (adição de PDF) e
-- não são mais usadas por nenhum código:
--
--   conteudo        — era o JSON dos slides (nativo)
--   ativo           — nunca lido; soft delete usa `deleted_at`
--   tipo            — sempre 'pdf', virou constante
--   arquivo_paginas — nunca populado (sem parser de PDF)
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- Constraint some antes da coluna que ela referencia.
ALTER TABLE public.max_shows
  DROP CONSTRAINT IF EXISTS max_shows_tipo_check;

ALTER TABLE public.max_shows
  DROP COLUMN IF EXISTS conteudo,
  DROP COLUMN IF EXISTS ativo,
  DROP COLUMN IF EXISTS tipo,
  DROP COLUMN IF EXISTS arquivo_paginas;

-- Agora arquivo_url é obrigatório (todo show é PDF importado).
UPDATE public.max_shows SET arquivo_url = ''
 WHERE arquivo_url IS NULL;
ALTER TABLE public.max_shows
  ALTER COLUMN arquivo_url SET NOT NULL;

-- Recarrega cache PostgREST.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_name='max_shows' ORDER BY ordinal_position;
--   -- Esperado: id, user_id, titulo, deleted_at, created_at, updated_at,
--   --           arquivo_url (NOT NULL), arquivo_nome, arquivo_tamanho
-- =================================================================
