-- =================================================================
-- Fix #2 "Database error deleting user": user_profiles.criado_por
-- =================================================================
-- Erro real exposto pelo Postgres log:
--   "update or delete on table 'users' violates foreign key constraint
--    'user_profiles_criado_por_fkey' on table 'user_profiles'"
--
-- Causa: o schema original em `user_profiles_table.sql` (raiz, pré
-- supabase/migrations) declarou:
--   criado_por UUID REFERENCES auth.users(id)
-- SEM cláusula ON DELETE → default NO ACTION. Nenhuma migração
-- corrigiu nos últimos meses. Resultado: ao apagar um admin/CEO que
-- criou outros usuários, o cascade quebra porque os "filhos"
-- (user_profiles.criado_por) ainda apontam pra ele.
--
-- Fix: troca pra ON DELETE SET NULL. Os user_profiles criados por
-- esse autor continuam existindo, só perdem o rastro de quem criou
-- (que está sendo apagado mesmo).
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_criado_por_fkey;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_criado_por_fkey
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'user_profiles'::regclass
--      AND conname  = 'user_profiles_criado_por_fkey';
--   -- confdeltype = 'n' (SET NULL).
-- =================================================================
