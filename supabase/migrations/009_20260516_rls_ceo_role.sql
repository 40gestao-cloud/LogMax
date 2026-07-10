-- =================================================================
-- LogMax — Fix RLS: role CEO recupera acesso (delta sobre hardening)
-- =================================================================
-- Pré-requisito: 20260516_rls_hardening.sql já aplicado.
--
-- Problema:
--   O hardening anterior define `auth_is_admin()` matching apenas
--   `role = 'admin'`. Quando o role 'ceo' foi introduzido nesta
--   sessão (commit 51da986), CEOs autenticados ficaram bloqueados
--   de ler/escrever em todas as tabelas protegidas — `auth_in_setor()`
--   só passa para admin OU para quem está no setor da policy, e CEO
--   tem `setor='all'` (que não casa com setores específicos).
--
-- Fix:
--   1) Promove 'ceo' a admin-equivalente em `auth_is_admin()`. Como
--      essa função é chamada em ~30 policies via `auth_in_setor()`,
--      atualizar o helper propaga para todas sem tocar nelas.
--   2) Re-escreve `configuracoes.admin_write` (estava com check inline
--      `role='admin'`) usando `auth_is_admin()` para cobertura uniforme.
--   3) Garante `setor='all'` em qualquer CEO existente, por consistência.
--
-- Diferenciação admin vs ceo continua nos endpoints serverless
-- (api/create-user só admin cria outro admin, etc.).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- 1) Helper: 'ceo' passa a equivaler a 'admin' para fins de RLS.
CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth_user_role() IN ('admin', 'ceo');
$$;

COMMENT ON FUNCTION public.auth_is_admin() IS
  'Retorna true se o usuário é admin OU ceo. CEO é admin-equivalente '
  'para RLS (vê e escreve em todas as tabelas). Diferenciação entre '
  'admin/ceo permanece nos endpoints serverless (api/create-user, '
  'api/delete-user) onde discriminação fina importa.';

-- 2) configuracoes: troca check inline por chamada ao helper.
DROP POLICY IF EXISTS "admin_write" ON configuracoes;
CREATE POLICY "admin_write" ON configuracoes
  FOR ALL TO authenticated
  USING (auth_is_admin())
  WITH CHECK (auth_is_admin());

-- 3) Consistência: força setor='all' em qualquer CEO existente.
--    O frontend já faz isso desde commit 51da986 mas usuários
--    criados antes podem estar inconsistentes.
DO $$
DECLARE
  fixed_count int;
BEGIN
  UPDATE user_profiles SET setor = 'all'
   WHERE role = 'ceo' AND setor IS DISTINCT FROM 'all';
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  IF fixed_count > 0 THEN
    RAISE NOTICE 'Corrigido setor=all em % CEO(s) inconsistente(s).', fixed_count;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
-- Logado como CEO, deve retornar:
--   SELECT auth_user_role();   -- 'ceo'
--   SELECT auth_is_admin();    -- true
--   SELECT count(*) FROM vendas;          -- contagem real
--   SELECT count(*) FROM contas_receber;  -- contagem real
--   SELECT count(*) FROM requisicoes;     -- contagem real
-- =================================================================
