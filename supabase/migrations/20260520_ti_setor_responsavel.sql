-- =================================================================
-- LogMax — TI passa a ser setor com responsável próprio
-- =================================================================
-- Refinamento de 2026-05-20: TI agora é um setor (igual aos demais)
-- com um único responsável cadastrado em user_profiles.setor = 'ti'.
--
--   - SELECT em ti_chamados: criador OU usuário do setor 'ti' OU admin/CEO
--   - UPDATE/DELETE em ti_chamados: setor 'ti' OU admin/CEO
--   - notificar_setor passa a aceitar destino 'ti' (já estava no CHECK)
--
-- Execute no Supabase SQL Editor (idempotente).
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. SELECT mais restrito: só vê chamados que abriu, ou se for TI/admin
-- ─────────────────────────────────────────────

DROP POLICY IF EXISTS "ti_chamados_read"   ON ti_chamados;
DROP POLICY IF EXISTS "ti_chamados_modify" ON ti_chamados;
DROP POLICY IF EXISTS "ti_chamados_delete" ON ti_chamados;

CREATE POLICY "ti_chamados_read" ON ti_chamados
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR auth_user_setor() = 'ti'
    OR criado_por = auth.uid()
  );

-- UPDATE: setor 'ti' OU admin/CEO
CREATE POLICY "ti_chamados_modify" ON ti_chamados
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_user_setor() = 'ti')
  WITH CHECK (auth_is_admin() OR auth_user_setor() = 'ti');

-- DELETE: só admin/CEO
CREATE POLICY "ti_chamados_delete" ON ti_chamados
  FOR DELETE TO authenticated
  USING (auth_is_admin());

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   1) Promover um user para TI:
--      UPDATE user_profiles SET setor = 'ti' WHERE email = '<email>';
--   2) Como esse user logado:  SELECT count(*) FROM ti_chamados;
--      → vê todos os chamados, não só os próprios.
--   3) Como user de outro setor (ex.: financeiro):
--      SELECT count(*) FROM ti_chamados;
--      → vê apenas os chamados que ele mesmo criou.
-- =================================================================
