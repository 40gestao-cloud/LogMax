-- =================================================================
-- Fase 3 — Ponto eletrônico → desconto/bônus automático na folha
-- =================================================================
-- Adiciona `salario_base` em folha_pagamento + colunas agregadas
-- (horas_atraso/falta/extras) + RPC recalcular_folha_do_ponto que
-- consome ponto_eletronico do mês e atualiza descontos e bruto.
--
-- Regra CLT padrão:
--   • valor_hora     = salario_base / 220
--   • atraso         = (entrada - target) > tolerancia → conta minutos
--   • falta          = +8h por dia com status='Falta'
--   • justificado    = 0
--   • hora extra     = horas_trabalhadas - 8 quando status='Hora Extra'
--   • descontos      = (h_atraso + h_falta) * valor_hora
--   • bonus_extra    = h_extra * valor_hora * 1.5
--   • salario_bruto  = salario_base + bonus_extra
--   • salario_liquido = salario_bruto - descontos
--
-- Apenas folhas em status='Pendente' podem ser recalculadas. Folhas
-- em Processada/Paga já produziram efeitos colaterais (contas_pagar,
-- crédito MaxBank) e mudá-las sem reversão dessincroniza.
--
-- Horários da jornada são passados como params (turma varia por
-- instância via env VITE_PONTO_*). Defaults = turma manhã LogMax.
--
-- IDEMPOTENTE: rodar nas 4 instâncias com colaboradores. Skip MaxPOS-PDV.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. Novas colunas em folha_pagamento
-- =================================================================

ALTER TABLE folha_pagamento
  ADD COLUMN IF NOT EXISTS salario_base  numeric(12,2),
  ADD COLUMN IF NOT EXISTS horas_atraso  numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_falta   numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_extras  numeric(5,2) NOT NULL DEFAULT 0;

-- Backfill: salario_base = salario_bruto pros existentes.
UPDATE folha_pagamento
   SET salario_base = salario_bruto
 WHERE salario_base IS NULL;

-- Trigger: novos INSERTs sem salario_base copiam do bruto.
CREATE OR REPLACE FUNCTION folha_pagamento_set_salario_base()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.salario_base IS NULL THEN
    NEW.salario_base := NEW.salario_bruto;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_folha_pagamento_set_salario_base ON folha_pagamento;
CREATE TRIGGER trg_folha_pagamento_set_salario_base
  BEFORE INSERT ON folha_pagamento
  FOR EACH ROW EXECUTE FUNCTION folha_pagamento_set_salario_base();

-- =================================================================
-- 2. RPC recalcular_folha_do_ponto
-- =================================================================

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
      -- nenhum desconto.
      NULL;

    ELSIF r.status = 'Hora Extra' THEN
      -- excedente além de 8h do dia.
      v_horas_extras := v_horas_extras + GREATEST(COALESCE(r.horas_trabalhadas, 0) - 8, 0);
    END IF;

    -- Atraso da entrada (independe de status, mas pula faltas/justificados).
    IF r.entrada IS NOT NULL
       AND r.status NOT IN ('Falta', 'Justificado')
    THEN
      v_atraso_min := EXTRACT(EPOCH FROM (r.entrada - v_target)) / 60.0;
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

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
-- =================================================================
--   -- 1. Backfill aplicado?
--   SELECT count(*) FILTER (WHERE salario_base IS NULL) AS sem_base,
--          count(*) AS total
--     FROM folha_pagamento WHERE COALESCE(ativo, true);
--   -- esperado: sem_base = 0
--
--   -- 2. RPC existe?
--   SELECT proname, pronargs FROM pg_proc
--    WHERE proname = 'recalcular_folha_do_ponto';
--
--   -- 3. Smoke test (folha pendente do mês corrente):
--   --    SELECT recalcular_folha_do_ponto('<folha_id>');
--   -- Retorna jsonb com breakdown; folha tem salario_liquido atualizado.
-- =================================================================
