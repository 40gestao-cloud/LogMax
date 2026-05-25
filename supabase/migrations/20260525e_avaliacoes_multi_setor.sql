-- =================================================================
-- Avaliações: gerente enxerga avaliações de colaboradores de TODOS
-- seus setores (primário + extras). Antes a RLS usava `auth_user_setor()`
-- (só primário), o que excluía os colaboradores dos setores extras.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "avaliacoes_read" ON avaliacoes;

CREATE POLICY "avaliacoes_read" ON avaliacoes
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR avaliador_id = auth.uid()
    OR avaliado_id = auth.uid()
    OR (
      auth_user_role() = 'gerente'
      AND avaliado_id IN (
        SELECT id FROM user_profiles
         WHERE setor = ANY(auth_user_setores())
      )
    )
  );

COMMIT;
