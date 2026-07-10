-- =================================================================
-- LogMax — Escopa as policies do bucket perfil-fotos por user_id
-- =================================================================
-- Fix do gap apontado na auditoria de 2026-06-07: a migration original
-- (20260609_perfil_foto.sql) deixou as policies abertas — qualquer
-- authenticated podia subir/sobrescrever/apagar qualquer foto. RLS de
-- user_profiles protegia o foto_url, mas um usuário malicioso ainda
-- podia sobrescrever a imagem física de outro via API direta.
--
-- Fix: amarra INSERT/UPDATE/DELETE ao path `<auth.uid()>/...`. O client
-- já sobe assim (src/lib/perfilFoto.ts:49 — `${userId}/${Date.now()}.${ext}`),
-- então não precisa nenhuma mudança no frontend.
--
-- Leitura segue pública (avatar aparece pra todo mundo que vê o perfil).
--
-- IDEMPOTENTE. Rodar nas 4 instâncias com colaboradores (ERP, Contabilidade,
-- Aprendiz, ADM). NÃO rodar no MaxPOS-PDV (sem user_profiles, sem foto).
-- =================================================================

BEGIN;

-- INSERT: só o dono escreve no próprio path.
DROP POLICY IF EXISTS perfil_fotos_auth_insert ON storage.objects;
CREATE POLICY perfil_fotos_auth_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: idem (na prática o client não usa UPDATE — upsert:false +
-- DELETE da antiga; mas trancamos por defesa em profundidade).
DROP POLICY IF EXISTS perfil_fotos_auth_update ON storage.objects;
CREATE POLICY perfil_fotos_auth_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: só o dono apaga o próprio path. removerFotoPerfilAntiga
-- (src/lib/perfilFoto.ts:66) só apaga foto antiga do próprio user,
-- então continua funcionando.
DROP POLICY IF EXISTS perfil_fotos_auth_delete ON storage.objects;
CREATE POLICY perfil_fotos_auth_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'perfil-fotos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura segue pública — sem mudança.
-- (perfil_fotos_public_read continua como veio em 20260609_perfil_foto.sql)

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
-- =================================================================
--   -- Logado como user A, tentar subir em path do user B deve falhar:
--   --   storage upload em 'perfil-fotos/<uid_B>/teste.png' → 403/RLS.
--
--   -- Logado como user A subindo no próprio path segue OK:
--   --   storage upload em 'perfil-fotos/<uid_A>/2026....png' → 200.
-- =================================================================
