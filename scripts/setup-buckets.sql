-- =================================================================
-- LogMax — Setup dos Storage Buckets (consolidado)
-- =================================================================
-- pg_dump --schema-only NAO traz linhas de storage.buckets (sao dados,
-- nao schema). Este script recria os 4 buckets do LogMax + suas policies
-- em storage.objects, num unico arquivo idempotente.
--
-- Consolida:
--   - 20260518_produto_imagem.sql        → produto-imagens
--   - 20260609_perfil_foto.sql           → perfil-fotos (policies iniciais)
--   - 20260610_perfil_fotos_path_scope.sql → perfil-fotos (policies escopadas por user_id)
--   - 20260623b_caixa_bancos_logo.sql    → banco-logos
--   - 20260630c_categoria_imagem_url.sql → categoria-imagens
--
-- Pre-requisito: helpers auth_in_setor() e auth_is_admin() ja existem
-- (vem no baseline). Se nao vierem, rode antes 20260516_rls_hardening.sql
-- e 20260516_rls_ceo_role.sql.
--
-- Executar no SQL Editor do NOVO projeto Supabase depois do baseline.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1) produto-imagens (120 KB, public, write authenticated)
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'produto-imagens', 'produto-imagens', true, 122880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS produto_imagens_public_read  ON storage.objects;
DROP POLICY IF EXISTS produto_imagens_auth_insert  ON storage.objects;
DROP POLICY IF EXISTS produto_imagens_auth_update  ON storage.objects;
DROP POLICY IF EXISTS produto_imagens_auth_delete  ON storage.objects;

CREATE POLICY produto_imagens_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'produto-imagens');

CREATE POLICY produto_imagens_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'produto-imagens');

CREATE POLICY produto_imagens_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'produto-imagens')
  WITH CHECK (bucket_id = 'produto-imagens');

CREATE POLICY produto_imagens_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'produto-imagens');

-- ─────────────────────────────────────────────
-- 2) perfil-fotos (150 KB, public, write escopado por user_id folder)
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'perfil-fotos', 'perfil-fotos', true, 153600,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS perfil_fotos_public_read  ON storage.objects;
DROP POLICY IF EXISTS perfil_fotos_auth_insert  ON storage.objects;
DROP POLICY IF EXISTS perfil_fotos_auth_update  ON storage.objects;
DROP POLICY IF EXISTS perfil_fotos_auth_delete  ON storage.objects;

CREATE POLICY perfil_fotos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'perfil-fotos');

-- Escopo por user_id: cada authenticated escreve so no proprio path
-- `<auth.uid()>/...`. Client (src/lib/perfilFoto.ts) ja sobe assim.
CREATE POLICY perfil_fotos_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY perfil_fotos_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY perfil_fotos_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────
-- 3) banco-logos (120 KB + SVG, public, write so financeiro)
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'banco-logos', 'banco-logos', true, 122880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "banco_logos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "banco_logos_fin_insert"  ON storage.objects;
DROP POLICY IF EXISTS "banco_logos_fin_update"  ON storage.objects;
DROP POLICY IF EXISTS "banco_logos_fin_delete"  ON storage.objects;

CREATE POLICY "banco_logos_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'banco-logos');

CREATE POLICY "banco_logos_fin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'));

CREATE POLICY "banco_logos_fin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'))
  WITH CHECK (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'));

CREATE POLICY "banco_logos_fin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'banco-logos' AND public.auth_in_setor('financeiro'));

-- ─────────────────────────────────────────────
-- 4) categoria-imagens (1 MB, public, write admin/CEO/logistica)
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'categoria-imagens', 'categoria-imagens', true, 1048576,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "categoria_imagens_select" ON storage.objects;
DROP POLICY IF EXISTS "categoria_imagens_insert" ON storage.objects;
DROP POLICY IF EXISTS "categoria_imagens_update" ON storage.objects;
DROP POLICY IF EXISTS "categoria_imagens_delete" ON storage.objects;

CREATE POLICY "categoria_imagens_select" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'categoria-imagens');

CREATE POLICY "categoria_imagens_insert" ON storage.objects
  FOR INSERT
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

CREATE POLICY "categoria_imagens_update" ON storage.objects
  FOR UPDATE
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

CREATE POLICY "categoria_imagens_delete" ON storage.objects
  FOR DELETE
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

COMMIT;

-- =================================================================
-- VERIFICACAO
--   SELECT id, public, file_size_limit FROM storage.buckets
--    WHERE id IN ('produto-imagens','perfil-fotos','banco-logos','categoria-imagens');
--   -- deve retornar 4 linhas.
-- =================================================================
