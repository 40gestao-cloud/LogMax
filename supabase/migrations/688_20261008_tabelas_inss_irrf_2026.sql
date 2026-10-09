-- 688 — Tabelas de INSS e IRRF de 2026, e o IRRF calculado pela regra.
--
-- A vigência única era o "piso" semeado na 319 (2000-01-01): INSS com as
-- faixas de 2025 (teto R$ 8.157,41), IRRF de fev/2024 (isento até 2.259,20),
-- dedução por dependente e desconto simplificado ZERADOS — enquanto o salário
-- mínimo das turmas já é o de 2026 (R$ 1.621,00).
--
-- E um erro de regra em rh_calc_irrf: todo chamador passa a base JÁ SEM o
-- INSS, e a função ainda tirava max(dependentes, simplificado). O desconto
-- simplificado SUBSTITUI as deduções legais (INSS + dependentes), não soma
-- com elas — com o simplificado cadastrado, o imposto sairia menor que o real.
--
--  1. rh_parametros ganha o redutor da Lei 15.270/2025 (vigente em 2026):
--     rendimento tributável até R$ 5.000,00 → redução de até R$ 312,89 (zera
--     o imposto); de 5.000,01 a 7.350,00 → redução = 978,62 − 0,133145 ×
--     rendimento; acima, nada. Vigência antiga fica com NULL (sem redutor).
--  2. Vigência 2026-01-01:
--     INSS  7,5% até 1.621,00 · 9% até 2.902,84 · 12% até 4.354,27 · 14% até 8.475,55
--     IRRF  isento até 2.428,80 · 7,5% até 2.826,65 (−182,16) · 15% até 3.751,05
--           (−394,16) · 22,5% até 4.664,68 (−675,49) · 27,5% acima (−908,73)
--     dependente R$ 189,59 · simplificado R$ 607,20 · mínimo R$ 1.621,00 · FGTS 8%
--  3. rh_calc_irrf(base, data, dependentes, inss, mensal) — recebe o INSS para
--     aplicar o simplificado como a lei manda e o rendimento bruto para o
--     redutor. `mensal = false` é o 13º (tributação exclusiva: sem
--     simplificado e sem redutor). A versão de 3 argumentos continua existindo
--     e delega (inss 0, mensal) — na vigência antiga o resultado é idêntico.
--  4. recalcular_folha_do_ponto e calcular_rescisao passam a chamar a nova.
--
-- Trocar de tabela de novo NÃO é migração: é INSERT em rh_parametros +
-- rh_faixas com vigencia_inicio nova (régua da 319).

-- ── 1 ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.rh_parametros
  ADD COLUMN IF NOT EXISTS irrf_redutor_ate      numeric(15,2),
  ADD COLUMN IF NOT EXISTS irrf_redutor_maximo   numeric(15,2),
  ADD COLUMN IF NOT EXISTS irrf_redutor_teto     numeric(15,2),
  ADD COLUMN IF NOT EXISTS irrf_redutor_a        numeric(15,2),
  ADD COLUMN IF NOT EXISTS irrf_redutor_b        numeric(12,6);

COMMENT ON COLUMN public.rh_parametros.irrf_redutor_ate IS
  'Migr. 688 (Lei 15.270/2025): rendimento mensal até este valor tem redução de até irrf_redutor_maximo.';
COMMENT ON COLUMN public.rh_parametros.irrf_redutor_teto IS
  'Migr. 688: entre irrf_redutor_ate e este valor, redução = irrf_redutor_a − irrf_redutor_b × rendimento.';

-- ── 2 ──────────────────────────────────────────────────────────────────────
INSERT INTO public.rh_parametros
  (vigencia_inicio, salario_minimo, fgts_aliquota, deducao_dependente, desconto_simplificado,
   irrf_redutor_ate, irrf_redutor_maximo, irrf_redutor_teto, irrf_redutor_a, irrf_redutor_b, descricao)
VALUES
  ('2026-01-01', 1621.00, 0.08, 189.59, 607.20,
   5000.00, 312.89, 7350.00, 978.62, 0.133145,
   'Tabelas de 2026: INSS (Portaria Interministerial do reajuste de 2026), IRRF (tabela de maio/2025 + redutor da Lei 15.270/2025).')
ON CONFLICT (vigencia_inicio) DO UPDATE SET
  salario_minimo        = EXCLUDED.salario_minimo,
  fgts_aliquota         = EXCLUDED.fgts_aliquota,
  deducao_dependente    = EXCLUDED.deducao_dependente,
  desconto_simplificado = EXCLUDED.desconto_simplificado,
  irrf_redutor_ate      = EXCLUDED.irrf_redutor_ate,
  irrf_redutor_maximo   = EXCLUDED.irrf_redutor_maximo,
  irrf_redutor_teto     = EXCLUDED.irrf_redutor_teto,
  irrf_redutor_a        = EXCLUDED.irrf_redutor_a,
  irrf_redutor_b        = EXCLUDED.irrf_redutor_b,
  descricao             = EXCLUDED.descricao;

DELETE FROM public.rh_faixas WHERE vigencia_inicio = '2026-01-01';
INSERT INTO public.rh_faixas (vigencia_inicio, tipo, ordem, limite, aliquota, deduzir) VALUES
  ('2026-01-01', 'inss', 1, 1621.00, 0.075, 0),
  ('2026-01-01', 'inss', 2, 2902.84, 0.09,  0),
  ('2026-01-01', 'inss', 3, 4354.27, 0.12,  0),
  ('2026-01-01', 'inss', 4, 8475.55, 0.14,  0),
  ('2026-01-01', 'irrf', 1, 2428.80, 0,     0),
  ('2026-01-01', 'irrf', 2, 2826.65, 0.075, 182.16),
  ('2026-01-01', 'irrf', 3, 3751.05, 0.15,  394.16),
  ('2026-01-01', 'irrf', 4, 4664.68, 0.225, 675.49),
  ('2026-01-01', 'irrf', 5, NULL,    0.275, 908.73);

-- ── 3 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_calc_irrf(p_base numeric, p_data date, p_dependentes integer,
                                               p_inss numeric, p_mensal boolean)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_vig       date := public.rh_vigencia_em(p_data);
  v_inss      numeric := GREATEST(COALESCE(p_inss, 0), 0);
  -- O rendimento tributável bruto: quem chama manda a base já sem o INSS.
  v_rend      numeric := GREATEST(COALESCE(p_base, 0), 0) + GREATEST(COALESCE(p_inss, 0), 0);
  v_dep       numeric;
  v_base      numeric;
  v_imposto   numeric;
  v_reducao   numeric := 0;
  v_par       record;
  v_faixa     record;
BEGIN
  IF v_vig IS NULL OR v_rend <= 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_par FROM public.rh_parametros WHERE vigencia_inicio = v_vig;
  v_dep := COALESCE(v_par.deducao_dependente, 0) * GREATEST(COALESCE(p_dependentes, 0), 0);

  IF COALESCE(p_mensal, true) THEN
    -- Deduções legais (INSS + dependentes) OU o simplificado — o que for maior.
    v_base := v_rend - GREATEST(v_inss + v_dep, COALESCE(v_par.desconto_simplificado, 0));
  ELSE
    -- 13º: tributação exclusiva, só as deduções legais.
    v_base := v_rend - v_inss - v_dep;
  END IF;
  v_base := GREATEST(v_base, 0);

  SELECT limite, aliquota, deduzir INTO v_faixa
    FROM public.rh_faixas
   WHERE tipo = 'irrf' AND vigencia_inicio = v_vig
     AND (limite IS NULL OR v_base <= limite)
   ORDER BY ordem
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_imposto := GREATEST(ROUND(v_base * v_faixa.aliquota - v_faixa.deduzir, 2), 0);

  -- Redutor (Lei 15.270/2025): sobre o rendimento tributável do mês.
  IF COALESCE(p_mensal, true) AND v_par.irrf_redutor_ate IS NOT NULL THEN
    IF v_rend <= v_par.irrf_redutor_ate THEN
      v_reducao := COALESCE(v_par.irrf_redutor_maximo, 0);
    ELSIF v_par.irrf_redutor_teto IS NOT NULL AND v_rend <= v_par.irrf_redutor_teto THEN
      v_reducao := GREATEST(COALESCE(v_par.irrf_redutor_a, 0) - COALESCE(v_par.irrf_redutor_b, 0) * v_rend, 0);
    END IF;
  END IF;

  RETURN GREATEST(ROUND(v_imposto - LEAST(v_reducao, v_imposto), 2), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.rh_calc_irrf(numeric, date, integer, numeric, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rh_calc_irrf(numeric, date, integer, numeric, boolean) TO authenticated;

-- A de 3 argumentos delega. Mesma assinatura e defaults de antes (só o corpo).
CREATE OR REPLACE FUNCTION public.rh_calc_irrf(p_base numeric, p_data date DEFAULT NULL::date, p_dependentes integer DEFAULT 0)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  -- MIGR 688: sem o INSS, trata a base recebida como o rendimento do mês.
  SELECT public.rh_calc_irrf(p_base, p_data, p_dependentes, 0::numeric, true);
$$;

-- ── 4 ──────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := replace(pg_get_functiondef('public.recalcular_folha_do_ponto(uuid, text, text, text, integer)'::regprocedure), E'\r', '');
  IF position('MIGR 688' IN v_def) = 0 THEN
    IF position('v_irrf := public.rh_calc_irrf(v_base_inss - v_inss, v_competencia, v_dependentes);' IN v_def) = 0 THEN
      RAISE EXCEPTION 'recalcular_folha_do_ponto: trecho-âncora não encontrado';
    END IF;
    v_def := replace(v_def,
      'v_irrf := public.rh_calc_irrf(v_base_inss - v_inss, v_competencia, v_dependentes);',
      'v_irrf := public.rh_calc_irrf(v_base_inss - v_inss, v_competencia, v_dependentes, v_inss, true);  -- MIGR 688');
    EXECUTE v_def;
  END IF;

  v_def := replace(pg_get_functiondef('public.calcular_rescisao(uuid, text, date, text)'::regprocedure), E'\r', '');
  IF position('MIGR 688' IN v_def) = 0 THEN
    IF position('rh_calc_irrf(v_saldo - v_inss_sal, v_data, v_dependentes);' IN v_def) = 0
       OR position('rh_calc_irrf(v_decimo - v_inss_13, v_data, v_dependentes);' IN v_def) = 0 THEN
      RAISE EXCEPTION 'calcular_rescisao: trecho-âncora não encontrado';
    END IF;
    v_def := replace(v_def,
      'rh_calc_irrf(v_saldo - v_inss_sal, v_data, v_dependentes);',
      'rh_calc_irrf(v_saldo - v_inss_sal, v_data, v_dependentes, v_inss_sal, true);  -- MIGR 688');
    v_def := replace(v_def,
      'rh_calc_irrf(v_decimo - v_inss_13, v_data, v_dependentes);',
      'rh_calc_irrf(v_decimo - v_inss_13, v_data, v_dependentes, v_inss_13, false);  -- MIGR 688: 13º exclusivo');
    EXECUTE v_def;
  END IF;
END
$mig$;
