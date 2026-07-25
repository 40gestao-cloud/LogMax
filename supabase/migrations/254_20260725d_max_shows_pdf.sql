-- =================================================================
-- Max Show — importação de PDF
-- =================================================================
-- Amplia max_shows pra suportar dois tipos de apresentação:
--   'nativo' — slides estruturados no jsonb `conteudo` (default, WYSIWYG)
--   'pdf'    — arquivo PDF em Supabase Storage, sem edição, só apresentar
--
-- Fluxo para PDF: aluno faz "Salvar como PDF" no PowerPoint/Canva e
-- importa. Cobre o gap de PPTX (conversão exigiria endpoint externo e
-- estouraria o limite de 12 functions da Vercel Hobby).
--
-- Storage: bucket público `max-show-anexos` (mesmo padrão de nota-anexos).
-- 15 MB de teto — apresentações costumam passar bem disso, mas 15 MB é
-- um bom compromisso pro nosso caso didático.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Colunas ───────────────────────────────────────────────────
ALTER TABLE public.max_shows
  ADD COLUMN IF NOT EXISTS tipo             text NOT NULL DEFAULT 'nativo',
  ADD COLUMN IF NOT EXISTS arquivo_url      text,
  ADD COLUMN IF NOT EXISTS arquivo_nome     text,
  ADD COLUMN IF NOT EXISTS arquivo_tamanho  integer,   -- em bytes
  ADD COLUMN IF NOT EXISTS arquivo_paginas  integer;

-- Enforça só os dois tipos que existem.
ALTER TABLE public.max_shows
  DROP CONSTRAINT IF EXISTS max_shows_tipo_check;
ALTER TABLE public.max_shows
  ADD  CONSTRAINT max_shows_tipo_check CHECK (tipo IN ('nativo', 'pdf'));

-- ─── 2. Bucket público ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'max-show-anexos', 'max-show-anexos', true, 15728640,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 3. Policies do bucket ────────────────────────────────────────
-- Mesma régua canônica de nota-anexos: leitura pública (bucket público
-- já implica isso, mas explicitar via policy é mais robusto), write só
-- authenticated. RBAC fino fica em max_shows via RLS já existente.
DROP POLICY IF EXISTS "max_show_anexos_read" ON storage.objects;
CREATE POLICY "max_show_anexos_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'max-show-anexos');

DROP POLICY IF EXISTS "max_show_anexos_write" ON storage.objects;
CREATE POLICY "max_show_anexos_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'max-show-anexos');

DROP POLICY IF EXISTS "max_show_anexos_update" ON storage.objects;
CREATE POLICY "max_show_anexos_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'max-show-anexos') WITH CHECK (bucket_id = 'max-show-anexos');

DROP POLICY IF EXISTS "max_show_anexos_delete" ON storage.objects;
CREATE POLICY "max_show_anexos_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'max-show-anexos');

-- Recarrega cache PostgREST.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT column_name FROM information_schema.columns WHERE table_name='max_shows';
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id='max-show-anexos';
-- =================================================================
