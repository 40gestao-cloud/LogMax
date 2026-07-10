-- =================================================================
-- LogMax — Imagem por produto (storage + coluna imagem_url)
-- =================================================================
-- Adiciona suporte a 1 imagem por produto:
--   • Coluna `imagem_url` em produtos (URL pública do Storage).
--   • Bucket público `produto-imagens` (leitura anônima — PDV mostra
--     imagens sem login no QRTotem; PWA não precisa de signed URL).
--   • Policies para authenticated INSERT/UPDATE/DELETE no bucket.
--
-- A validação de tamanho (120 KB) e formato é feita no front
-- (src/lib/produtoImagem.ts). O bucket também tem file_size_limit
-- como segunda linha de defesa.
--
-- Execute no Supabase SQL Editor.
-- =================================================================

-- 1) Coluna na tabela produtos
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS imagem_url text;

-- 2) Bucket público com limite duro de 120 KB e MIME types permitidos.
--    INSERT idempotente — se já existir, força os limites atualizados.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'produto-imagens',
  'produto-imagens',
  true,
  122880, -- 120 KB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3) Policies de storage.objects para o bucket produto-imagens.
--    Leitura: anônima (qualquer um pode ver imagem de produto).
--    Escrita: somente authenticated (operador do estoque).
DROP POLICY IF EXISTS produto_imagens_public_read ON storage.objects;
CREATE POLICY produto_imagens_public_read
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'produto-imagens');

DROP POLICY IF EXISTS produto_imagens_auth_insert ON storage.objects;
CREATE POLICY produto_imagens_auth_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'produto-imagens');

DROP POLICY IF EXISTS produto_imagens_auth_update ON storage.objects;
CREATE POLICY produto_imagens_auth_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'produto-imagens')
  WITH CHECK (bucket_id = 'produto-imagens');

DROP POLICY IF EXISTS produto_imagens_auth_delete ON storage.objects;
CREATE POLICY produto_imagens_auth_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'produto-imagens');
