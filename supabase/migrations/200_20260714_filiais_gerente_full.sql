-- =====================================================================
-- Regra canônica "gerente faz tudo na própria filial" agora inclui
-- CREATE e DELETE em public.filiais (antes só UPDATE — a 187 travou
-- INSERT/DELETE em admin-only). Restringimos ao nicho do gerente pra
-- ninguém criar/apagar filial de outra unidade.
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS "filiais_insert" ON public.filiais;
CREATE POLICY "filiais_insert" ON public.filiais FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_admin()
    OR auth_gerente_da(COALESCE(detalhes->>'nicho', 'Matriz'))
  );

DROP POLICY IF EXISTS "filiais_delete" ON public.filiais;
CREATE POLICY "filiais_delete" ON public.filiais FOR DELETE TO authenticated
  USING (
    auth_is_admin()
    OR auth_gerente_da(COALESCE(detalhes->>'nicho', 'Matriz'))
  );

COMMIT;
