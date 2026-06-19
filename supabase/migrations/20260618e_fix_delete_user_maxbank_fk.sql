-- =================================================================
-- Fix: "Database error deleting user" ao excluir usuário do sistema
-- =================================================================
-- Causa raiz:
--   maxbank_transacoes.created_by foi declarado em 20260605_maxbank_carteira.sql
--   como `uuid REFERENCES auth.users(id)` — SEM cláusula ON DELETE.
--   Default do Postgres = NO ACTION (equivalente a RESTRICT).
--   Toda transação MaxBank carrega o autor; ao tentar apagar o usuário,
--   admin.auth.deleteUser() falha com "Database error deleting user".
--
-- Fix: troca pra ON DELETE SET NULL — preserva a transação histórica
-- (saldo + extrato continuam consistentes), perde apenas a referência
-- ao autor (que está sendo apagado mesmo).
--
-- Padrão segue o resto do projeto: 100% dos demais REFERENCES auth.users(id)
-- já estão com ON DELETE SET NULL (auditoria preservada, FK não bloqueia).
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE maxbank_transacoes
  DROP CONSTRAINT IF EXISTS maxbank_transacoes_created_by_fkey;

ALTER TABLE maxbank_transacoes
  ADD CONSTRAINT maxbank_transacoes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'maxbank_transacoes'::regclass
--      AND conname  = 'maxbank_transacoes_created_by_fkey';
--   -- confdeltype = 'n' (SET NULL). Antes era 'a' (NO ACTION).
-- =================================================================
