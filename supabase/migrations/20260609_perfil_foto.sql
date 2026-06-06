-- =================================================================
-- LogMax — Foto de perfil do colaborador (storage + foto_url)
-- =================================================================
-- Permite admin/CEO/gerente/colaborador subir 1 foto pra própria conta.
-- Mesmo padrão de produto-imagens (20260518): bucket público + leitura
-- anônima, gravação só pra authenticated. Tamanho limite duro de 150 KB
-- (segunda linha de defesa — validação principal é client-side em
-- src/lib/perfilFoto.ts).
--
-- Storage policies são por bucket — não por usuário — então qualquer
-- authenticated pode subir/sobrescrever. A política de quem edita o
-- foto_url de cada user_profile é controlada pela RLS de user_profiles
-- (já em produção: dono edita o próprio; admin/CEO edita qualquer um).
--
-- IDEMPOTENTE. Rodar nas 4 instâncias com colaboradores (LogMax ERP,
-- Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS-PDV (sem
-- user_profiles).
-- =================================================================

-- 1) Coluna na tabela user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS foto_url text;

-- 2) Bucket público com limite duro de 150 KB.
--    Foto de perfil pode ser um pouco maior que thumb de produto
--    (rosto em jpeg comprimido a 150 KB já dá qualidade boa).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'perfil-fotos',
  'perfil-fotos',
  true,
  153600, -- 150 KB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3) Policies de storage.objects para perfil-fotos.
--    Leitura: anônima (avatar aparece pra todo mundo que vê seu nome).
--    Escrita: authenticated.
DROP POLICY IF EXISTS perfil_fotos_public_read ON storage.objects;
CREATE POLICY perfil_fotos_public_read
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'perfil-fotos');

DROP POLICY IF EXISTS perfil_fotos_auth_insert ON storage.objects;
CREATE POLICY perfil_fotos_auth_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'perfil-fotos');

DROP POLICY IF EXISTS perfil_fotos_auth_update ON storage.objects;
CREATE POLICY perfil_fotos_auth_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'perfil-fotos')
  WITH CHECK (bucket_id = 'perfil-fotos');

DROP POLICY IF EXISTS perfil_fotos_auth_delete ON storage.objects;
CREATE POLICY perfil_fotos_auth_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'perfil-fotos');
