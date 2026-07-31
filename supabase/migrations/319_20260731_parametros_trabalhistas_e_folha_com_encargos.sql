-- 319 — Fase 1 da folha real: parâmetros com vigência + INSS/IRRF/FGTS na folha.
--
-- O DIAGNÓSTICO. Hoje a folha é MENOS realista que a rescisão. A 306 deu à
-- rescisão tabela de INSS e de IRRF; a folha (`recalcular_folha_do_ponto`,
-- migr. 292) faz `bruto = base + extras×1,5`, `descontos = faltas+atrasos` e
-- `líquido = bruto − descontos`. Não há INSS, não há IRRF, não há FGTS. Por
-- isso apoiar a rescisão no histórico da folha, hoje, pioraria o número: é
-- preciso a folha ganhar antes o que a rescisão já tem.
--
-- O SEGUNDO PROBLEMA são as tabelas. `_inss_simplificado` e
-- `_irrf_simplificado` são funções IMMUTABLE com as faixas escritas no corpo:
-- congeladas, sem vigência, e duplicáveis no dia em que a folha precisar das
-- mesmas. Toda virada de ano viraria uma migration nova.
--
-- O QUE ESTE ARQUIVO FAZ:
--   1. `rh_parametros` + `rh_faixas`, ambas versionadas por `vigencia_inicio`.
--   2. `rh_calc_inss(base, data)` e `rh_calc_irrf(base, data, dependentes)`,
--      que leem a vigência da COMPETÊNCIA — rescisão de 2024 usa tabela de
--      2024, não a de hoje.
--   3. A folha passa a descontar INSS e IRRF e a registrar o depósito de FGTS.
--   4. A rescisão passa a usar as mesmas funções. Uma tabela, dois módulos.
--
-- O QUE ELE NÃO FAZ, DE PROPÓSITO: não atualiza valor nenhum. A vigência
-- semeada reproduz EXATAMENTE as faixas que já estavam no corpo das funções,
-- para que nenhum número de rescisão mude com a migration. Trocar de tabela
-- passa a ser um INSERT com `vigencia_inicio` nova — que é justamente o ponto.
--
-- IDEMPOTENTE. Depende da 306. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Parâmetros escalares por vigência
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rh_parametros (
  vigencia_inicio       date PRIMARY KEY,
  descricao             text,
  salario_minimo        numeric(15,2) NOT NULL,
  -- Dedução por dependente e desconto simplificado do IRRF. A regra real é
  -- usar o que for MAIS vantajoso ao contribuinte, não somar os dois.
  deducao_dependente    numeric(15,2) NOT NULL DEFAULT 0,
  desconto_simplificado numeric(15,2) NOT NULL DEFAULT 0,
  fgts_aliquota         numeric(6,4)  NOT NULL DEFAULT 0.08,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Faixas de INSS e IRRF
--
-- Uma tabela só, discriminada por `tipo`: a forma é a mesma (limite superior,
-- alíquota, parcela a deduzir) e duas tabelas gêmeas só duplicariam as
-- funções que as leem.
--
-- `limite NULL` = última faixa, sem teto superior. No INSS isso não ocorre
-- (a última faixa É o teto de contribuição); no IRRF é a faixa de 27,5%.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rh_faixas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL CHECK (tipo IN ('inss', 'irrf')),
  vigencia_inicio date NOT NULL,
  ordem           int  NOT NULL,
  limite          numeric(15,2),
  aliquota        numeric(6,4)  NOT NULL,
  deduzir         numeric(15,2) NOT NULL DEFAULT 0,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tipo, vigencia_inicio, ordem)
);

CREATE INDEX IF NOT EXISTS idx_rh_faixas_lookup
  ON public.rh_faixas (tipo, vigencia_inicio DESC, ordem);

-- ── Seed: reproduz EXATAMENTE o que estava no corpo das funções ────────────
--
-- `vigencia_inicio` bem antiga de propósito: esta é a linha-piso, a que vale
-- para qualquer competência anterior à primeira tabela oficial cadastrada.
--
-- ACHADO ao transcrever: as faixas herdadas da 306 estão MISTURADAS — o teto
-- do INSS (8157.41) e a primeira faixa (1518.00) são de um ano, e as faixas do
-- IRRF (isenção em 2259.20) são de outro. Ficam aqui como estão, porque o
-- objetivo desta migration é não mudar número nenhum; corrigir é cadastrar uma
-- vigência nova com a tabela oficial, o que agora é um INSERT.
--
-- `deducao_dependente` e `desconto_simplificado` entram ZERADOS. É o que
-- reproduz o comportamento atual (o IRRF de hoje não deduz nada) e evita
-- chutar valor oficial. Preencher esses dois numa vigência nova é o que liga
-- a dedução por dependente.
INSERT INTO public.rh_parametros
  (vigencia_inicio, descricao, salario_minimo, deducao_dependente, desconto_simplificado, fgts_aliquota)
VALUES
  ('2000-01-01', 'Piso — faixas herdadas da migr. 306, sem deduções. Cadastre a tabela oficial como vigência nova.',
   1518.00, 0, 0, 0.08)
ON CONFLICT (vigencia_inicio) DO NOTHING;

INSERT INTO public.rh_faixas (tipo, vigencia_inicio, ordem, limite, aliquota, deduzir) VALUES
  ('inss', '2000-01-01', 1, 1518.00, 0.075, 0),
  ('inss', '2000-01-01', 2, 2793.88, 0.090, 0),
  ('inss', '2000-01-01', 3, 4190.83, 0.120, 0),
  ('inss', '2000-01-01', 4, 8157.41, 0.140, 0),
  ('irrf', '2000-01-01', 1, 2259.20, 0.000,   0.00),
  ('irrf', '2000-01-01', 2, 2826.65, 0.075, 169.44),
  ('irrf', '2000-01-01', 3, 3751.05, 0.150, 381.44),
  ('irrf', '2000-01-01', 4, 4664.68, 0.225, 662.77),
  ('irrf', '2000-01-01', 5, NULL,    0.275, 896.00)
ON CONFLICT (tipo, vigencia_inicio, ordem) DO NOTHING;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Leitura aberta a qualquer autenticado de propósito: a tabela É o conteúdo
-- da aula, e não há dado pessoal aqui. Escrita só admin/CEO.
ALTER TABLE public.rh_parametros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_faixas     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rh_parametros_select ON public.rh_parametros;
CREATE POLICY rh_parametros_select ON public.rh_parametros
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rh_parametros_write ON public.rh_parametros;
CREATE POLICY rh_parametros_write ON public.rh_parametros
  FOR ALL TO authenticated
  USING      (public.auth_user_role() IN ('admin', 'ceo'))
  WITH CHECK (public.auth_user_role() IN ('admin', 'ceo'));

DROP POLICY IF EXISTS rh_faixas_select ON public.rh_faixas;
CREATE POLICY rh_faixas_select ON public.rh_faixas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rh_faixas_write ON public.rh_faixas;
CREATE POLICY rh_faixas_write ON public.rh_faixas
  FOR ALL TO authenticated
  USING      (public.auth_user_role() IN ('admin', 'ceo'))
  WITH CHECK (public.auth_user_role() IN ('admin', 'ceo'));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Vigência aplicável
--
-- Sempre a MAIOR vigência que já começou na data pedida. Se a data for
-- anterior a tudo, cai na mais antiga — melhor calcular com tabela velha do
-- que estourar com NULL no meio de uma rescisão.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rh_vigencia_em(p_data date)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT MAX(vigencia_inicio) FROM public.rh_parametros
      WHERE vigencia_inicio <= COALESCE(p_data, CURRENT_DATE)),
    (SELECT MIN(vigencia_inicio) FROM public.rh_parametros)
  );
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. INSS progressivo por faixa
--
-- Progressivo de verdade: cada faixa incide só sobre a parte do salário que
-- cai dentro dela. Acima do teto (última faixa) não há contribuição — por
-- isso o LEAST contra o limite mais alto.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rh_calc_inss(p_base numeric, p_data date DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_vig    date := public.rh_vigencia_em(p_data);
  v_base   numeric := GREATEST(COALESCE(p_base, 0), 0);
  v_ant    numeric := 0;
  v_total  numeric := 0;
  r        record;
BEGIN
  IF v_vig IS NULL OR v_base <= 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT limite, aliquota FROM public.rh_faixas
     WHERE tipo = 'inss' AND vigencia_inicio = v_vig
     ORDER BY ordem
  LOOP
    -- limite NULL na última faixa do INSS significaria "sem teto"; o desenho
    -- da tabela é com teto, mas o COALESCE evita NULL silencioso propagado.
    v_total := v_total + GREATEST(LEAST(v_base, COALESCE(r.limite, v_base)) - v_ant, 0) * r.aliquota;
    v_ant   := COALESCE(r.limite, v_base);
    EXIT WHEN v_base <= v_ant;
  END LOOP;

  RETURN ROUND(v_total, 2);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. IRRF por faixa, com dedução
--
-- A base recebida já vem líquida de INSS (quem chama subtrai). Aqui entram as
-- deduções pessoais: por dependente OU o desconto simplificado, o que for
-- maior — que é a regra real, e não a soma dos dois.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rh_calc_irrf(
  p_base         numeric,
  p_data         date DEFAULT NULL,
  p_dependentes  int  DEFAULT 0
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_vig      date := public.rh_vigencia_em(p_data);
  v_base     numeric := GREATEST(COALESCE(p_base, 0), 0);
  v_par      record;
  v_deducao  numeric := 0;
  v_faixa    record;
BEGIN
  IF v_vig IS NULL OR v_base <= 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_par FROM public.rh_parametros WHERE vigencia_inicio = v_vig;

  v_deducao := GREATEST(
    COALESCE(v_par.deducao_dependente, 0) * GREATEST(COALESCE(p_dependentes, 0), 0),
    COALESCE(v_par.desconto_simplificado, 0)
  );
  v_base := GREATEST(v_base - v_deducao, 0);

  SELECT limite, aliquota, deduzir INTO v_faixa
    FROM public.rh_faixas
   WHERE tipo = 'irrf' AND vigencia_inicio = v_vig
     AND (limite IS NULL OR v_base <= limite)
   ORDER BY ordem
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  RETURN GREATEST(ROUND(v_base * v_faixa.aliquota - v_faixa.deduzir, 2), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.rh_vigencia_em(date)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rh_calc_inss(numeric, date)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rh_calc_irrf(numeric, date, int)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_vigencia_em(date)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.rh_calc_inss(numeric, date)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rh_calc_irrf(numeric, date, int) TO authenticated;

-- ── Compatibilidade ────────────────────────────────────────────────────────
-- As duas funções da 306 viram cascas finas. Ficam de pé para não quebrar
-- nada que ainda as chame, mas deixam de ter faixa própria: fonte única
-- passa a ser a tabela. Deixam de ser IMMUTABLE (agora leem tabela).
CREATE OR REPLACE FUNCTION public._inss_simplificado(p_base numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.rh_calc_inss(p_base, NULL);
$function$;

CREATE OR REPLACE FUNCTION public._irrf_simplificado(p_base numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.rh_calc_irrf(p_base, NULL, 0);
$function$;

REVOKE ALL ON FUNCTION public._inss_simplificado(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._irrf_simplificado(numeric) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Colunas novas
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS dependentes int NOT NULL DEFAULT 0;

ALTER TABLE public.folha_pagamento
  ADD COLUMN IF NOT EXISTS desconto_faltas numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_inss       numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_inss   numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_irrf   numeric(15,2) NOT NULL DEFAULT 0,
  -- Depósito do empregador: NÃO entra no líquido nem em `descontos`. Fica
  -- gravado porque é ele que a fase 3 vai somar para o FGTS real da rescisão,
  -- no lugar do `salário atual × 8% × meses` que a 306 simula hoje.
  ADD COLUMN IF NOT EXISTS fgts_deposito   numeric(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.folha_pagamento.fgts_deposito IS
  'Depósito de FGTS da competência (empregador). Fora do líquido; base do FGTS real da rescisão.';

-- ════════════════════════════════════════════════════════════════════════════
-- 7. A folha passa a descontar encargos
--
-- Ordem do cálculo, que é a da CLT:
--   bruto        = base + horas extras
--   remuneração  = bruto − faltas/atrasos   ← base de INSS e de FGTS
--   INSS         sobre a remuneração
--   IRRF         sobre (remuneração − INSS), com deduções pessoais
--   líquido      = bruto − faltas − INSS − IRRF
--
-- FGTS fica fora do líquido: é depósito do empregador, não desconto do
-- trabalhador — o mesmo tratamento que a rescisão já dá.
--
-- A competência (`mes_ref`) é quem escolhe a vigência das tabelas.
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

  -- mes_ref é 'YYYY-MM'. Competência inválida cai no mês corrente em vez de
  -- estourar: recalcular não pode falhar por causa de rótulo mal digitado.
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
  v_salario_bruto := ROUND(v_salario_base + v_bonus_extra, 2);

  -- Falta reduz a remuneração do mês, e é sobre a remuneração efetiva que
  -- INSS e FGTS incidem. Calcular encargo sobre o bruto cheio cobraria
  -- contribuição de dia que não foi trabalhado nem pago.
  v_base_inss := GREATEST(v_salario_bruto - v_desc_faltas, 0);

  v_inss := public.rh_calc_inss(v_base_inss, v_competencia);
  v_irrf := public.rh_calc_irrf(v_base_inss - v_inss, v_competencia, v_dependentes);
  v_fgts := ROUND(v_base_inss * v_fgts_aliq, 2);

  v_descontos       := ROUND(v_desc_faltas + v_inss + v_irrf, 2);
  v_salario_liquido := ROUND(v_salario_bruto - v_descontos, 2);

  -- Folha não vira dívida do trabalhador — mesma trava da rescisão.
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
    'base_inss',        v_base_inss,
    'desconto_inss',    v_inss,
    'desconto_irrf',    v_irrf,
    'fgts_deposito',    v_fgts,
    'descontos',        v_descontos,
    'bonus_extra',      v_bonus_extra,
    'salario_base',     v_salario_base,
    'salario_bruto',    v_salario_bruto,
    'salario_liquido',  v_salario_liquido
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. A rescisão passa a usar as mesmas tabelas
--
-- Duas mudanças, ambas de fidelidade:
--   • a vigência sai da DATA DO DESLIGAMENTO, não de "a tabela que estava
--     escrita na função" — rescisão retroativa deixa de usar tabela futura;
--   • dependentes passam a deduzir no IRRF (parte do que faltava).
--
-- O restante do cálculo é o da 306, intocado. Com o seed acima reproduzindo
-- as faixas antigas, o número só muda para quem tem dependente cadastrado.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.calcular_rescisao(
  p_funcionario_id  uuid,
  p_tipo            text,
  p_data            date DEFAULT NULL,
  p_aviso_previo    text DEFAULT 'Indenizado'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome        text;
  v_filial      text;
  v_salario     numeric(15,2);
  v_admissao    date;
  v_data        date;
  v_dia         numeric;
  v_dependentes int := 0;

  v_anos_completos  int;
  v_meses_total     int;
  v_meses_ano       int;      -- meses no ano do desligamento (13º)
  v_meses_aquisit   int;      -- meses desde o último aniversário (férias prop.)
  v_ferias_gozadas  int;
  v_periodos_venc   int;

  v_dias_aviso  int := 0;
  v_saldo       numeric(15,2) := 0;
  v_aviso       numeric(15,2) := 0;
  v_decimo      numeric(15,2) := 0;
  v_fer_venc    numeric(15,2) := 0;
  v_fer_prop    numeric(15,2) := 0;
  v_terco       numeric(15,2) := 0;
  v_fgts_dep    numeric(15,2) := 0;
  v_multa       numeric(15,2) := 0;

  v_base_trib   numeric(15,2) := 0;
  v_inss        numeric(15,2) := 0;
  v_irrf        numeric(15,2) := 0;
  v_desc_aviso  numeric(15,2) := 0;

  v_bruto       numeric(15,2);
  v_descontos   numeric(15,2);
  v_liquido     numeric(15,2);
BEGIN
  -- A função lê `funcionarios.salario`. Sem este guard, qualquer autenticado
  -- enumeraria os ids e leria o salário de todo mundo pela porta de uma RPC de
  -- "simulação" — que é o tipo de fresta que a 260 encontrou aberta.
  PERFORM public._assert_rpc('rh');

  IF p_tipo NOT IN ('Sem justa causa', 'Com justa causa', 'Pedido de demissão', 'Acordo') THEN
    RAISE EXCEPTION 'Tipo de desligamento inválido: %.', p_tipo USING ERRCODE = 'P0001';
  END IF;

  SELECT nome, COALESCE(filial, 'Matriz'), COALESCE(salario, 0), data_admissao,
         COALESCE(dependentes, 0)
    INTO v_nome, v_filial, v_salario, v_admissao, v_dependentes
    FROM public.funcionarios
   WHERE id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  v_data := COALESCE(p_data, (now() AT TIME ZONE 'America/Rio_Branco')::date);

  IF v_salario <= 0 THEN
    RAISE EXCEPTION 'Salário do funcionário está zerado. Preencha em RH → Funcionários antes de calcular a rescisão.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Sem data de admissão não há tempo de casa, e tempo de casa é o que move
  -- quase toda verba. Melhor recusar do que devolver número inventado.
  IF v_admissao IS NULL THEN
    RAISE EXCEPTION 'Funcionário sem data de admissão. Preencha em RH → Funcionários antes de calcular a rescisão.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_data < v_admissao THEN
    RAISE EXCEPTION 'Desligamento (%) não pode ser anterior à admissão (%).', v_data, v_admissao
      USING ERRCODE = 'P0001';
  END IF;

  v_dia            := ROUND(v_salario / 30.0, 2);
  v_meses_total    := GREATEST((EXTRACT(YEAR FROM age(v_data, v_admissao)) * 12
                              + EXTRACT(MONTH FROM age(v_data, v_admissao)))::int, 0);
  v_anos_completos := v_meses_total / 12;

  -- 13º: meses do ano corrente com 15 dias ou mais trabalhados.
  --
  -- Os dois extremos entram na conta pela mesma régua, e é aí que a versão
  -- ingênua erra: no mês da ADMISSÃO trabalha-se de `dia` até o fim, ou seja
  -- 30 − dia + 1 dias — o mês só conta se a pessoa entrou até o dia 16. No mês
  -- do DESLIGAMENTO trabalha-se de 1 até `dia`, então conta a partir do 15.
  DECLARE
    v_mes_ini int := 1;
    v_mes_fim int;
  BEGIN
    IF EXTRACT(YEAR FROM v_admissao) = EXTRACT(YEAR FROM v_data) THEN
      v_mes_ini := EXTRACT(MONTH FROM v_admissao)::int
                   + CASE WHEN EXTRACT(DAY FROM v_admissao)::int > 16 THEN 1 ELSE 0 END;
    END IF;

    v_mes_fim := EXTRACT(MONTH FROM v_data)::int
                 - CASE WHEN EXTRACT(DAY FROM v_data)::int < 15 THEN 1 ELSE 0 END;

    v_meses_ano := GREATEST(LEAST(v_mes_fim - v_mes_ini + 1, 12), 0);
  END;

  -- Férias proporcionais: meses desde o último aniversário de admissão.
  v_meses_aquisit := v_meses_total - (v_anos_completos * 12);

  -- Vencidas: um período por ano completo, menos os que já foram gozados.
  --
  -- Simplificação assumida: cada registro de férias aprovado vale um período
  -- aquisitivo. Quem fracionou as férias em duas quinzenas aparece como dois
  -- períodos gozados e recebe menos vencidas do que deveria. Corrigir isso
  -- exigiria somar dias e amarrar cada bloco ao seu período aquisitivo — mais
  -- máquina do que a aula pede.
  SELECT count(*) INTO v_ferias_gozadas
    FROM public.ferias
   WHERE funcionario_id = p_funcionario_id
     AND COALESCE(ativo, true)
     AND status = 'Aprovado';
  v_periodos_venc := GREATEST(v_anos_completos - COALESCE(v_ferias_gozadas, 0), 0);

  -- ── Saldo de salário: dias trabalhados no mês do desligamento ─────────────
  v_saldo := ROUND(v_dia * EXTRACT(DAY FROM v_data)::int, 2);

  -- ── Aviso prévio: 30 dias + 3 por ano completo, teto de 90 ───────────────
  v_dias_aviso := LEAST(30 + (v_anos_completos * 3), 90);

  IF p_tipo = 'Sem justa causa' THEN
    -- Trabalhado já foi pago como dia normal; só o indenizado vira verba.
    IF p_aviso_previo = 'Indenizado' THEN
      v_aviso := ROUND(v_dia * v_dias_aviso, 2);
    END IF;

  ELSIF p_tipo = 'Acordo' THEN
    -- Art. 484-A: metade do aviso indenizado.
    v_aviso := ROUND(v_dia * v_dias_aviso / 2.0, 2);

  ELSIF p_tipo = 'Pedido de demissão' THEN
    -- Quem pede e não cumpre o aviso paga por ele.
    IF p_aviso_previo = 'Não cumprido' THEN
      v_desc_aviso := ROUND(v_dia * 30, 2);
    END IF;
    v_dias_aviso := 0;

  ELSE  -- Com justa causa
    v_dias_aviso := 0;
  END IF;

  -- ── 13º proporcional: justa causa perde ──────────────────────────────────
  IF p_tipo <> 'Com justa causa' THEN
    v_decimo := ROUND(v_salario * v_meses_ano / 12.0, 2);
  END IF;

  -- ── Férias ───────────────────────────────────────────────────────────────
  -- Vencidas são direito adquirido: nem a justa causa tira.
  v_fer_venc := ROUND(v_salario * v_periodos_venc, 2);

  -- Proporcionais, sim: justa causa perde.
  IF p_tipo <> 'Com justa causa' THEN
    v_fer_prop := ROUND(v_salario * v_meses_aquisit / 12.0, 2);
  END IF;

  v_terco := ROUND((v_fer_venc + v_fer_prop) / 3.0, 2);

  -- ── FGTS: 8% do salário por mês trabalhado (simulado — não há conta real) ─
  -- Segue simulado NESTA fase. O extrato real vem da fase 3, somando
  -- `folha_pagamento.fgts_deposito` competência a competência — coluna que a
  -- seção 6 acabou de criar e que a seção 7 passa a preencher.
  v_fgts_dep := ROUND(v_salario * 0.08 * v_meses_total, 2);

  v_multa := CASE p_tipo
    WHEN 'Sem justa causa' THEN ROUND(v_fgts_dep * 0.40, 2)
    WHEN 'Acordo'          THEN ROUND(v_fgts_dep * 0.20, 2)
    ELSE 0
  END;

  -- ── Descontos ────────────────────────────────────────────────────────────
  -- Só saldo de salário e 13º são base de INSS/IRRF. Aviso indenizado, férias
  -- indenizadas e multa do FGTS são indenizatórios — não entram. Essa é a
  -- simplificação mais importante do arquivo, e ela é fiel.
  --
  -- MUDOU AQUI: as faixas saem da tabela versionada, escolhidas pela DATA DO
  -- DESLIGAMENTO — rescisão retroativa deixa de usar tabela de hoje. E os
  -- dependentes passam a deduzir no IRRF.
  v_base_trib := v_saldo + v_decimo;
  v_inss := public.rh_calc_inss(v_base_trib, v_data);
  v_irrf := public.rh_calc_irrf(v_base_trib - v_inss, v_data, v_dependentes);

  v_bruto := v_saldo + v_aviso + v_decimo + v_fer_venc + v_fer_prop + v_terco + v_multa;
  v_descontos := v_inss + v_irrf + v_desc_aviso;

  -- Rescisão não vira dívida do trabalhador: o líquido para em zero.
  IF v_descontos > v_bruto THEN
    v_descontos := v_bruto;
  END IF;
  v_liquido := v_bruto - v_descontos;

  RETURN jsonb_build_object(
    'funcionario',          v_nome,
    'filial',               v_filial,
    'tipo',                 p_tipo,
    'aviso_previo',         p_aviso_previo,
    'salario_base',         v_salario,
    'data_admissao',        v_admissao,
    'data_desligamento',    v_data,
    'meses_trabalhados',    v_meses_total,
    'anos_completos',       v_anos_completos,
    'dias_aviso',           v_dias_aviso,
    'periodos_ferias_vencidas', v_periodos_venc,
    'dependentes',          v_dependentes,
    'vigencia_tabela',      public.rh_vigencia_em(v_data),
    'saldo_salario',        v_saldo,
    'aviso_previo_valor',   v_aviso,
    'decimo_terceiro',      v_decimo,
    'ferias_vencidas',      v_fer_venc,
    'ferias_proporcionais', v_fer_prop,
    'terco_ferias',         v_terco,
    'fgts_depositado',      v_fgts_dep,
    'multa_fgts',           v_multa,
    'desconto_inss',        v_inss,
    'desconto_irrf',        v_irrf,
    'desconto_aviso',       v_desc_aviso,
    'total_bruto',          v_bruto,
    'total_descontos',      v_descontos,
    'total_liquido',        v_liquido
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calcular_rescisao(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_rescisao(uuid, text, date, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação
--
--   -- Seed reproduz as faixas antigas (esperado: iguais aos da 306):
--   SELECT rh_calc_inss(3000, '2024-06-01') AS inss,   -- 254.35
--          rh_calc_irrf(3000, '2024-06-01', 0) AS irrf;
--
--   -- Vigência escolhida pela competência:
--   SELECT rh_vigencia_em('2024-03-01'), rh_vigencia_em(CURRENT_DATE);
--
--   -- Folha recalculada agora traz os encargos (recalcule uma Pendente):
--   SELECT mes_ref, salario_bruto, desconto_faltas, desconto_inss,
--          desconto_irrf, fgts_deposito, salario_liquido
--     FROM folha_pagamento WHERE desconto_inss > 0 ORDER BY updated_at DESC LIMIT 5;
--
--   -- Para virar de tabela, NÃO é preciso migration — basta:
--   -- INSERT INTO rh_parametros (vigencia_inicio, descricao, salario_minimo,
--   --   deducao_dependente, desconto_simplificado, fgts_aliquota)
--   --   VALUES ('2026-01-01', 'Tabela 2026', ..., ..., ..., 0.08);
--   -- INSERT INTO rh_faixas (tipo, vigencia_inicio, ordem, limite, aliquota, deduzir) ...
-- ────────────────────────────────────────────────────────────────────────────
