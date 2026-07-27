-- =================================================================
-- LogMax — Bloqueio de escalada de privilégio via UPDATE direto em
--          user_profiles (2026-07-27)
-- =================================================================
-- CONTEXTO
-- --------
-- A policy `up_update_own_or_admin` (migr. 010) permite UPDATE quando
-- `id = auth.uid() OR auth_is_admin()`. Sem trigger de validação, isso
-- deixa qualquer usuário autenticado alterar seu PRÓPRIO perfil via SDK
-- do browser, incluindo campos sensíveis como `role`. Um colaborador
-- pode virar admin com uma linha no console F12:
--
--   supabase.from('user_profiles').update({ role:'admin' }).eq('id', uid)
--
-- FIX
-- ---
-- Trigger BEFORE UPDATE que rejeita mudança dos campos que definem
-- privilégio, EXCETO quando quem faz o UPDATE é o service_role
-- (endpoint `/api/users` usa service_role e continua funcionando).
--
-- Campos protegidos:
--   role, setor, setores_extras, filial,
--   is_conselheiro, pode_acessar_usuarios, criado_por
--
-- Detecção do service_role: `current_setting('request.jwt.claims', true)`
-- devolve JSON com `role` = 'service_role' quando a request veio via
-- service key (bypass RLS ativo). Também aceitamos ausência total do
-- setting como service_role (SQL Editor manual do dono do projeto).
--
-- Idempotente. Aplicar no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─── 1. Helper: caller é service_role? ────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_is_service_role()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims text;
  jwt_role text;
BEGIN
  claims := current_setting('request.jwt.claims', true);
  -- Sem claims (SQL Editor direto do dono, migrations, jobs internos):
  -- tratamos como bypass. RLS só rodaria via PostgREST/anon/authenticated.
  IF claims IS NULL OR claims = '' THEN
    RETURN true;
  END IF;
  jwt_role := (claims::jsonb ->> 'role');
  RETURN jwt_role = 'service_role';
EXCEPTION WHEN OTHERS THEN
  -- Se JSON malformado ou setting fora do contexto de request, bypass.
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.auth_is_service_role() FROM public;
GRANT EXECUTE ON FUNCTION public.auth_is_service_role() TO authenticated, anon;

-- ─── 2. Trigger BEFORE UPDATE em user_profiles ────────────────────
CREATE OR REPLACE FUNCTION public.user_profiles_bloquear_privesc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role (endpoint /api/users) passa livre.
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Compara campos sensíveis; se algum mudou, rejeita.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Alteração de role bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  IF NEW.setor IS DISTINCT FROM OLD.setor THEN
    RAISE EXCEPTION 'Alteração de setor bloqueada — use /api/users (admin/CEO/gerente).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.setores_extras IS DISTINCT FROM OLD.setores_extras THEN
    RAISE EXCEPTION 'Alteração de setores_extras bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.filial IS DISTINCT FROM OLD.filial THEN
    RAISE EXCEPTION 'Alteração de filial bloqueada — use /api/users.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_conselheiro IS DISTINCT FROM OLD.is_conselheiro THEN
    RAISE EXCEPTION 'Alteração de is_conselheiro bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.pode_acessar_usuarios IS DISTINCT FROM OLD.pode_acessar_usuarios THEN
    RAISE EXCEPTION 'Alteração de pode_acessar_usuarios bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.criado_por IS DISTINCT FROM OLD.criado_por THEN
    RAISE EXCEPTION 'Alteração de criado_por bloqueada.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_bloquear_privesc ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_bloquear_privesc
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.user_profiles_bloquear_privesc();

-- ─── 3. Também bloqueia INSERT via SDK ────────────────────────────
-- A policy da migr. 010 comenta "INSERT só por service_role" mas não
-- existe policy INSERT em user_profiles. Sem INSERT policy, INSERT
-- direto por authenticated JÁ é bloqueado (RLS default deny). Só
-- reforça: se alguém adicionar policy INSERT no futuro, o trigger
-- barra criar linha nova sem role coerente.
-- (Reforço não implementado aqui — INSERT via SDK continua bloqueado
--  por falta de policy, que é o estado seguro.)

-- ─── 4. Teste de fumaça (comentado — rodar manual pra validar) ────
-- SET LOCAL role = authenticated;
-- SET LOCAL request.jwt.claim.sub = '<uuid_de_um_colaborador>';
-- UPDATE user_profiles SET role='admin' WHERE id = '<uuid_de_um_colaborador>';
-- Deve retornar: ERROR:  Alteração de role bloqueada — use /api/users (admin).

COMMIT;
