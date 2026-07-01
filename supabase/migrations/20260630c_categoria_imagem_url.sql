-- Adiciona imagem_url em categorias e subcategorias de produto.
-- O bucket 'categoria-imagens' deve ser criado manualmente no Supabase Dashboard
-- (Storage → New bucket → nome: categoria-imagens, Public: true).

ALTER TABLE public.categorias_produto
  ADD COLUMN IF NOT EXISTS imagem_url text;

ALTER TABLE public.subcategorias_produto
  ADD COLUMN IF NOT EXISTS imagem_url text;

-- Políticas de storage para o bucket categoria-imagens
-- (execute após criar o bucket no dashboard)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'categoria-imagens',
  'categoria-imagens',
  true,
  1048576,  -- 1 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public            = true,
  file_size_limit   = 1048576,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/svg+xml'];

-- Leitura pública
CREATE POLICY IF NOT EXISTS "categoria_imagens_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'categoria-imagens');

-- Upload: logística + admin/CEO
CREATE POLICY IF NOT EXISTS "categoria_imagens_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'categoria-imagens'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'logistica'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['logistica']))
    )
  );

-- Atualizar/substituir: mesma restrição
CREATE POLICY IF NOT EXISTS "categoria_imagens_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'categoria-imagens'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'logistica'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['logistica']))
    )
  );

-- Remover imagem antiga: admin/CEO + logística
CREATE POLICY IF NOT EXISTS "categoria_imagens_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'categoria-imagens'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'logistica'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['logistica']))
    )
  );
