-- =================================================================
-- Logo por filial.
--
-- Espelha o padrão de banco-logos (migration 20260623b_caixa_bancos_logo):
--   - Coluna `logo_url text` na tabela filiais.
--   - Bucket público `filial-logos` no Storage com policies de upload
--     restritas a admin/CEO (auth_is_admin).
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.filiais
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN public.filiais.logo_url IS
  'URL pública da logo da filial no bucket filial-logos. NULL quando '
  'sem logo cadastrada — UI renderiza fallback de iniciais.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'filial-logos',
  'filial-logos',
  true,
  122880,  -- 120 KB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read: público.
DROP POLICY IF EXISTS "filial_logos_public_read" ON storage.objects;
CREATE POLICY "filial_logos_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'filial-logos');

-- Write/delete: somente admin/CEO.
DROP POLICY IF EXISTS "filial_logos_admin_insert" ON storage.objects;
CREATE POLICY "filial_logos_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'filial-logos' AND public.auth_is_admin());

DROP POLICY IF EXISTS "filial_logos_admin_update" ON storage.objects;
CREATE POLICY "filial_logos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'filial-logos' AND public.auth_is_admin())
  WITH CHECK (bucket_id = 'filial-logos' AND public.auth_is_admin());

DROP POLICY IF EXISTS "filial_logos_admin_delete" ON storage.objects;
CREATE POLICY "filial_logos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'filial-logos' AND public.auth_is_admin());

COMMIT;
