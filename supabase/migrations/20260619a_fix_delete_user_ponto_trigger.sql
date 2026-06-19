-- =================================================================
-- Fix #3 "Database error deleting user": fn_recompute_ponto_eletronico_after_delete
-- =================================================================
-- Erro real exposto pelo Postgres log (sql_state 42P01):
--   relation "user_profiles" does not exist
--   CONTEXT: PL/pgSQL function public.fn_recompute_ponto_eletronico_after_delete() line 8
--   internal_query: SELECT funcionario_id FROM user_profiles WHERE id = OLD.user_id
--   user_name: supabase_auth_admin
--
-- Causa: 20260525k_ponto_delete_admin_ceo.sql criou a função
-- `fn_recompute_ponto_eletronico_after_delete()` com SECURITY DEFINER
-- mas SEM `SET search_path` e referenciando `user_profiles`,
-- `ponto_qr_registros` e `ponto_eletronico` sem o prefixo `public.`.
-- O role `supabase_auth_admin` (GoTrue) tem search_path mais restrito,
-- então quando ele apaga `auth.users` → CASCADE pra `ponto_qr_registros`
-- → AFTER DELETE dispara a trigger → função quebra porque não acha
-- `user_profiles` no search_path corrente.
--
-- Fix: CREATE OR REPLACE com `SET search_path = public, pg_temp`
-- e qualificação explícita das 3 tabelas com `public.`. Mantém a
-- mesma lógica de recompute.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_recompute_ponto_eletronico_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_func_id  UUID;
  v_data     DATE;
  v_entrada  TIME;
  v_saida    TIME;
BEGIN
  SELECT funcionario_id INTO v_func_id
  FROM public.user_profiles WHERE id = OLD.user_id;

  IF v_func_id IS NULL THEN
    RETURN OLD;
  END IF;

  v_data := (OLD.registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE;

  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_entrada
    FROM public.ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'entrada'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em
   LIMIT 1;

  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_saida
    FROM public.ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'saida'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em DESC
   LIMIT 1;

  IF v_entrada IS NULL AND v_saida IS NULL THEN
    DELETE FROM public.ponto_eletronico
     WHERE funcionario_id = v_func_id AND data = v_data;
  ELSE
    UPDATE public.ponto_eletronico
       SET entrada = v_entrada,
           saida   = v_saida,
           horas_trabalhadas = CASE
             WHEN v_entrada IS NOT NULL AND v_saida IS NOT NULL
             THEN ROUND(EXTRACT(EPOCH FROM (v_saida - v_entrada)) / 3600.0, 2)
             ELSE 0
           END,
           status = CASE
             WHEN v_entrada IS NOT NULL AND v_saida IS NOT NULL
                  AND EXTRACT(EPOCH FROM (v_saida - v_entrada)) / 3600.0 > 9
             THEN 'Hora Extra'
             ELSE 'Normal'
           END
     WHERE funcionario_id = v_func_id AND data = v_data;
  END IF;

  RETURN OLD;
END;
$$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT p.proname, p.proconfig
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname = 'fn_recompute_ponto_eletronico_after_delete';
--   -- proconfig deve incluir {search_path=public, pg_temp}
--
-- Depois: tenta excluir o usuário no LogMax. Deve passar.
-- =================================================================
