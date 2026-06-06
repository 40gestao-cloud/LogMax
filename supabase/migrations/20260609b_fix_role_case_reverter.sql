-- =================================================================
-- MaxBank — Fix case do role no gate de reversão (CEO → ceo)
-- =================================================================
-- Bug encontrado em 2026-06-06 na auditoria:
--   _maxbank_pode_reverter (criado em 20260608b) checa
--     IF v_role IN ('admin', 'CEO') THEN
--   Mas o banco grava role em minúsculo ('ceo') — todo o restante do
--   código (frontend + 20+ migrations) usa 'ceo'. CEO ficava bloqueado
--   das 3 RPCs admin do MaxBank (reverter_folha_maxbank,
--   excluir_transacao_maxbank, recompute_saldos_maxbank) com mensagem
--   "Apenas admin, CEO ou RH podem reverter".
--
-- Fix: substitui o helper com 'ceo' minúsculo. CREATE OR REPLACE — não
-- mexe nas 3 RPCs (que continuam chamando o helper).
--
-- IDEMPOTENTE. Rodar nas 4 instâncias com colaboradores (LogMax ERP,
-- Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS-PDV.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._maxbank_pode_reverter()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role           text;
  v_setor          text;
  v_setores_extras text[];
BEGIN
  SELECT role, setor, COALESCE(setores_extras, ARRAY[]::text[])
    INTO v_role, v_setor, v_setores_extras
    FROM user_profiles
   WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_role IN ('admin', 'ceo') THEN
    RETURN true;
  END IF;

  IF v_setor = 'rh' OR 'rh' = ANY(v_setores_extras) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._maxbank_pode_reverter() FROM public;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
-- =================================================================
--   -- Logado como CEO, deve retornar true:
--   SELECT _maxbank_pode_reverter();
-- =================================================================
