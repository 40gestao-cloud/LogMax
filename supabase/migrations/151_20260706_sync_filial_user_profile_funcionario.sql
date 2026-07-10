-- =================================================================
-- Sincronização de filial entre user_profiles e funcionarios.
--
-- Problema: cadastrar um usuário com filial='MaxLook' via UsuariosView
-- criava o user_profile mas NÃO refletia no funcionário vinculado
-- (mesmo com trigger de autovincular por email). Resultado: usuário
-- MaxLook aparecia na Frequência de Trabalho da SuperMax porque o
-- funcionário ficava com o DEFAULT 'SuperMax'.
--
-- Solução: dois triggers.
--   1. Ao criar/atualizar user_profiles.filial → propaga para o
--      funcionario vinculado (por user_profile_id ou por email).
--   2. Ao autovincular funcionário → também copia a filial do
--      user_profile no mesmo momento.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Propaga filial do user_profile para o funcionário vinculado ─────
CREATE OR REPLACE FUNCTION public.user_profiles_propagar_filial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.filial IS NULL THEN
    RETURN NEW;
  END IF;

  -- Match preferencial por user_profile_id (mais confiável); fallback por email.
  UPDATE public.funcionarios f
     SET filial = NEW.filial
   WHERE (f.user_profile_id = NEW.id
          OR (f.user_profile_id IS NULL
              AND f.email IS NOT NULL
              AND lower(f.email) = lower(NEW.email)))
     AND (f.filial IS DISTINCT FROM NEW.filial);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_propagar_filial ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_propagar_filial
  AFTER INSERT OR UPDATE OF filial, email ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.user_profiles_propagar_filial();

-- ── 2. Atualiza trigger de autovincular para também sincronizar filial ─
--    Ao criar/editar funcionário, se ele é linkado a um user_profile
--    existente, copia a filial de lá — não deixa o DEFAULT 'SuperMax'
--    sobrescrever a filial correta do usuário.
CREATE OR REPLACE FUNCTION public.funcionarios_autovincular_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_profile record;
BEGIN
  IF NEW.user_profile_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT id, filial INTO matched_profile
      FROM public.user_profiles
     WHERE lower(email) = lower(NEW.email)
     LIMIT 1;
    IF FOUND THEN
      NEW.user_profile_id := matched_profile.id;
      -- Só sobrescreve se o user_profile tem filial definida.
      IF matched_profile.filial IS NOT NULL THEN
        NEW.filial := matched_profile.filial;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger já existe pela migration 20260605b — apenas garantimos que aponte
-- para a função atualizada. DROP + CREATE é idempotente.
DROP TRIGGER IF EXISTS trg_funcionarios_autovincular ON public.funcionarios;
CREATE TRIGGER trg_funcionarios_autovincular
  BEFORE INSERT OR UPDATE OF email ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.funcionarios_autovincular_user_profile();

-- ── 3. Backfill: sincroniza registros existentes ───────────────────────
--    Corrige o estado atual: todo funcionário vinculado a user_profile
--    passa a ter a filial do user_profile. Sem isso, os funcionários já
--    cadastrados continuariam órfãos.
UPDATE public.funcionarios f
   SET filial = up.filial
  FROM public.user_profiles up
 WHERE f.user_profile_id = up.id
   AND up.filial IS NOT NULL
   AND f.filial IS DISTINCT FROM up.filial;

COMMIT;
