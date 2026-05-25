-- =================================================================
-- TI Chamados: RLS passa a suportar multi-setor.
--
-- As policies de `20260520_ti_setor_responsavel.sql` usavam
-- `auth_user_setor() = 'ti'` (só primário). Após o multi-setor
-- (20260525_multi_setor.sql), gerentes/colaboradores com TI como
-- setor extra deixaram de conseguir ler/atualizar chamados de TI.
--
-- Troca para `auth_in_setor('ti')`, que considera primary + extras
-- via overlap (&&) com `auth_user_setores()`.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "ti_chamados_read"   ON ti_chamados;
DROP POLICY IF EXISTS "ti_chamados_modify" ON ti_chamados;
DROP POLICY IF EXISTS "ti_chamados_delete" ON ti_chamados;

-- SELECT: criador + setor TI (primário ou extra) + admin/CEO.
CREATE POLICY "ti_chamados_read" ON ti_chamados
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR auth_in_setor('ti')
    OR criado_por = auth.uid()
  );

-- UPDATE: setor TI (primário ou extra) + admin/CEO.
CREATE POLICY "ti_chamados_modify" ON ti_chamados
  FOR UPDATE TO authenticated
  USING      (auth_is_admin() OR auth_in_setor('ti'))
  WITH CHECK (auth_is_admin() OR auth_in_setor('ti'));

-- DELETE segue restrito a admin/CEO (sem alteração semântica).
CREATE POLICY "ti_chamados_delete" ON ti_chamados
  FOR DELETE TO authenticated
  USING (auth_is_admin());

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como gerente Vendas com setores_extras='{ti}':
--   SELECT auth_user_setores();   -- {vendas,ti}
--   SELECT auth_in_setor('ti');   -- true
--   SELECT count(*) FROM ti_chamados;  -- vê todos (antes: só os próprios)
-- =================================================================
