-- =================================================================
-- LogMax — Hardening de segurança pós-auditoria full-repo (2026-07-27)
-- =================================================================
-- Fecha 4 achados da auditoria:
--
--  1) pix_pendentes: policy `FOR ALL USING(true)` permitia que qualquer
--     authenticated marcasse pix de outra filial como pago/cancelado,
--     travando ou falsificando vendas alheias. Escopar por operador_id.
--
--  2) storage.objects/nota-anexos: INSERT/UPDATE/DELETE sem escopo
--     permitia sobrescrever/apagar NFs fiscais de qualquer filial.
--     Restringe a setor financeiro/logistica (padrão de banco-logos).
--
--  3) storage.objects/produto-imagens: idem — restringe a setores
--     que efetivamente cadastram produtos.
--
--  4) storage.objects/perfil-fotos e max-show-anexos: escopa por
--     path[1] = auth.uid()::text (usuário só mexe no próprio dir).
--
-- Idempotente. Aplicar no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─── 1. pix_pendentes ─────────────────────────────────────────────
-- Remove policy irrestrita e cria 4 policies escopadas.
--
-- Modelo:
--   SELECT/UPDATE/DELETE: operador dono OR admin/CEO
--   INSERT: authenticated, mas força operador_id = auth.uid()
--   (anon já tem policies próprias para simulador, mantidas)
--
-- Front-end existente (PDVView, PDVViewSupermax) já usa
-- .eq('operador_id', user.id) nos UPDATEs de cleanup — funciona
-- sem mudança. Cancelar pix próprio (id conhecido) também passa
-- porque operador_id = auth.uid() na linha em questão.
DROP POLICY IF EXISTS pix_pendentes_auth_all         ON public.pix_pendentes;
DROP POLICY IF EXISTS pix_pendentes_auth_select      ON public.pix_pendentes;
DROP POLICY IF EXISTS pix_pendentes_auth_insert      ON public.pix_pendentes;
DROP POLICY IF EXISTS pix_pendentes_auth_update      ON public.pix_pendentes;
DROP POLICY IF EXISTS pix_pendentes_auth_delete      ON public.pix_pendentes;

CREATE POLICY pix_pendentes_auth_select ON public.pix_pendentes
  FOR SELECT TO authenticated
  USING (operador_id = auth.uid() OR public.auth_is_admin());

CREATE POLICY pix_pendentes_auth_insert ON public.pix_pendentes
  FOR INSERT TO authenticated
  WITH CHECK (operador_id = auth.uid());

CREATE POLICY pix_pendentes_auth_update ON public.pix_pendentes
  FOR UPDATE TO authenticated
  USING      (operador_id = auth.uid() OR public.auth_is_admin())
  WITH CHECK (operador_id = auth.uid() OR public.auth_is_admin());

CREATE POLICY pix_pendentes_auth_delete ON public.pix_pendentes
  FOR DELETE TO authenticated
  USING (operador_id = auth.uid() OR public.auth_is_admin());

-- ─── 2. Storage: nota-anexos ──────────────────────────────────────
-- Escrita restrita a setor financeiro/logistica. SELECT permanece
-- público (bucket é `public: true` — mudar isso quebraria PDFs
-- renderizados via <a href>. Se quiser blindar leitura também,
-- alternar bucket pra privado + usar signed URLs no front).
DROP POLICY IF EXISTS "nota_anexos_write"  ON storage.objects;
DROP POLICY IF EXISTS "nota_anexos_update" ON storage.objects;
DROP POLICY IF EXISTS "nota_anexos_delete" ON storage.objects;

CREATE POLICY "nota_anexos_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nota-anexos' AND public.auth_in_setor('financeiro','logistica'));

CREATE POLICY "nota_anexos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'nota-anexos' AND public.auth_in_setor('financeiro','logistica'))
  WITH CHECK (bucket_id = 'nota-anexos' AND public.auth_in_setor('financeiro','logistica'));

CREATE POLICY "nota_anexos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'nota-anexos' AND public.auth_in_setor('financeiro','logistica'));

-- ─── 3. Storage: produto-imagens ──────────────────────────────────
-- Escrita restrita a setor logistica/vendas (quem cadastra produto).
-- Admin/CEO/gerente já passam por auth_in_setor.
DROP POLICY IF EXISTS produto_imagens_auth_insert ON storage.objects;
DROP POLICY IF EXISTS produto_imagens_auth_update ON storage.objects;
DROP POLICY IF EXISTS produto_imagens_auth_delete ON storage.objects;

CREATE POLICY produto_imagens_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'produto-imagens' AND public.auth_in_setor('logistica','vendas'));

CREATE POLICY produto_imagens_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'produto-imagens' AND public.auth_in_setor('logistica','vendas'))
  WITH CHECK (bucket_id = 'produto-imagens' AND public.auth_in_setor('logistica','vendas'));

CREATE POLICY produto_imagens_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'produto-imagens' AND public.auth_in_setor('logistica','vendas'));

-- ─── 4. Storage: perfil-fotos ─────────────────────────────────────
-- Path convention: <user_id>/<ts>.<ext> (ver src/lib/perfilFoto.ts).
-- Usuário só mexe no PRÓPRIO diretório; admin passa por cima.
DROP POLICY IF EXISTS perfil_fotos_auth_insert ON storage.objects;
DROP POLICY IF EXISTS perfil_fotos_auth_update ON storage.objects;
DROP POLICY IF EXISTS perfil_fotos_auth_delete ON storage.objects;

CREATE POLICY perfil_fotos_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'perfil-fotos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  );

CREATE POLICY perfil_fotos_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'perfil-fotos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  )
  WITH CHECK (
    bucket_id = 'perfil-fotos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  );

CREATE POLICY perfil_fotos_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'perfil-fotos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  );

-- ─── 5. Storage: max-show-anexos ──────────────────────────────────
-- Path convention: <user_id>/<ts>_<nome> (ver src/lib/maxShowUpload.ts).
-- Mesma regra do perfil-fotos.
DROP POLICY IF EXISTS "max_show_anexos_write"  ON storage.objects;
DROP POLICY IF EXISTS "max_show_anexos_update" ON storage.objects;
DROP POLICY IF EXISTS "max_show_anexos_delete" ON storage.objects;

CREATE POLICY "max_show_anexos_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'max-show-anexos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  );

CREATE POLICY "max_show_anexos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'max-show-anexos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  )
  WITH CHECK (
    bucket_id = 'max-show-anexos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  );

CREATE POLICY "max_show_anexos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'max-show-anexos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.auth_is_admin()
    )
  );

COMMIT;
