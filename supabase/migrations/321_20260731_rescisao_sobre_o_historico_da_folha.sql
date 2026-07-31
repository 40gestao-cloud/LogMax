-- 321 — Fase 3: a rescisão passa a se apoiar no histórico da folha.
--
-- As fases 1 (319) e 2 (320) existiram para isto. Agora a rescisão colhe:
--
--   • FGTS REAL — soma `folha_pagamento.fgts_deposito` competência a
--     competência, no lugar de `salário atual × 8% × meses`, que ignorava
--     aumentos, faltas e afastamentos.
--   • MÉDIA DE VARIÁVEIS — média das rubricas com `integra_media` dos últimos
--     12 meses (horas extras hoje; comissões e adicionais quando existirem).
--     Ela integra aviso, 13º e férias, como manda a regra.
--
-- E junto vão três acertos de fidelidade que não dependiam da folha:
--
--   • PROJEÇÃO DO AVISO INDENIZADO — o aviso indenizado conta como tempo de
--     serviço: a data de saída projeta e pode render mais um avo de 13º e de
--     férias, às vezes um ano inteiro. É o erro mais comum em rescisão real e
--     o cálculo usava a data crua.
--   • 13º TRIBUTADO À PARTE — tributação exclusiva na fonte: INSS e IRRF
--     próprios, base separada do saldo de salário. Somar tudo numa base só
--     empurrava o total para faixa mais alta e superestimava o desconto.
--   • FÉRIAS EM DOBRO — período vencido além do prazo concessivo é pago em
--     dobro (art. 137). Vencidas eram sempre 1×.
--
-- FALLBACK, E ELE É O PONTO: turma que ainda não recalculou folha nenhuma não
-- tem histórico. Sem fallback, o FGTS viria zero e a média também — a rescisão
-- PIORARIA em vez de melhorar. Então: se não há competência com FGTS gravado,
-- o cálculo volta à simulação da 306 e diz isso em `fgts_origem`. A média
-- ausente vale zero, que é o comportamento anterior.
--
-- O QUE CONTINUA FORA: convenção coletiva, eSocial, estabilidades, 13º já
-- adiantado (a folha ainda não roda as parcelas de novembro/dezembro — sem
-- isso não há o que descontar). O aviso "não serve para rescisão real" fica.
--
-- IDEMPOTENTE. Depende da 319 e da 320. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Colunas novas em `rescisoes`
--
-- O demonstrativo salvo é lido da tabela, não recalculado. Sem estas colunas,
-- uma rescisão gravada mostraria férias e 13º que não reconciliam com o
-- salário base — e ninguém saberia que a diferença é a média de variáveis.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.rescisoes
  ADD COLUMN IF NOT EXISTS media_variaveis       numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ferias_periodos_dobro int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_projetada        date,
  -- 'real' = somado da folha; 'simulado' = fallback da 306. Guardar a origem
  -- evita a pergunta "esse FGTS veio de onde?" seis meses depois.
  ADD COLUMN IF NOT EXISTS fgts_origem           text          NOT NULL DEFAULT 'simulado',
  ADD COLUMN IF NOT EXISTS desconto_inss_13      numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_irrf_13      numeric(15,2) NOT NULL DEFAULT 0;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Leitores do histórico
--
-- `mes_ref` é texto livre ('YYYY-MM' por convenção). O regex é obrigatório:
-- um rótulo mal digitado faria `to_date` estourar no meio de uma rescisão.
-- ════════════════════════════════════════════════════════════════════════════

-- FGTS acumulado até a data, direto das competências gravadas pela 319.
CREATE OR REPLACE FUNCTION public.rh_fgts_acumulado(p_funcionario_id uuid, p_ate date)
RETURNS TABLE (total numeric, competencias int)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(f.fgts_deposito), 0)::numeric,
         COUNT(*)::int
    FROM public.folha_pagamento f
   WHERE f.funcionario_id = p_funcionario_id
     AND COALESCE(f.ativo, true)
     AND COALESCE(f.fgts_deposito, 0) > 0
     AND f.mes_ref ~ '^\d{4}-\d{2}$'
     AND to_date(f.mes_ref || '-01', 'YYYY-MM-DD') <= p_ate;
$function$;

-- Média das verbas variáveis dos últimos 12 meses.
--
-- Divide pelo número de COMPETÊNCIAS da janela, não pelo número de meses em
-- que houve variável: quem fez hora extra em 3 dos 12 meses tem média de 3/12,
-- não a média dos 3. Dividir só pelos meses com verba inflaria a média.
CREATE OR REPLACE FUNCTION public.rh_media_variaveis(p_funcionario_id uuid, p_ate date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH janela AS (
    SELECT f.id
      FROM public.folha_pagamento f
     WHERE f.funcionario_id = p_funcionario_id
       AND COALESCE(f.ativo, true)
       AND f.mes_ref ~ '^\d{4}-\d{2}$'
       AND to_date(f.mes_ref || '-01', 'YYYY-MM-DD') <= p_ate
     ORDER BY f.mes_ref DESC
     LIMIT 12
  )
  SELECT ROUND(
    COALESCE((
      SELECT SUM(r.valor) FROM public.folha_rubricas r
       WHERE r.folha_id IN (SELECT id FROM janela)
         AND r.integra_media AND r.tipo = 'provento'
    ), 0) / GREATEST((SELECT count(*) FROM janela), 1)
  , 2);
$function$;

REVOKE ALL ON FUNCTION public.rh_fgts_acumulado(uuid, date)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rh_media_variaveis(uuid, date)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_fgts_acumulado(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rh_media_variaveis(uuid, date) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. calcular_rescisao v3
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
  v_data_proj   date;
  v_dependentes int := 0;

  -- Remuneração = salário fixo + média das variáveis. É ela que move aviso,
  -- 13º e férias; o saldo de salário continua no salário fixo, porque as
  -- variáveis do mês corrente já foram pagas na folha.
  v_media_var   numeric(15,2) := 0;
  v_remuneracao numeric(15,2);
  v_dia_sal     numeric;
  v_dia_rem     numeric;

  v_anos_completos  int;
  v_meses_total     int;
  v_meses_ano       int;
  v_meses_aquisit   int;
  v_ferias_gozadas  int;
  v_periodos_venc   int;
  v_per_dobro       int := 0;
  v_per_simples     int := 0;

  v_dias_aviso  int := 0;
  v_saldo       numeric(15,2) := 0;
  v_aviso       numeric(15,2) := 0;
  v_decimo      numeric(15,2) := 0;
  v_fer_venc    numeric(15,2) := 0;
  v_fer_prop    numeric(15,2) := 0;
  v_terco       numeric(15,2) := 0;
  v_fgts_dep    numeric(15,2) := 0;
  v_fgts_origem text := 'simulado';
  v_fgts_comp   int := 0;
  v_multa       numeric(15,2) := 0;

  v_inss_sal    numeric(15,2) := 0;
  v_irrf_sal    numeric(15,2) := 0;
  v_inss_13     numeric(15,2) := 0;
  v_irrf_13     numeric(15,2) := 0;
  v_inss        numeric(15,2) := 0;
  v_irrf        numeric(15,2) := 0;
  v_desc_aviso  numeric(15,2) := 0;

  v_bruto       numeric(15,2);
  v_descontos   numeric(15,2);
  v_liquido     numeric(15,2);
BEGIN
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

  IF v_admissao IS NULL THEN
    RAISE EXCEPTION 'Funcionário sem data de admissão. Preencha em RH → Funcionários antes de calcular a rescisão.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_data < v_admissao THEN
    RAISE EXCEPTION 'Desligamento (%) não pode ser anterior à admissão (%).', v_data, v_admissao
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Média de variáveis (fase 2 → fase 3) ─────────────────────────────────
  v_media_var   := COALESCE(public.rh_media_variaveis(p_funcionario_id, v_data), 0);
  v_remuneracao := ROUND(v_salario + v_media_var, 2);
  v_dia_sal     := ROUND(v_salario / 30.0, 2);
  v_dia_rem     := ROUND(v_remuneracao / 30.0, 2);

  -- ── Aviso prévio e a PROJEÇÃO ────────────────────────────────────────────
  -- Os dias de aviso dependem do tempo de casa na data real; a projeção só
  -- entra depois, para 13º e férias.
  v_anos_completos := GREATEST((EXTRACT(YEAR FROM age(v_data, v_admissao)) * 12
                              + EXTRACT(MONTH FROM age(v_data, v_admissao)))::int, 0) / 12;
  v_dias_aviso := LEAST(30 + (v_anos_completos * 3), 90);

  v_data_proj := v_data;

  IF p_tipo = 'Sem justa causa' THEN
    IF p_aviso_previo = 'Indenizado' THEN
      v_aviso := ROUND(v_dia_rem * v_dias_aviso, 2);
      -- Aviso indenizado integra o tempo de serviço (art. 487 §1º): a saída
      -- projeta e pode render mais um avo de 13º e de férias.
      v_data_proj := v_data + v_dias_aviso;
    END IF;

  ELSIF p_tipo = 'Acordo' THEN
    -- Art. 484-A: metade do aviso. A projeção acompanha a metade paga.
    v_aviso     := ROUND(v_dia_rem * v_dias_aviso / 2.0, 2);
    v_data_proj := v_data + (v_dias_aviso / 2);

  ELSIF p_tipo = 'Pedido de demissão' THEN
    IF p_aviso_previo = 'Não cumprido' THEN
      v_desc_aviso := ROUND(v_dia_rem * 30, 2);
    END IF;
    v_dias_aviso := 0;

  ELSE  -- Com justa causa
    v_dias_aviso := 0;
  END IF;

  -- ── Tempo de casa, agora sobre a data projetada ──────────────────────────
  v_meses_total    := GREATEST((EXTRACT(YEAR FROM age(v_data_proj, v_admissao)) * 12
                              + EXTRACT(MONTH FROM age(v_data_proj, v_admissao)))::int, 0);
  v_anos_completos := v_meses_total / 12;

  -- 13º: meses do ano corrente com 15 dias ou mais trabalhados. Os dois
  -- extremos entram pela mesma régua — no mês da ADMISSÃO trabalha-se de `dia`
  -- até o fim (só conta se entrou até o 16); no mês da SAÍDA, de 1 até `dia`
  -- (conta a partir do 15).
  DECLARE
    v_mes_ini int := 1;
    v_mes_fim int;
  BEGIN
    IF EXTRACT(YEAR FROM v_admissao) = EXTRACT(YEAR FROM v_data_proj) THEN
      v_mes_ini := EXTRACT(MONTH FROM v_admissao)::int
                   + CASE WHEN EXTRACT(DAY FROM v_admissao)::int > 16 THEN 1 ELSE 0 END;
    END IF;

    v_mes_fim := EXTRACT(MONTH FROM v_data_proj)::int
                 - CASE WHEN EXTRACT(DAY FROM v_data_proj)::int < 15 THEN 1 ELSE 0 END;

    -- Projeção que cruza o ano vira 12/12: o avo de dezembro já é o teto.
    IF EXTRACT(YEAR FROM v_data_proj) > EXTRACT(YEAR FROM v_data)
       AND EXTRACT(YEAR FROM v_admissao) < EXTRACT(YEAR FROM v_data_proj) THEN
      v_mes_fim := 12;
    END IF;

    v_meses_ano := GREATEST(LEAST(v_mes_fim - v_mes_ini + 1, 12), 0);
  END;

  v_meses_aquisit := v_meses_total - (v_anos_completos * 12);

  -- ── Férias vencidas, com dobro ───────────────────────────────────────────
  -- Simplificação mantida da 306: cada registro de férias aprovado vale um
  -- período aquisitivo.
  SELECT count(*) INTO v_ferias_gozadas
    FROM public.ferias
   WHERE funcionario_id = p_funcionario_id
     AND COALESCE(ativo, true)
     AND status = 'Aprovado';
  v_periodos_venc := GREATEST(v_anos_completos - COALESCE(v_ferias_gozadas, 0), 0);

  -- Art. 137: vencido além do prazo concessivo (12 meses após o aquisitivo)
  -- é pago em dobro. Aproximação: o período vencido mais recente ainda pode
  -- estar dentro do prazo; qualquer um anterior a ele necessariamente
  -- estourou. Amarrar cada período à sua data exigiria o histórico de
  -- períodos aquisitivos, que não existe nesta base.
  v_per_dobro   := GREATEST(v_periodos_venc - 1, 0);
  v_per_simples := v_periodos_venc - v_per_dobro;

  -- ── Saldo de salário: dias do mês do desligamento REAL ───────────────────
  -- A projeção não gera dia trabalhado; ela conta como tempo de serviço.
  v_saldo := ROUND(v_dia_sal * EXTRACT(DAY FROM v_data)::int, 2);

  -- ── 13º proporcional: justa causa perde ──────────────────────────────────
  IF p_tipo <> 'Com justa causa' THEN
    v_decimo := ROUND(v_remuneracao * v_meses_ano / 12.0, 2);
  END IF;

  -- ── Férias ───────────────────────────────────────────────────────────────
  -- Vencidas são direito adquirido: nem a justa causa tira.
  v_fer_venc := ROUND(v_remuneracao * (v_per_simples + 2 * v_per_dobro), 2);

  IF p_tipo <> 'Com justa causa' THEN
    v_fer_prop := ROUND(v_remuneracao * v_meses_aquisit / 12.0, 2);
  END IF;

  v_terco := ROUND((v_fer_venc + v_fer_prop) / 3.0, 2);

  -- ── FGTS: real quando há folha, simulado quando não há ───────────────────
  SELECT total, competencias INTO v_fgts_dep, v_fgts_comp
    FROM public.rh_fgts_acumulado(p_funcionario_id, v_data);

  IF COALESCE(v_fgts_comp, 0) > 0 THEN
    v_fgts_origem := 'real';
  ELSE
    -- Fallback da 306. Sem ele, turma que nunca recalculou folha teria FGTS
    -- zero e multa zero — a rescisão pioraria em vez de melhorar.
    v_fgts_dep    := ROUND(v_salario * 0.08 * v_meses_total, 2);
    v_fgts_origem := 'simulado';
  END IF;

  v_multa := CASE p_tipo
    WHEN 'Sem justa causa' THEN ROUND(v_fgts_dep * 0.40, 2)
    WHEN 'Acordo'          THEN ROUND(v_fgts_dep * 0.20, 2)
    ELSE 0
  END;

  -- ── Descontos ────────────────────────────────────────────────────────────
  -- Aviso indenizado, férias indenizadas e multa do FGTS são indenizatórios —
  -- não são base de nada.
  --
  -- O 13º tem tributação EXCLUSIVA na fonte: base própria, INSS e IRRF
  -- próprios. Somar 13º e saldo numa base só empurrava o total para faixa
  -- mais alta e cobrava imposto a mais.
  v_inss_sal := public.rh_calc_inss(v_saldo, v_data);
  v_irrf_sal := public.rh_calc_irrf(v_saldo - v_inss_sal, v_data, v_dependentes);

  IF v_decimo > 0 THEN
    v_inss_13 := public.rh_calc_inss(v_decimo, v_data);
    v_irrf_13 := public.rh_calc_irrf(v_decimo - v_inss_13, v_data, v_dependentes);
  END IF;

  v_inss := v_inss_sal + v_inss_13;
  v_irrf := v_irrf_sal + v_irrf_13;

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
    'media_variaveis',      v_media_var,
    'remuneracao',          v_remuneracao,
    'data_admissao',        v_admissao,
    'data_desligamento',    v_data,
    'data_projetada',       v_data_proj,
    'meses_trabalhados',    v_meses_total,
    'anos_completos',       v_anos_completos,
    'dias_aviso',           v_dias_aviso,
    'periodos_ferias_vencidas', v_periodos_venc,
    'ferias_periodos_dobro',    v_per_dobro,
    'dependentes',          v_dependentes,
    'vigencia_tabela',      public.rh_vigencia_em(v_data),
    'saldo_salario',        v_saldo,
    'aviso_previo_valor',   v_aviso,
    'decimo_terceiro',      v_decimo,
    'ferias_vencidas',      v_fer_venc,
    'ferias_proporcionais', v_fer_prop,
    'terco_ferias',         v_terco,
    'fgts_depositado',      v_fgts_dep,
    'fgts_origem',          v_fgts_origem,
    'fgts_competencias',    COALESCE(v_fgts_comp, 0),
    'multa_fgts',           v_multa,
    'desconto_inss',        v_inss,
    'desconto_irrf',        v_irrf,
    'desconto_inss_13',     v_inss_13,
    'desconto_irrf_13',     v_irrf_13,
    'desconto_aviso',       v_desc_aviso,
    'total_bruto',          v_bruto,
    'total_descontos',      v_descontos,
    'total_liquido',        v_liquido
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calcular_rescisao(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_rescisao(uuid, text, date, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Gravação da rescisão, num lugar só
--
-- `demitir_funcionario` e `decidir_desligamento` gravavam a mesma linha com a
-- mesma lista de 23 colunas, duplicada. Cada campo novo obrigava a editar as
-- duas — e é assim que as duas divergem. Agora a lista mora aqui.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rescisao_gravar(
  p_demissao_id    uuid,
  p_funcionario_id uuid,
  p_profile_id     uuid,
  p_filial         text,
  p_calc           jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.rescisoes (
    demissao_id, funcionario_id, user_profile_id, filial,
    salario_base, data_admissao, data_desligamento, meses_trabalhados, dias_aviso,
    saldo_salario, aviso_previo_valor, decimo_terceiro,
    ferias_vencidas, ferias_proporcionais, terco_ferias,
    multa_fgts, fgts_depositado,
    desconto_inss, desconto_irrf, desconto_aviso,
    total_bruto, total_descontos, total_liquido,
    media_variaveis, ferias_periodos_dobro, data_projetada, fgts_origem,
    desconto_inss_13, desconto_irrf_13
  )
  VALUES (
    p_demissao_id, p_funcionario_id, p_profile_id, p_filial,
    (p_calc->>'salario_base')::numeric,
    (p_calc->>'data_admissao')::date,
    (p_calc->>'data_desligamento')::date,
    (p_calc->>'meses_trabalhados')::int,
    (p_calc->>'dias_aviso')::int,
    (p_calc->>'saldo_salario')::numeric,
    (p_calc->>'aviso_previo_valor')::numeric,
    (p_calc->>'decimo_terceiro')::numeric,
    (p_calc->>'ferias_vencidas')::numeric,
    (p_calc->>'ferias_proporcionais')::numeric,
    (p_calc->>'terco_ferias')::numeric,
    (p_calc->>'multa_fgts')::numeric,
    (p_calc->>'fgts_depositado')::numeric,
    (p_calc->>'desconto_inss')::numeric,
    (p_calc->>'desconto_irrf')::numeric,
    (p_calc->>'desconto_aviso')::numeric,
    (p_calc->>'total_bruto')::numeric,
    (p_calc->>'total_descontos')::numeric,
    (p_calc->>'total_liquido')::numeric,
    COALESCE((p_calc->>'media_variaveis')::numeric, 0),
    COALESCE((p_calc->>'ferias_periodos_dobro')::int, 0),
    (p_calc->>'data_projetada')::date,
    COALESCE(p_calc->>'fgts_origem', 'simulado'),
    COALESCE((p_calc->>'desconto_inss_13')::numeric, 0),
    COALESCE((p_calc->>'desconto_irrf_13')::numeric, 0)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Só as duas RPCs de desligamento chamam. Ninguém grava rescisão pelo PostgREST.
REVOKE ALL ON FUNCTION public.rescisao_gravar(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. As duas RPCs passam a usar o gravador comum
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.demitir_funcionario(
  p_funcionario_id uuid,
  p_tipo           text,
  p_motivo         text,
  p_data           date DEFAULT NULL,
  p_aviso_previo   text DEFAULT 'Indenizado',
  p_observacao     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_nome        text;
  v_filial      text;
  v_profile_id  uuid;
  v_data        date;
  v_calc        jsonb;
  v_demissao_id uuid;
  v_rescisao_id uuid;
  v_quem        text;
BEGIN
  PERFORM public._assert_rpc();

  -- auth_is_admin() não serve: inclui conselheiro. Desligar é admin ou CEO.
  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO podem desligar um colaborador.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Escreva o motivo do desligamento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome, COALESCE(filial, 'Matriz'), user_profile_id
    INTO v_nome, v_filial, v_profile_id
    FROM public.funcionarios
   WHERE id = p_funcionario_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile_id IS NOT NULL AND v_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode desligar a si mesmo.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes
              WHERE funcionario_id = p_funcionario_id AND ativo) THEN
    RAISE EXCEPTION '% já está desligado. Readmita antes de registrar novo desligamento.', v_nome
      USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');

  v_calc := public.calcular_rescisao(p_funcionario_id, p_tipo, v_data, p_aviso_previo);

  INSERT INTO public.demissoes
    (funcionario_id, nome_funcionario, filial, tipo, motivo, data_desligamento,
     aviso_previo, observacao, decidido_por, decidido_por_nome)
  VALUES
    (p_funcionario_id, v_nome, v_filial, p_tipo, btrim(p_motivo), v_data,
     p_aviso_previo, p_observacao, auth.uid(), v_quem)
  RETURNING id INTO v_demissao_id;

  v_rescisao_id := public.rescisao_gravar(
    v_demissao_id, p_funcionario_id, v_profile_id, v_filial, v_calc);

  UPDATE public.funcionarios
     SET status = 'Desligado', updated_at = now()
   WHERE id = p_funcionario_id;

  IF v_profile_id IS NOT NULL THEN
    UPDATE public.user_profiles
       SET desligado_em = now()
     WHERE id = v_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'demissao_id', v_demissao_id,
    'rescisao_id', v_rescisao_id,
    'funcionario', v_nome,
    'acesso_cortado', v_profile_id IS NOT NULL,
    'rescisao', v_calc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.demitir_funcionario(uuid, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demitir_funcionario(uuid, text, text, date, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decidir_desligamento(
  p_demissao_id uuid,
  p_aprovar     boolean,
  p_observacao  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_quem        text;
  v_d           record;
  v_profile_id  uuid;
  v_calc        jsonb;
  v_rescisao_id uuid;
BEGIN
  PERFORM public._assert_rpc();

  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO decidem um desligamento.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_d FROM public.demissoes
   WHERE id = p_demissao_id AND ativo
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_d.status <> 'Solicitado' THEN
    RAISE EXCEPTION 'Esta solicitação já foi decidida (%).', v_d.status USING ERRCODE = 'P0001';
  END IF;

  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');

  IF NOT COALESCE(p_aprovar, false) THEN
    UPDATE public.demissoes
       SET status = 'Recusado',
           ativo  = false,
           decidido_por = auth.uid(),
           decidido_por_nome = v_quem,
           observacao = COALESCE(observacao || ' · ', '')
                        || 'Recusado pela Matriz em '
                        || to_char((now() AT TIME ZONE 'America/Rio_Branco')::date, 'DD/MM/YYYY')
                        || COALESCE(': ' || btrim(p_observacao), ''),
           updated_at = now()
     WHERE id = p_demissao_id;

    RETURN jsonb_build_object('ok', true, 'status', 'Recusado', 'funcionario', v_d.nome_funcionario);
  END IF;

  SELECT user_profile_id INTO v_profile_id
    FROM public.funcionarios WHERE id = v_d.funcionario_id FOR UPDATE;

  IF v_profile_id IS NOT NULL AND v_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode aprovar o próprio desligamento.' USING ERRCODE = 'P0001';
  END IF;

  -- Recalcula na aprovação: o valor que vale é o do momento da decisão.
  v_calc := public.calcular_rescisao(
    v_d.funcionario_id, v_d.tipo, v_d.data_desligamento, v_d.aviso_previo);

  v_rescisao_id := public.rescisao_gravar(
    v_d.id, v_d.funcionario_id, v_profile_id, v_d.filial, v_calc);

  UPDATE public.demissoes
     SET status = 'Aprovado',
         decidido_por = auth.uid(),
         decidido_por_nome = v_quem,
         observacao = CASE
           WHEN COALESCE(btrim(p_observacao), '') = '' THEN observacao
           ELSE COALESCE(observacao || ' · ', '') || btrim(p_observacao)
         END,
         updated_at = now()
   WHERE id = p_demissao_id;

  UPDATE public.funcionarios
     SET status = 'Desligado', updated_at = now()
   WHERE id = v_d.funcionario_id;

  IF v_profile_id IS NOT NULL THEN
    UPDATE public.user_profiles SET desligado_em = now() WHERE id = v_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'Aprovado',
    'funcionario', v_d.nome_funcionario,
    'rescisao_id', v_rescisao_id,
    'acesso_cortado', v_profile_id IS NOT NULL,
    'rescisao', v_calc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.decidir_desligamento(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_desligamento(uuid, boolean, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação
--
--   -- Quem já tem histórico de FGTS na folha (vira 'real' na rescisão):
--   SELECT funcionario_id, (rh_fgts_acumulado(funcionario_id, CURRENT_DATE)).*
--     FROM (SELECT DISTINCT funcionario_id FROM folha_pagamento
--            WHERE COALESCE(fgts_deposito,0) > 0) s;
--
--   -- Média de variáveis de quem fez hora extra:
--   SELECT DISTINCT f.funcionario_id,
--          rh_media_variaveis(f.funcionario_id, CURRENT_DATE) AS media
--     FROM folha_pagamento f JOIN folha_rubricas r ON r.folha_id = f.id
--    WHERE r.integra_media ORDER BY 2 DESC LIMIT 5;
--
--   -- Projeção do aviso: data_projetada > data_desligamento em Sem justa
--   -- causa + Indenizado, igual nos demais.
--   SELECT tipo, count(*) FILTER (WHERE data_projetada > data_desligamento) AS projetadas,
--          count(*) AS total
--     FROM rescisoes r JOIN demissoes d ON d.id = r.demissao_id
--    GROUP BY tipo;
-- ────────────────────────────────────────────────────────────────────────────
