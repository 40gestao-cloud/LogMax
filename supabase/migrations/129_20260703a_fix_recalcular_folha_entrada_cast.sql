-- Fix: r.entrada é text em ponto_eletronico; subtrair de v_target (time) gerava
-- "operator does not exist: text - time without time zone".
-- Solução: cast explícito r.entrada::time antes da subtração.

CREATE OR REPLACE FUNCTION public.recalcular_folha_do_ponto(
  p_folha_id        uuid,
  p_target_entrada  text DEFAULT '07:40',
  p_target_retorno  text DEFAULT '09:20',
  p_target_saida    text DEFAULT '11:20',
  p_tolerancia_min  int  DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_funcionario_id   uuid;
  v_salario_base     numeric(12,2);
  v_mes_ref          text;
  v_status           text;
  v_valor_hora       numeric;
  v_target           time;
  v_horas_atraso     numeric := 0;
  v_horas_falta      numeric := 0;
  v_horas_extras     numeric := 0;
  v_descontos        numeric;
  v_bonus_extra      numeric;
  v_salario_bruto    numeric;
  v_salario_liquido  numeric;
  v_atraso_min       numeric;
  r                  record;
BEGIN
  -- 1. Lê folha.
  SELECT funcionario_id, COALESCE(salario_base, salario_bruto), mes_ref, status
    INTO v_funcionario_id, v_salario_base, v_mes_ref, v_status
    FROM folha_pagamento
   WHERE id = p_folha_id
     AND COALESCE(ativo, true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada ou inativa: %', p_folha_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Só é possível recalcular folha em status Pendente (atual: %).', v_status;
  END IF;

  IF v_salario_base IS NULL OR v_salario_base <= 0 THEN
    RAISE EXCEPTION 'Salário base inválido (%) — preencha antes de recalcular.', v_salario_base;
  END IF;

  v_valor_hora := v_salario_base / 220.0;
  v_target := (p_target_entrada || ':00')::time;

  -- 2. Agrega ponto_eletronico do mês de referência.
  FOR r IN
    SELECT data, entrada, saida, horas_trabalhadas, status
      FROM ponto_eletronico
     WHERE funcionario_id = v_funcionario_id
       AND to_char(data, 'YYYY-MM') = v_mes_ref
  LOOP
    IF r.status = 'Falta' THEN
      v_horas_falta := v_horas_falta + 8;

    ELSIF r.status = 'Justificado' THEN
      NULL;

    ELSIF r.status = 'Hora Extra' THEN
      v_horas_extras := v_horas_extras + GREATEST(COALESCE(r.horas_trabalhadas, 0) - 8, 0);
    END IF;

    -- Atraso da entrada — cast text→time para permitir subtração.
    IF r.entrada IS NOT NULL
       AND r.status NOT IN ('Falta', 'Justificado')
    THEN
      v_atraso_min := EXTRACT(EPOCH FROM (r.entrada::time - v_target)) / 60.0;
      IF v_atraso_min > p_tolerancia_min THEN
        v_horas_atraso := v_horas_atraso + (v_atraso_min / 60.0);
      END IF;
    END IF;
  END LOOP;

  -- 3. Calcula valores.
  v_descontos       := ROUND((v_horas_atraso + v_horas_falta) * v_valor_hora, 2);
  v_bonus_extra     := ROUND(v_horas_extras * v_valor_hora * 1.5, 2);
  v_salario_bruto   := ROUND(v_salario_base + v_bonus_extra, 2);
  v_salario_liquido := ROUND(v_salario_bruto - v_descontos, 2);

  -- 4. Persiste.
  UPDATE folha_pagamento
     SET salario_bruto   = v_salario_bruto,
         descontos       = v_descontos,
         salario_liquido = v_salario_liquido,
         horas_atraso    = ROUND(v_horas_atraso, 2),
         horas_falta     = v_horas_falta,
         horas_extras    = v_horas_extras
   WHERE id = p_folha_id;

  -- 5. Retorna breakdown pra UI exibir.
  RETURN jsonb_build_object(
    'valor_hora',      ROUND(v_valor_hora, 2),
    'horas_atraso',    ROUND(v_horas_atraso, 2),
    'horas_falta',     v_horas_falta,
    'horas_extras',    v_horas_extras,
    'descontos',       v_descontos,
    'bonus_extra',     v_bonus_extra,
    'salario_base',    v_salario_base,
    'salario_bruto',   v_salario_bruto,
    'salario_liquido', v_salario_liquido
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_folha_do_ponto(uuid, text, text, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.recalcular_folha_do_ponto(uuid, text, text, text, int) TO authenticated;
