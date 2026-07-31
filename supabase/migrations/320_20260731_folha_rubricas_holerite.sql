-- 320 — Fase 2 da folha real: rubricas.
--
-- A 319 pôs INSS, IRRF e FGTS na folha, mas o resultado continua sendo três
-- números agregados em `folha_pagamento`: `salario_bruto`, `descontos`,
-- `salario_liquido`. Não dá para saber DE QUE eles são feitos — e é essa
-- limitação, não o cálculo, que trava o resto do plano:
--
--   • sem rubrica não há holerite (o aluno vê um total, não um documento);
--   • sem `integra_media` não há média de variáveis para a rescisão;
--   • sem `incide_fgts` por competência não há extrato de FGTS real, que é o
--     que a fase 3 precisa para aposentar o `salário × 8% × meses` da 306.
--
-- A INVERSÃO QUE IMPORTA: a partir daqui as rubricas são a fonte, e os três
-- agregados passam a ser DERIVADOS delas (`SUM` por tipo no fim do recálculo).
-- Enquanto os dois fossem calculados em paralelo, um holerite que não fecha
-- com o líquido seria questão de tempo.
--
-- O aluno não digita rubrica: elas nascem do recálculo. O realismo sobe sem
-- aumentar o trabalho da aula.
--
-- IDEMPOTENTE. Depende da 319. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Tabela
--
-- Os quatro flags de incidência são o coração do arquivo. Eles é que dizem
-- se uma verba entra na base de INSS, de IRRF, de FGTS e na média dos últimos
-- 12 meses — e é lendo esses flags que a fase 3 vai montar o FGTS real e as
-- médias sem precisar saber o nome de cada rubrica.
--
-- `tipo = 'informativa'`: linha que aparece no holerite mas NÃO entra em
-- provento nem em desconto. FGTS é o caso clássico — a empresa deposita, o
-- trabalhador não paga. Somá-lo em qualquer dos dois lados falsearia o líquido.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.folha_rubricas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folha_id      uuid NOT NULL REFERENCES public.folha_pagamento(id) ON DELETE CASCADE,
  codigo        text NOT NULL,
  descricao     text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('provento', 'desconto', 'informativa')),
  -- Coluna "referência" do holerite: 30 dias, 12,50 h, 9%. Texto porque a
  -- unidade muda por rubrica e ninguém soma essa coluna.
  referencia    text,
  valor         numeric(15,2) NOT NULL DEFAULT 0,
  incide_inss   boolean NOT NULL DEFAULT false,
  incide_irrf   boolean NOT NULL DEFAULT false,
  incide_fgts   boolean NOT NULL DEFAULT false,
  -- Verba variável que entra na média de 12 meses para aviso, 13º e férias
  -- (horas extras, comissões, adicionais). Salário fixo NÃO integra: ele já é
  -- a base. É este flag que a fase 3 vai ler.
  integra_media boolean NOT NULL DEFAULT false,
  ordem         int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folha_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_folha_rubricas_folha
  ON public.folha_rubricas (folha_id, ordem);

-- Varredura da fase 3: "todas as rubricas com FGTS de um funcionário".
CREATE INDEX IF NOT EXISTS idx_folha_rubricas_fgts
  ON public.folha_rubricas (folha_id) WHERE incide_fgts;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Espelha `folha_pagamento` linha a linha: RH e gerente da filial, mais a
-- própria pessoa lendo o próprio holerite. Escrita não tem policy — as
-- rubricas nascem só do recálculo (SECURITY DEFINER), nunca de um POST.
ALTER TABLE public.folha_rubricas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folha_rubricas_select ON public.folha_rubricas;
CREATE POLICY folha_rubricas_select ON public.folha_rubricas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.folha_pagamento f
       WHERE f.id = folha_id
         AND (
           (
             (public.auth_in_setor('rh') OR public.auth_gerente_da(f.filial))
             AND public.auth_pode_filial(f.filial)
           )
           OR f.funcionario_id = (
             SELECT u.funcionario_id FROM public.user_profiles u WHERE u.id = auth.uid()
           )
         )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Recálculo passa a emitir rubricas — e a derivar os totais delas
--
-- Mesmo cálculo de horas da 292 e mesmos encargos da 319. O que muda é o
-- fim da função: em vez de gravar `bruto`/`descontos`/`líquido` calculados
-- em variáveis, grava as rubricas e depois SOMA a tabela. Se um dia uma
-- rubrica nova entrar, ela entra no total sozinha.
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
  v_base_inss     := GREATEST(ROUND(v_salario_base + v_bonus_extra, 2) - v_desc_faltas, 0);

  v_inss := public.rh_calc_inss(v_base_inss, v_competencia);
  v_irrf := public.rh_calc_irrf(v_base_inss - v_inss, v_competencia, v_dependentes);
  v_fgts := ROUND(v_base_inss * v_fgts_aliq, 2);

  -- ── Rubricas ─────────────────────────────────────────────────────────────
  -- Regeradas do zero a cada recálculo. DELETE + INSERT em vez de UPSERT
  -- porque rubrica que deixou de existir (a hora extra que sumiu do ponto)
  -- precisa DESAPARECER, não ficar zerada no holerite.
  DELETE FROM public.folha_rubricas WHERE folha_id = p_folha_id;

  INSERT INTO public.folha_rubricas
    (folha_id, codigo, descricao, tipo, referencia, valor,
     incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
  VALUES
    (p_folha_id, '001', 'Salário base', 'provento', '30 dias', v_salario_base,
     true, true, true, false, 1);

  -- Hora extra integra a média de 12 meses; salário fixo não, porque ele já
  -- É a base sobre a qual a média incide.
  IF v_bonus_extra > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '002', 'Horas extras 50%', 'provento',
       to_char(v_horas_extras, 'FM999990.00') || ' h', v_bonus_extra,
       true, true, true, true, 2);
  END IF;

  -- Falta é desconto que REDUZ a base de INSS/FGTS — por isso os flags de
  -- incidência vêm ligados aqui também. Dia não trabalhado não gera
  -- contribuição.
  IF v_desc_faltas > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '101', 'Faltas e atrasos', 'desconto',
       to_char(v_horas_atraso + v_horas_falta, 'FM999990.00') || ' h', v_desc_faltas,
       true, true, true, false, 10);
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

  -- Informativa: não entra em nenhum total. É a linha que a fase 3 vai somar
  -- competência a competência para o extrato de FGTS.
  INSERT INTO public.folha_rubricas
    (folha_id, codigo, descricao, tipo, referencia, valor,
     incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
  VALUES
    (p_folha_id, '901', 'FGTS depositado (empregador)', 'informativa',
     to_char(v_fgts_aliq * 100, 'FM990D00') || '%', v_fgts,
     false, false, false, false, 90);

  -- ── Totais DERIVADOS das rubricas ────────────────────────────────────────
  -- Este é o ponto da migration: a tabela manda. Somar variáveis aqui em
  -- paralelo faria o holerite e o líquido divergirem no primeiro ajuste.
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

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Backfill das folhas já recalculadas
--
-- Quem já rodou o recálculo depois da 319 tem os agregados certos mas nenhuma
-- rubrica — e o holerite abriria vazio. Reconstrói a partir das colunas que a
-- 319 gravou, que é tudo de que se precisa.
--
-- Só toca em folha SEM rubrica: rodar duas vezes não duplica nem sobrescreve.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.folha_rubricas
  (folha_id, codigo, descricao, tipo, referencia, valor,
   incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
SELECT f.id, '001', 'Salário base', 'provento', '30 dias',
       COALESCE(f.salario_base, f.salario_bruto, 0), true, true, true, false, 1
  FROM public.folha_pagamento f
 WHERE COALESCE(f.ativo, true)
   AND COALESCE(f.salario_base, f.salario_bruto, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM public.folha_rubricas r WHERE r.folha_id = f.id)
ON CONFLICT (folha_id, codigo) DO NOTHING;

INSERT INTO public.folha_rubricas
  (folha_id, codigo, descricao, tipo, referencia, valor,
   incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
SELECT f.id, '002', 'Horas extras 50%', 'provento',
       to_char(COALESCE(f.horas_extras, 0), 'FM999990.00') || ' h',
       ROUND(COALESCE(f.salario_bruto, 0) - COALESCE(f.salario_base, 0), 2),
       true, true, true, true, 2
  FROM public.folha_pagamento f
 WHERE COALESCE(f.ativo, true)
   AND ROUND(COALESCE(f.salario_bruto, 0) - COALESCE(f.salario_base, 0), 2) > 0
ON CONFLICT (folha_id, codigo) DO NOTHING;

INSERT INTO public.folha_rubricas
  (folha_id, codigo, descricao, tipo, referencia, valor,
   incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
SELECT f.id, '101', 'Faltas e atrasos', 'desconto',
       to_char(COALESCE(f.horas_atraso, 0) + COALESCE(f.horas_falta, 0), 'FM999990.00') || ' h',
       f.desconto_faltas, true, true, true, false, 10
  FROM public.folha_pagamento f
 WHERE COALESCE(f.ativo, true) AND COALESCE(f.desconto_faltas, 0) > 0
ON CONFLICT (folha_id, codigo) DO NOTHING;

INSERT INTO public.folha_rubricas
  (folha_id, codigo, descricao, tipo, referencia, valor,
   incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
SELECT f.id, '201', 'INSS', 'desconto',
       'base ' || to_char(COALESCE(f.base_inss, 0), 'FM999G999G990D00'),
       f.desconto_inss, false, false, false, false, 20
  FROM public.folha_pagamento f
 WHERE COALESCE(f.ativo, true) AND COALESCE(f.desconto_inss, 0) > 0
ON CONFLICT (folha_id, codigo) DO NOTHING;

INSERT INTO public.folha_rubricas
  (folha_id, codigo, descricao, tipo, referencia, valor,
   incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
SELECT f.id, '202', 'IRRF', 'desconto', NULL,
       f.desconto_irrf, false, false, false, false, 21
  FROM public.folha_pagamento f
 WHERE COALESCE(f.ativo, true) AND COALESCE(f.desconto_irrf, 0) > 0
ON CONFLICT (folha_id, codigo) DO NOTHING;

INSERT INTO public.folha_rubricas
  (folha_id, codigo, descricao, tipo, referencia, valor,
   incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
SELECT f.id, '901', 'FGTS depositado (empregador)', 'informativa', NULL,
       f.fgts_deposito, false, false, false, false, 90
  FROM public.folha_pagamento f
 WHERE COALESCE(f.ativo, true) AND COALESCE(f.fgts_deposito, 0) > 0
ON CONFLICT (folha_id, codigo) DO NOTHING;

-- Descontos manuais (folha lançada na mão, sem recálculo do ponto) não têm
-- coluna que os explique — entram como uma rubrica genérica para que o
-- holerite feche com o líquido em vez de mostrar um buraco.
INSERT INTO public.folha_rubricas
  (folha_id, codigo, descricao, tipo, referencia, valor,
   incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
SELECT f.id, '199', 'Descontos (lançamento manual)', 'desconto', NULL,
       ROUND(COALESCE(f.descontos, 0)
             - COALESCE(f.desconto_faltas, 0)
             - COALESCE(f.desconto_inss, 0)
             - COALESCE(f.desconto_irrf, 0), 2),
       false, false, false, false, 19
  FROM public.folha_pagamento f
 WHERE COALESCE(f.ativo, true)
   AND ROUND(COALESCE(f.descontos, 0)
             - COALESCE(f.desconto_faltas, 0)
             - COALESCE(f.desconto_inss, 0)
             - COALESCE(f.desconto_irrf, 0), 2) > 0
ON CONFLICT (folha_id, codigo) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação
--
--   -- Holerite fecha com o líquido? Esperado: nenhuma linha.
--   SELECT f.id, f.mes_ref, f.salario_liquido,
--          SUM(r.valor) FILTER (WHERE r.tipo = 'provento')
--        - SUM(r.valor) FILTER (WHERE r.tipo = 'desconto') AS pelas_rubricas
--     FROM folha_pagamento f JOIN folha_rubricas r ON r.folha_id = f.id
--    WHERE COALESCE(f.ativo, true)
--    GROUP BY f.id, f.mes_ref, f.salario_liquido
--   HAVING abs(f.salario_liquido - (SUM(r.valor) FILTER (WHERE r.tipo = 'provento')
--                                 - SUM(r.valor) FILTER (WHERE r.tipo = 'desconto'))) > 0.01;
--
--   -- Folhas ativas ainda sem rubrica (esperado: só as de salário zerado):
--   SELECT count(*) FROM folha_pagamento f
--    WHERE COALESCE(f.ativo, true)
--      AND NOT EXISTS (SELECT 1 FROM folha_rubricas r WHERE r.folha_id = f.id);
--
--   -- Prévia do que a fase 3 vai consumir:
--   SELECT f.funcionario_id, sum(r.valor) AS fgts_acumulado
--     FROM folha_rubricas r JOIN folha_pagamento f ON f.id = r.folha_id
--    WHERE r.codigo = '901' GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
-- ────────────────────────────────────────────────────────────────────────────
