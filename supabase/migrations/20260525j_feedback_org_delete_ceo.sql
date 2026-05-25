-- =================================================================
-- Permitir CEO fazer soft-delete em feedbacks_organizacao.
--
-- A policy original (20260525d_feedback_organizacional.sql:43) só
-- liberava UPDATE pra `auth_is_admin()`. dbDelete usa UPDATE
-- ativo=false (soft-delete padrão em TABLES_WITH_ATIVO), então CEO
-- não conseguia excluir feedbacks via UI.
--
-- Ajusta pra `auth_user_role() IN ('admin','ceo')`, mantendo
-- consistência com SELECT (que já libera os dois roles).
--
-- DELETE físico segue bloqueado (USING false) — preservamos o
-- histórico para auditoria de feedback abusivo.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "feedback_org_modify" ON feedbacks_organizacao;

CREATE POLICY "feedback_org_modify" ON feedbacks_organizacao
  FOR UPDATE TO authenticated
  USING      (auth_user_role() IN ('admin', 'ceo'))
  WITH CHECK (auth_user_role() IN ('admin', 'ceo'));

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Como CEO logado:
--   UPDATE feedbacks_organizacao SET ativo = false WHERE id = '<uuid>';
--   -- deve afetar 1 linha (antes do fix: 0).
-- =================================================================
