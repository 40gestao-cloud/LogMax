-- Adiciona imagem_url em categorias e subcategorias de produto.
-- ATENÇÃO: crie o bucket 'categoria-imagens' manualmente no Supabase Dashboard
-- (Storage → New bucket → nome: categoria-imagens, Public: true) ANTES de rodar este script.

ALTER TABLE public.categorias_produto
  ADD COLUMN IF NOT EXISTS imagem_url text;

ALTER TABLE public.subcategorias_produto
  ADD COLUMN IF NOT EXISTS imagem_url text;

-- Bucket via SQL (idempotente)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'categoria-imagens',
  'categoria-imagens',
  true,
  1048576,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 1048576,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp'];

-- Storage policies (DROP antes de criar para ser idempotente)
DROP POLICY IF EXISTS "categoria_imagens_select" ON storage.objects;
DROP POLICY IF EXISTS "categoria_imagens_insert" ON storage.objects;
DROP POLICY IF EXISTS "categoria_imagens_update" ON storage.objects;
DROP POLICY IF EXISTS "categoria_imagens_delete" ON storage.objects;

CREATE POLICY "categoria_imagens_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'categoria-imagens');

CREATE POLICY "categoria_imagens_insert"
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

CREATE POLICY "categoria_imagens_update"
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

CREATE POLICY "categoria_imagens_delete"
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
