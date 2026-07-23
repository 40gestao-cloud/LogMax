-- =================================================================
-- Convergência final: adiciona comentário faltando em `fn_recompute
-- _ponto_eletronico_after_delete` no projeto ERP.
--
-- A migração 242 recriou a fn a partir das outras 3, mas omitiu por
-- descuido a linha `-- Re-deriva entrada/saida dos registros
-- restantes do dia.` — única diferença que sobrou no hash-check.
--
-- APLICAR SOMENTE NO PROJETO LogMax-ERP (ref jvqsaccupxkvezriiede).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_recompute_ponto_eletronico_after_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_func_id  UUID;
  v_data     DATE;
  v_entrada  TIME;
  v_saida    TIME;
BEGIN
  SELECT funcionario_id INTO v_func_id
  FROM user_profiles WHERE id = OLD.user_id;

  IF v_func_id IS NULL THEN
    RETURN OLD;
  END IF;

  v_data := (OLD.registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE;

  -- Re-deriva entrada/saida dos registros restantes do dia.
  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_entrada
    FROM ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'entrada'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em
   LIMIT 1;

  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_saida
    FROM ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'saida'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em DESC
   LIMIT 1;

  IF v_entrada IS NULL AND v_saida IS NULL THEN
    DELETE FROM ponto_eletronico
     WHERE funcionario_id = v_func_id AND data = v_data;
  ELSE
    UPDATE ponto_eletronico
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
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
