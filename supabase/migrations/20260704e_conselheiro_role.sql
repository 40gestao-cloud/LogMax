-- Adiciona role 'conselheiro' e coluna is_conselheiro para gerentes com acesso amplo.
--
-- Regras:
--   • role='conselheiro' → acesso igual a admin/CEO em RLS (auth_is_admin passa).
--   • role='gerente' + is_conselheiro=true → idem.
--   • auth_is_admin() continua sendo o único guard de escrita em tabelas sensíveis;
--     'admin' puro é o único que pode criar/editar outros admins (sem mudança).

-- 1. Adiciona coluna
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_conselheiro boolean NOT NULL DEFAULT false;

-- 2. Atualiza CHECK de role (idempotente: drop+add)
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'ceo', 'gerente', 'colaborador', 'conselheiro'));

-- 3. Atualiza auth_is_admin para incluir conselheiro e gerente+is_conselheiro
CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth_user_role() IN ('admin', 'ceo', 'conselheiro')
      OR EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role = 'gerente'
          AND is_conselheiro = true
      );
$$;

-- 4. Atualiza RPC que verifica role (justificativas de falta e afins)
--    Adiciona 'conselheiro' onde 'ceo' já era aceito como justificador.
ALTER TABLE public.justificativas_falta
  DROP CONSTRAINT IF EXISTS chk_justfalta_role;

ALTER TABLE public.justificativas_falta
  ADD CONSTRAINT chk_justfalta_role
  CHECK (role_criador IN ('colaborador', 'gerente', 'ceo', 'admin', 'conselheiro'));

-- 5. Atualiza feedback_destinatarios (se existir a coluna destinatarios_roles)
--    A política RLS já usará auth_is_admin() que agora inclui conselheiro;
--    nenhuma outra mudança de política é necessária.
