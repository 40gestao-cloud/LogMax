-- =================================================================
-- Logo por banco em caixa_bancos.
--
-- Espelha o padrão de produto-imagens (migration 20260518_produto_imagens):
--   - Coluna `imagem_url text` na tabela.
--   - Bucket público `banco-logos` no Storage com policies de upload
--     restritas a usuários autenticados do setor Financeiro (admin/CEO
--     passam via auth_is_admin).
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.caixa_bancos
  ADD COLUMN IF NOT EXISTS imagem_url text;

COMMENT ON COLUMN public.caixa_bancos.imagem_url IS
  'URL pública da logo do banco no bucket banco-logos. NULL quando '
  'sem logo cadastrada — UI renderiza o ícone Landmark de fallback.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'banco-logos',
  'banco-logos',
  true,
  122880,  -- 120 KB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read: público (logos exibidas em qualquer UI financeira).
DROP POLICY IF EXISTS "banco_logos_public_read" ON storage.objects;
CREATE POLICY "banco_logos_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'banco-logos');

-- Write/delete: só financeiro (e admin/CEO via auth_is_admin no helper).
DROP POLICY IF EXISTS "banco_logos_fin_insert" ON storage.objects;
CREATE POLICY "banco_logos_fin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'));

DROP POLICY IF EXISTS "banco_logos_fin_update" ON storage.objects;
CREATE POLICY "banco_logos_fin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'))
  WITH CHECK (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'));

DROP POLICY IF EXISTS "banco_logos_fin_delete" ON storage.objects;
CREATE POLICY "banco_logos_fin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'));

COMMIT;
