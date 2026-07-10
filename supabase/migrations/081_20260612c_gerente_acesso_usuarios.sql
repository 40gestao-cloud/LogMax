-- =================================================================
-- Toggle por gerente: acesso ao módulo Usuários
-- =================================================================
-- Reqs:
--   • Admin/CEO devem poder habilitar/desabilitar individualmente o
--     acesso de cada gerente ao módulo Usuários.
--   • Default true preserva comportamento atual (gerentes existentes
--     continuam vendo o módulo).
--   • Coluna só faz sentido para role='gerente'; é ignorada nas
--     demais roles (admin/CEO/colaborador). RLS não muda — o controle
--     fica na sidebar e nos endpoints /api/{create,update,delete}-user.
--
-- IDEMPOTENTE.
-- =================================================================

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS pode_acessar_usuarios boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_profiles.pode_acessar_usuarios IS
  'Aplica-se a role=gerente: quando false, o gerente perde o acesso ao módulo Usuários (sidebar + endpoints). Admin/CEO ignoram esta coluna.';

COMMIT;
