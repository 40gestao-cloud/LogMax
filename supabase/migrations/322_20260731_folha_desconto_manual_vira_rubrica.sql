-- 322 — O desconto lançado à mão sobrevive ao recálculo.
--
-- O BUG. O formulário de Folha tem um campo "Descontos (R$)" que grava direto
-- em `folha_pagamento.descontos`. Desde a 320, o recálculo DERIVA `descontos`
-- da soma das rubricas — e nenhuma rubrica representa esse lançamento manual.
-- Resultado: digitar um desconto e depois clicar em Recalcular do Ponto
-- apagava o valor, silenciosamente.
--
-- Antes da 320 o sintoma era o mesmo (o recálculo sobrescrevia `descontos`),
-- mas passava despercebido porque não havia holerite para conferir. Agora o
-- holerite deixaria um buraco visível.
--
-- A CORREÇÃO. O lançamento manual ganha coluna própria — `desconto_manual` —
-- em vez de viver dentro do total. Assim o recálculo consegue reemitir a
-- rubrica 199 em vez de descobrir tarde demais que o total tinha uma parcela
-- que ele não sabia explicar.
--
-- NÃO reduz base de INSS/IRRF/FGTS: um desconto genérico (vale-transporte,
-- adiantamento, plano) é retenção sobre o líquido, não redução de
-- remuneração. Por isso os quatro flags saem `false`.
--
-- IDEMPOTENTE. Depende da 320. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Coluna
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.folha_pagamento
  ADD COLUMN IF NOT EXISTS desconto_manual numeric(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.folha_pagamento.desconto_manual IS
  'Desconto lançado à mão no formulário. Vira rubrica 199 no recálculo; não reduz base de INSS/IRRF/FGTS.';

-- Backfill: o que sobra do total depois de tirar faltas, INSS e IRRF só pode
-- ter vindo do campo manual. Mesma conta que a 320 usou para criar a rubrica
-- 199 no histórico — aqui ela vira dado em vez de ficar só na rubrica.
UPDATE public.folha_pagamento f
   SET desconto_manual = GREATEST(ROUND(
         COALESCE(f.descontos, 0)
         - COALESCE(f.desconto_faltas, 0)
         - COALESCE(f.desconto_inss, 0)
         - COALESCE(f.desconto_irrf, 0), 2), 0)
 WHERE COALESCE(f.ativo, true)
   AND COALESCE(f.desconto_manual, 0) = 0
   AND ROUND(COALESCE(f.descontos, 0)
             - COALESCE(f.desconto_faltas, 0)
             - COALESCE(f.desconto_inss, 0)
             - COALESCE(f.desconto_irrf, 0), 2) > 0;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Recálculo reemite a rubrica 199
--
-- Idêntico ao da 320, com três acréscimos: lê `desconto_manual`, insere a
-- rubrica 199 quando houver, e a soma final passa a incluí-la naturalmente
-- (os totais já vinham das rubricas desde a 320).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recalcular_folha_do_ponto(
  p_folha_id        uuid,
  p_target_entrada  text    DEFAULT '07:40',
  p_target_retorno  text    DEFAULT '09:20',
  p_target_saida    text    DEFAULT '11:20',
  p_tolerancia_min  integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_funcionario_id   uuid;
  v_salario_base     numeric(12,2);
  v_mes_ref          text;
  v_status           text;
  v_competencia      date;
  v_dependentes      int := 0;
  v_fgts_aliq        numeric;
  v_valor_hora       numeric;
  v_target           time;
  v_jornada          numeric;
  v_horas_mes        numeric;
  v_horas_atraso     numeric := 0;
  v_horas_falta      numeric := 0;
  v_horas_extras     numeric := 0;
  v_horas_perdoadas  numeric := 0;
  v_desc_faltas      numeric := 0;
  v_desc_manual      numeric := 0;
  v_base_inss        numeric := 0;
  v_inss             numeric := 0;
  v_irrf             numeric := 0;
  v_fgts             numeric := 0;
  v_descontos        numeric;
  v_bonus_extra      numeric;
  v_salario_bruto    numeric;
  v_salario_liquido  numeric;
  v_atraso_min       numeric;
  r                  record;
BEGIN
  PERFORM public._assert_rpc('rh', 'financeiro');

  SELECT funcionario_id, COALESCE(salario_base, salario_bruto), mes_ref, status,
         COALESCE(desconto_manual, 0)
    INTO v_funcionario_id, v_salario_base, v_mes_ref, v_status, v_desc_manual
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

  BEGIN
    v_competencia := to_date(v_mes_ref || '-01', 'YYYY-MM-DD');
  EXCEPTION WHEN OTHERS THEN
    v_competencia := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  END;

  SELECT COALESCE(dependentes, 0) INTO v_dependentes
    FROM funcionarios WHERE id = v_funcionario_id;
  v_dependentes := COALESCE(v_dependentes, 0);

  SELECT COALESCE(fgts_aliquota, 0.08) INTO v_fgts_aliq
    FROM rh_parametros WHERE vigencia_inicio = public.rh_vigencia_em(v_competencia);
  v_fgts_aliq := COALESCE(v_fgts_aliq, 0.08);

  v_target  := (p_target_entrada || ':00')::time;
  v_jornada := EXTRACT(EPOCH FROM (
                 (p_target_saida || ':00')::time - (p_target_entrada || ':00')::time
               )) / 3600.0;

  IF v_jornada IS NULL OR v_jornada <= 0 THEN
    RAISE EXCEPTION 'Jornada inválida: entrada % e saída % não formam um expediente.', p_target_entrada, p_target_saida
      USING ERRCODE = 'P0001';
  END IF;

  v_horas_mes  := v_jornada * 27.5;
  v_valor_hora := v_salario_base / v_horas_mes;

  FOR r IN
    SELECT p.data, p.entrada, p.horas_trabalhadas, p.status,
           COALESCE(a.status = 'Aprovado' AND COALESCE(a.ativo, true), false) AS perdoado
      FROM ponto_eletronico p
      LEFT JOIN afastamentos a ON a.id = p.afastamento_id
     WHERE p.funcionario_id = v_funcionario_id
       AND to_char(p.data, 'YYYY-MM') = v_mes_ref
  LOOP
    IF r.status = 'Falta' THEN
      v_horas_falta := v_horas_falta + v_jornada;

    ELSIF r.status = 'Justificado' THEN
      IF r.perdoado THEN
        v_horas_perdoadas := v_horas_perdoadas + v_jornada;
      ELSE
        v_horas_falta := v_horas_falta + v_jornada;
      END IF;

    ELSIF r.status = 'Hora Extra' THEN
      v_horas_extras := v_horas_extras + GREATEST(COALESCE(r.horas_trabalhadas, 0) - v_jornada, 0);
    END IF;

    IF r.entrada IS NOT NULL
       AND r.status NOT IN ('Falta', 'Justificado')
    THEN
      v_atraso_min := EXTRACT(EPOCH FROM (r.entrada::time - v_target)) / 60.0;
      IF v_atraso_min > p_tolerancia_min THEN
        v_horas_atraso := v_horas_atraso + (v_atraso_min / 60.0);
      END IF;
    END IF;
  END LOOP;

  v_desc_faltas   := ROUND((v_horas_atraso + v_horas_falta) * v_valor_hora, 2);
  v_bonus_extra   := ROUND(v_horas_extras * v_valor_hora * 1.5, 2);
  -- Base de encargos: só faltas reduzem. O desconto manual é retenção sobre o
  -- líquido e fica fora daqui de propósito.
  v_base_inss     := GREATEST(ROUND(v_salario_base + v_bonus_extra, 2) - v_desc_faltas, 0);

  v_inss := public.rh_calc_inss(v_base_inss, v_competencia);
  v_irrf := public.rh_calc_irrf(v_base_inss - v_inss, v_competencia, v_dependentes);
  v_fgts := ROUND(v_base_inss * v_fgts_aliq, 2);

  DELETE FROM public.folha_rubricas WHERE folha_id = p_folha_id;

  INSERT INTO public.folha_rubricas
    (folha_id, codigo, descricao, tipo, referencia, valor,
     incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
  VALUES
    (p_folha_id, '001', 'Salário base', 'provento', '30 dias', v_salario_base,
     true, true, true, false, 1);

  IF v_bonus_extra > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '002', 'Horas extras 50%', 'provento',
       to_char(v_horas_extras, 'FM999990.00') || ' h', v_bonus_extra,
       true, true, true, true, 2);
  END IF;

  IF v_desc_faltas > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '101', 'Faltas e atrasos', 'desconto',
       to_char(v_horas_atraso + v_horas_falta, 'FM999990.00') || ' h', v_desc_faltas,
       true, true, true, false, 10);
  END IF;

  -- A correção desta migration: o lançamento manual vira rubrica em vez de
  -- ser engolido pela soma.
  IF v_desc_manual > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '199', 'Descontos (lançamento manual)', 'desconto', NULL, v_desc_manual,
       false, false, false, false, 19);
  END IF;

  IF v_inss > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '201', 'INSS', 'desconto',
       'base ' || to_char(v_base_inss, 'FM999G999G990D00'), v_inss,
       false, false, false, false, 20);
  END IF;

  IF v_irrf > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '202', 'IRRF', 'desconto',
       CASE WHEN v_dependentes > 0 THEN v_dependentes || ' dep.' ELSE NULL END, v_irrf,
       false, false, false, false, 21);
  END IF;

  INSERT INTO public.folha_rubricas
    (folha_id, codigo, descricao, tipo, referencia, valor,
     incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
  VALUES
    (p_folha_id, '901', 'FGTS depositado (empregador)', 'informativa',
     to_char(v_fgts_aliq * 100, 'FM990D00') || '%', v_fgts,
     false, false, false, false, 90);

  SELECT
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'provento'), 0),
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'desconto'), 0)
    INTO v_salario_bruto, v_descontos
    FROM public.folha_rubricas WHERE folha_id = p_folha_id;

  v_salario_liquido := ROUND(v_salario_bruto - v_descontos, 2);

  IF v_descontos > v_salario_bruto THEN
    v_descontos       := v_salario_bruto;
    v_salario_liquido := 0;
  END IF;

  UPDATE folha_pagamento
     SET salario_bruto   = v_salario_bruto,
         descontos       = v_descontos,
         salario_liquido = v_salario_liquido,
         horas_atraso    = ROUND(v_horas_atraso, 2),
         horas_falta     = v_horas_falta,
         horas_extras    = v_horas_extras,
         desconto_faltas = v_desc_faltas,
         base_inss       = v_base_inss,
         desconto_inss   = v_inss,
         desconto_irrf   = v_irrf,
         fgts_deposito   = v_fgts
   WHERE id = p_folha_id;

  RETURN jsonb_build_object(
    'valor_hora',       ROUND(v_valor_hora, 2),
    'jornada_diaria',   ROUND(v_jornada, 2),
    'horas_mes',        ROUND(v_horas_mes, 2),
    'horas_atraso',     ROUND(v_horas_atraso, 2),
    'horas_falta',      v_horas_falta,
    'horas_perdoadas',  v_horas_perdoadas,
    'horas_extras',     v_horas_extras,
    'competencia',      v_competencia,
    'vigencia_tabela',  public.rh_vigencia_em(v_competencia),
    'dependentes',      v_dependentes,
    'desconto_faltas',  v_desc_faltas,
    'desconto_manual',  v_desc_manual,
    'base_inss',        v_base_inss,
    'desconto_inss',    v_inss,
    'desconto_irrf',    v_irrf,
    'fgts_deposito',    v_fgts,
    'descontos',        v_descontos,
    'bonus_extra',      v_bonus_extra,
    'salario_base',     v_salario_base,
    'salario_bruto',    v_salario_bruto,
    'salario_liquido',  v_salario_liquido,
    'rubricas',         (SELECT count(*) FROM public.folha_rubricas WHERE folha_id = p_folha_id)
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação
--
--   -- Quem tinha desconto manual escondido no total (agora tem coluna):
--   SELECT mes_ref, descontos, desconto_faltas, desconto_inss, desconto_irrf,
--          desconto_manual
--     FROM folha_pagamento WHERE desconto_manual > 0 ORDER BY mes_ref DESC LIMIT 10;
--
--   -- Teste do bug: numa folha Pendente com desconto_manual > 0, recalcule e
--   -- confira que a rubrica 199 voltou e o total continua fechando.
--   SELECT codigo, descricao, tipo, valor FROM folha_rubricas
--    WHERE folha_id = '<id>' ORDER BY ordem;
-- ────────────────────────────────────────────────────────────────────────────
