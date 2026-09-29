-- 656_20260928_preco_de_venda_pelo_markup_divisor.sql
--
-- O preço de venda era custo × (1 + markup), com o markup digitado livre na
-- categoria. Imposto, taxa de cartão e despesa da loja são percentuais do
-- PREÇO, não do custo — somá-los ao markup subprecifica sempre:
--
--   custo 10; Simples 6%, taxas 2%, despesas 15%, lucro desejado 10% (33%)
--   multiplicador: 10 × 1,33 = 13,30 → sobram R$ 0,24, lucro de 1,8%
--   divisor:       10 / 0,67 = 14,93 → sobram R$ 1,49, lucro de 10%
--
-- REGRA NOVA — markup divisor:  PV = custo / (1 − (imposto% + taxas% + despesas% + lucro%))
--
--   • imposto%  — Simples Nacional, Anexo I (comércio). Alíquota efetiva =
--                 (RBT12 × nominal − parcela a deduzir) / RBT12, pela faixa
--                 da receita bruta dos 12 meses anteriores (LC 123, art. 18).
--                 Início de atividade (§ 2º): no 1º mês, a receita do próprio
--                 mês × 12; do 2º ao 12º, a média dos meses anteriores × 12.
--   • taxas%    — o que a adquirente reteve (conciliação da maquininha, migr.
--                 570) sobre o faturamento dos últimos 3 meses fechados.
--   • despesas% — despesas do DRE sobre o faturamento da mesma janela, sem a
--                 taxa da adquirente (que já está em taxas%).
--   • lucro%    — `categorias_produto.lucro_alvo`, novo. O markup passa a ser
--                 consequência da conta; `margem_alvo` fica como legado.
--
-- Os três primeiros saem do histórico. Cada um aceita valor manual em
-- `filial_precificacao` (filial nova sem histórico, ou o professor simulando
-- outra faixa) — manual preenchido vence o histórico, vazio devolve a ele.
--
-- O DRE ganha a linha "(−) Impostos sobre vendas" entre a receita bruta e a
-- líquida, mês a mês pela alíquota de cada mês. Sem ela o preço embutiria o
-- imposto e o resultado nunca o mostraria. O cálculo do DRE sai para
-- `_dre_calculo` (sem os guardas) para `parametros_precificacao` ler as
-- despesas da janela: quem cadastra produto não abre o DRE, mas precisa do
-- percentual. `gerar_dre` fica com os guardas e chama o cálculo.
--
-- Fora de escopo: Anexo III (serviço da TechMax), sublimite de ICMS, DAS como
-- conta a pagar, frete de transportadora rateado no custo.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- 1. Parâmetros por filial ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.filial_precificacao (
  filial              text PRIMARY KEY,
  regime              text NOT NULL DEFAULT 'simples_anexo_i'
                        CHECK (regime IN ('simples_anexo_i')),
  rbt12_manual        numeric(15,2) CHECK (rbt12_manual IS NULL OR rbt12_manual >= 0),
  despesas_pct_manual numeric(5,2)  CHECK (despesas_pct_manual IS NULL OR (despesas_pct_manual >= 0 AND despesas_pct_manual < 100)),
  taxas_pct_manual    numeric(5,2)  CHECK (taxas_pct_manual IS NULL OR (taxas_pct_manual >= 0 AND taxas_pct_manual < 100)),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

COMMENT ON TABLE public.filial_precificacao IS
  'Regime tributário e valores manuais da formação de preço (migr. 656). Sem linha = Simples Anexo I com tudo pelo histórico. Lida e escrita só pelas RPCs parametros_precificacao / salvar_parametros_precificacao.';

ALTER TABLE public.filial_precificacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.filial_precificacao FROM anon, authenticated;

-- 2. Lucro desejado por categoria -------------------------------------------

ALTER TABLE public.categorias_produto
  ADD COLUMN IF NOT EXISTS lucro_alvo numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categorias_lucro_alvo_check') THEN
    ALTER TABLE public.categorias_produto
      ADD CONSTRAINT categorias_lucro_alvo_check
      CHECK (lucro_alvo IS NULL OR (lucro_alvo >= 0 AND lucro_alvo < 100));
  END IF;
END $$;

COMMENT ON COLUMN public.categorias_produto.lucro_alvo IS
  'Margem de lucro LÍQUIDO desejada, em % do preço de venda (migr. 656). Entra no markup divisor junto com imposto, taxas e despesas da filial.';
COMMENT ON COLUMN public.categorias_produto.margem_alvo IS
  'LEGADO (migr. 360): markup multiplicador digitado livre. Substituído por lucro_alvo na migr. 656; não alimenta mais o preço sugerido.';

-- 3. Simples Nacional — Anexo I ---------------------------------------------

CREATE OR REPLACE FUNCTION public.simples_anexo_i(p_rbt12 numeric)
RETURNS TABLE (faixa integer, aliquota_nominal numeric, parcela_deduzir numeric, aliquota_efetiva numeric)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  -- Tabela do Anexo I (LC 123, redação da LC 155/2016). Acima de R$ 4,8 mi a
  -- empresa sai do Simples; aqui fica na 6ª faixa e quem chama avisa.
  WITH t(faixa, ate, nominal, deduzir) AS (VALUES
    (1,  180000.00,  4.00,      0.00),
    (2,  360000.00,  7.30,   5940.00),
    (3,  720000.00,  9.50,  13860.00),
    (4, 1800000.00, 10.70,  22500.00),
    (5, 3600000.00, 14.30,  87300.00),
    (6,        NULL, 19.00, 378000.00)
  ), f AS (
    SELECT * FROM t
     WHERE t.ate IS NULL OR GREATEST(COALESCE(p_rbt12, 0), 0) <= t.ate
     ORDER BY t.faixa
     LIMIT 1
  )
  SELECT f.faixa, f.nominal, f.deduzir,
         CASE WHEN COALESCE(p_rbt12, 0) <= 0 THEN f.nominal
              ELSE ROUND((p_rbt12 * f.nominal / 100 - f.deduzir) / p_rbt12 * 100, 4)
         END
    FROM f;
$function$;

REVOKE ALL ON FUNCTION public.simples_anexo_i(numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.simples_anexo_i(numeric) TO authenticated;

-- Receita bruta para o Simples: venda menos desconto incondicional e
-- devolução. É a mesma "receita bruta − descontos − devoluções" do DRE.
CREATE OR REPLACE FUNCTION public._receita_simples(p_filial text, p_inicio date, p_fim date)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ROUND(
    COALESCE((SELECT SUM(v.total - COALESCE(v.desconto, 0) - COALESCE(v.cupom_desconto, 0))
                FROM public.vendas v
               WHERE v.ativo = true
                 AND v.filial = p_filial
                 AND v.status <> 'Cancelada'
                 AND v.created_at::date BETWEEN p_inicio AND p_fim), 0)
  - COALESCE((SELECT SUM(d.valor_devolvido)
                FROM public.devolucoes d
               WHERE d.ativo = true
                 AND d.filial = p_filial
                 AND d.created_at::date BETWEEN p_inicio AND p_fim), 0), 2);
$function$;

REVOKE ALL ON FUNCTION public._receita_simples(text, date, date) FROM public, anon, authenticated;

-- RBT12 do mês de apuração `p_mes`.
CREATE OR REPLACE FUNCTION public._simples_rbt12(p_filial text, p_mes date)
RETURNS TABLE (rbt12 numeric, origem text, meses integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mes    date := date_trunc('month', p_mes)::date;
  v_manual numeric;
  v_inicio date;
  v_n      integer;
BEGIN
  SELECT fp.rbt12_manual INTO v_manual
    FROM public.filial_precificacao fp WHERE fp.filial = p_filial;
  IF v_manual IS NOT NULL THEN
    RETURN QUERY SELECT v_manual, 'manual'::text, NULL::integer;
    RETURN;
  END IF;

  -- Início de atividade = mês da primeira venda. O reset da turma apaga as
  -- vendas, e a filial recomeça como empresa nova — que é o que ela é.
  SELECT date_trunc('month', MIN(v.created_at))::date INTO v_inicio
    FROM public.vendas v
   WHERE v.ativo = true AND v.filial = p_filial AND v.status <> 'Cancelada';

  IF v_inicio IS NULL OR v_inicio >= v_mes THEN
    RETURN QUERY SELECT
      ROUND(public._receita_simples(p_filial, v_mes, (v_mes + interval '1 month' - interval '1 day')::date) * 12, 2),
      'primeiro_mes'::text, 0;
    RETURN;
  END IF;

  v_n := (EXTRACT(YEAR FROM age(v_mes, v_inicio)) * 12 + EXTRACT(MONTH FROM age(v_mes, v_inicio)))::integer;

  IF v_n >= 12 THEN
    RETURN QUERY SELECT
      public._receita_simples(p_filial, (v_mes - interval '12 months')::date, v_mes - 1),
      '12_meses'::text, 12;
  ELSE
    RETURN QUERY SELECT
      ROUND(public._receita_simples(p_filial, v_inicio, v_mes - 1) / v_n * 12, 2),
      'proporcional'::text, v_n;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._simples_rbt12(text, date) FROM public, anon, authenticated;

-- 4. DRE: cálculo separado dos guardas, com imposto -------------------------

CREATE OR REPLACE FUNCTION public._dre_calculo(p_filial text, p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receita_bruta   numeric(15,2);
  v_descontos       numeric(15,2);
  v_devolucoes      numeric(15,2);
  v_receita_liquida numeric(15,2);
  v_cmv             numeric(15,2);
  v_cmv_devolvido   numeric(15,2);
  v_lucro_bruto     numeric(15,2);
  v_despesas        numeric(15,2);
  v_resultado       numeric(15,2);
  v_grupos          jsonb;
  v_sem_custo       integer;
  v_itens           integer;
  v_consumo         numeric(15,2);
  v_consumo_sem     integer;
  v_cmv_ajuste      numeric(15,2);
  v_impostos        numeric(15,2);
  v_impostos_meses  jsonb;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(v.total), 0),
         COALESCE(SUM(COALESCE(v.desconto, 0) + COALESCE(v.cupom_desconto, 0)), 0)
    INTO v_receita_bruta, v_descontos
    FROM public.vendas v
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(d.valor_devolvido), 0)
    INTO v_devolucoes
    FROM public.devolucoes d
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  -- MIGR 656: Simples Nacional mês a mês — cada mês na alíquota da sua faixa.
  SELECT COALESCE(SUM(x.imposto), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'mes', x.mes, 'base', x.base, 'rbt12', x.rbt12, 'rbt12_origem', x.origem,
           'faixa', x.faixa, 'aliquota_efetiva', x.efetiva, 'imposto', x.imposto) ORDER BY x.mes), '[]'::jsonb)
    INTO v_impostos, v_impostos_meses
    FROM (
      SELECT g.mes, b.base, r.rbt12, r.origem, a.faixa, a.aliquota_efetiva AS efetiva,
             ROUND(GREATEST(b.base, 0) * a.aliquota_efetiva / 100, 2) AS imposto
        FROM (SELECT gs::date AS mes
                FROM generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') gs) g
        CROSS JOIN LATERAL (SELECT public._receita_simples(p_filial,
                              GREATEST(p_inicio, g.mes),
                              LEAST(p_fim, (g.mes + interval '1 month' - interval '1 day')::date)) AS base) b
        CROSS JOIN LATERAL public._simples_rbt12(p_filial, g.mes) r
        CROSS JOIN LATERAL public.simples_anexo_i(r.rbt12) a
       WHERE b.base <> 0
    ) x;

  v_receita_liquida := ROUND(v_receita_bruta - v_descontos - v_devolucoes - v_impostos, 2);

  SELECT COALESCE(SUM(iv.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0),
         COUNT(*) FILTER (WHERE iv.custo_unitario IS NULL),
         COUNT(*)
    INTO v_cmv, v_sem_custo, v_itens
    FROM public.itens_venda iv
    JOIN public.vendas v ON v.id = iv.venda_id
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = iv.produto_id
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(idev.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0)
    INTO v_cmv_devolvido
    FROM public.itens_devolucao idev
    JOIN public.devolucoes d ON d.id = idev.devolucao_id
    LEFT JOIN LATERAL (
      SELECT iv2.custo_unitario
        FROM public.itens_venda iv2
       WHERE iv2.venda_id = d.venda_id
         AND iv2.produto_id IS NOT DISTINCT FROM idev.produto_id
       LIMIT 1
    ) iv ON true
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = idev.produto_id
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  v_cmv         := ROUND(GREATEST(v_cmv - v_cmv_devolvido, 0), 2);

  -- MIGR 645: diferença entre a nota e o pedido na parte da mercadoria que já
  -- tinha sido vendida quando a nota foi conferida. O que ainda estava em
  -- estoque foi para o custo médio e sai no CMV das vendas seguintes.
  SELECT COALESCE(SUM(a.valor_resultado), 0)
    INTO v_cmv_ajuste
    FROM public.ajustes_custo_compra a
   WHERE a.filial = p_filial
     AND a.destino = 'cmv'
     AND a.data BETWEEN p_inicio AND p_fim;
  v_cmv := ROUND(v_cmv + v_cmv_ajuste, 2);

  v_lucro_bruto := ROUND(v_receita_liquida - v_cmv, 2);

  -- Migr. 442/447/508: material de consumo que saiu para os setores no período.
  SELECT COALESCE(SUM(cm.valor), 0),
         COUNT(*) FILTER (WHERE cm.custo_unitario IS NULL)
    INTO v_consumo, v_consumo_sem
    FROM public.consumos_material cm
   WHERE cm.ativo = true
     AND cm.filial = p_filial
     AND cm.data BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(t.valor), 0),
         COALESCE(jsonb_agg(jsonb_build_object('grupo', t.grupo, 'valor', t.valor)
                            ORDER BY t.valor DESC), '[]'::jsonb)
    INTO v_despesas, v_grupos
    FROM (
      SELECT COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cp.valor), 2) AS valor
        FROM public.contas_pagar cp
        LEFT JOIN public.centros_custo cc ON cc.id = cp.centro_custo_id
       WHERE cp.ativo = true
         AND cp.filial = p_filial
         AND cp.status <> 'Cancelado'
         AND COALESCE(cp.natureza, 'despesa') NOT IN ('estoque', 'imobilizado')
         AND COALESCE(cp.origem, '') NOT IN ('devolucao_pdv', 'emprestimo')
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado')

      UNION ALL

      SELECT COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cm.valor), 2) AS valor
        FROM public.consumos_material cm
        LEFT JOIN public.centros_custo cc2 ON cc2.id = cm.centro_custo_id
       WHERE cm.ativo = true
         AND cm.filial = p_filial
         AND cm.data BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado')

      UNION ALL

      SELECT 'Despesas financeiras'::text AS grupo,
             ROUND(SUM(COALESCE(pe.juros, 0)), 2) AS valor
        FROM public.contas_pagar cp
        JOIN public.parcelas_emprestimo pe ON pe.contas_pagar_id = cp.id
       WHERE cp.ativo = true
         AND cp.filial = p_filial
         AND cp.status <> 'Cancelado'
         AND COALESCE(cp.origem, '') = 'emprestimo'
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
      HAVING ROUND(SUM(COALESCE(pe.juros, 0)), 2) > 0

      UNION ALL

      -- MIGR 645: mesma diferença, para material de consumo já consumido.
      SELECT 'Ajuste de custo de compras'::text AS grupo, ROUND(SUM(a.valor_resultado), 2) AS valor
        FROM public.ajustes_custo_compra a
       WHERE a.filial = p_filial
         AND a.destino = 'despesa'
         AND a.data BETWEEN p_inicio AND p_fim
      HAVING ROUND(SUM(a.valor_resultado), 2) <> 0

      UNION ALL

      SELECT 'Depreciação'::text AS grupo, ROUND(SUM(dep.valor_dia), 2) AS valor
        FROM (
          SELECT GREATEST(0,
                   LEAST(p_fim,
                         COALESCE(p.patrimonio_baixado_em, 'infinity'::date),
                         (p.created_at::date + (p.patrimonio_vida_util_meses || ' months')::interval - '1 day'::interval)::date)
                   - GREATEST(p_inicio, p.created_at::date) + 1
                 ) * (COALESCE(pc.preco_custo, 0))
                   / p.patrimonio_vida_util_meses / 30.0 AS valor_dia
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND COALESCE(p.ativo, true)
             AND p.filial = p_filial
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
             AND p.created_at::date <= p_fim
             AND (p.patrimonio_baixado_em IS NULL OR p.patrimonio_baixado_em >= p_inicio)
        ) dep
      HAVING ROUND(SUM(dep.valor_dia), 2) > 0

      UNION ALL

      SELECT 'Baixa de imobilizado'::text AS grupo, ROUND(SUM(bx.resultado), 2) AS valor
        FROM (
          SELECT (COALESCE(pc.preco_custo, 0))
                 * GREATEST(0, 1 - (p.patrimonio_baixado_em - p.created_at::date)::numeric
                                   / (p.patrimonio_vida_util_meses * 30.0))
                 - COALESCE(p.patrimonio_valor_venda, 0) AS resultado
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND COALESCE(p.ativo, true)
             AND p.filial = p_filial
             AND p.patrimonio_baixado_em BETWEEN p_inicio AND p_fim
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
        ) bx
      HAVING ROUND(SUM(bx.resultado), 2) <> 0
    ) t;

  v_resultado := ROUND(v_lucro_bruto - v_despesas, 2);

  RETURN jsonb_build_object(
    'filial',           p_filial,
    'inicio',           p_inicio,
    'fim',              p_fim,
    'receita_bruta',    v_receita_bruta,
    'descontos',        v_descontos,
    'devolucoes',       v_devolucoes,
    'impostos',         v_impostos,
    'impostos_meses',   v_impostos_meses,
    'receita_liquida',  v_receita_liquida,
    'cmv',              v_cmv,
    'cmv_devolvido',    v_cmv_devolvido,
    'cmv_ajuste_compras', v_cmv_ajuste,
    'lucro_bruto',      v_lucro_bruto,
    'margem_bruta_pct', CASE WHEN v_receita_liquida > 0
                             THEN ROUND(100 * v_lucro_bruto / v_receita_liquida, 1) END,
    'despesas',         v_despesas,
    'despesas_grupos',  v_grupos,
    'consumo_material', v_consumo,
    'consumos_sem_custo', v_consumo_sem,
    'resultado',        v_resultado,
    'margem_liquida_pct', CASE WHEN v_receita_liquida > 0
                               THEN ROUND(100 * v_resultado / v_receita_liquida, 1) END,
    'itens_vendidos',   v_itens,
    'itens_sem_custo',  v_sem_custo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._dre_calculo(text, date, date) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gerar_dre(p_filial text, p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();

  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Resultado de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial abrem o resultado da unidade.'
      USING ERRCODE = '42501';
  END IF;

  -- MIGR 656: o cálculo vive em _dre_calculo, que parametros_precificacao
  -- também lê (sem expor o relatório a quem só cadastra produto).
  RETURN public._dre_calculo(p_filial, p_inicio, p_fim);
END;
$function$;

-- 5. Parâmetros de formação de preço ----------------------------------------

CREATE OR REPLACE FUNCTION public.parametros_precificacao(p_filial text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje       date := public.acre_today();
  v_mes        date := date_trunc('month', public.acre_today())::date;
  -- Janela: os 3 últimos meses FECHADOS. O mês corrente distorce — a
  -- despesa do mês entra de uma vez (aluguel no dia 5) e a venda vem aos poucos.
  v_ini        date := (date_trunc('month', public.acre_today()) - interval '3 months')::date;
  v_fim        date := (date_trunc('month', public.acre_today()) - interval '1 day')::date;
  v_cfg        public.filial_precificacao%ROWTYPE;
  v_rbt12      numeric;
  v_rbt_origem text;
  v_rbt_meses  integer;
  v_faixa      integer;
  v_nominal    numeric;
  v_deduzir    numeric;
  v_efetiva    numeric;
  v_base       numeric;
  v_taxas_hist numeric := 0;
  v_desp_hist  numeric;
  v_desp_pct   numeric;
  v_desp_orig  text;
  v_taxa_pct   numeric;
  v_taxa_orig  text;
  v_gestor     boolean;
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Parâmetros de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Quem abre o DRE vê os valores em reais e edita; os demais veem só os
  -- percentuais, que é o que o cadastro de produto precisa.
  v_gestor := COALESCE(public.auth_in_setor('financeiro'), false)
           OR COALESCE(public.auth_gerente_da(p_filial), false);

  SELECT * INTO v_cfg FROM public.filial_precificacao WHERE filial = p_filial;

  SELECT r.rbt12, r.origem, r.meses INTO v_rbt12, v_rbt_origem, v_rbt_meses
    FROM public._simples_rbt12(p_filial, v_mes) r;
  SELECT a.faixa, a.aliquota_nominal, a.parcela_deduzir, a.aliquota_efetiva
    INTO v_faixa, v_nominal, v_deduzir, v_efetiva
    FROM public.simples_anexo_i(v_rbt12) a;

  v_base := public._receita_simples(p_filial, v_ini, v_fim);

  IF v_base > 0 THEN
    SELECT COALESCE(SUM(cp.valor), 0) INTO v_taxas_hist
      FROM public.contas_pagar cp
     WHERE cp.ativo = true
       AND cp.filial = p_filial
       AND cp.status <> 'Cancelado'
       AND cp.origem = 'conciliacao_maquininha'
       AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN v_ini AND v_fim;
    v_desp_hist := (public._dre_calculo(p_filial, v_ini, v_fim) ->> 'despesas')::numeric - v_taxas_hist;
  END IF;

  IF v_cfg.despesas_pct_manual IS NOT NULL THEN
    v_desp_pct := v_cfg.despesas_pct_manual; v_desp_orig := 'manual';
  ELSIF v_base > 0 THEN
    v_desp_pct := ROUND(100 * GREATEST(v_desp_hist, 0) / v_base, 2); v_desp_orig := 'historico';
  ELSE
    v_desp_orig := 'sem_historico';
  END IF;

  IF v_cfg.taxas_pct_manual IS NOT NULL THEN
    v_taxa_pct := v_cfg.taxas_pct_manual; v_taxa_orig := 'manual';
  ELSIF v_base > 0 THEN
    v_taxa_pct := ROUND(100 * v_taxas_hist / v_base, 2); v_taxa_orig := 'historico';
  ELSE
    v_taxa_orig := 'sem_historico';
  END IF;

  RETURN jsonb_build_object(
    'filial',           p_filial,
    'regime',           COALESCE(v_cfg.regime, 'simples_anexo_i'),
    'rbt12',            CASE WHEN v_gestor THEN v_rbt12 END,
    'rbt12_origem',     v_rbt_origem,
    'rbt12_meses',      v_rbt_meses,
    'faixa',            v_faixa,
    'aliquota_nominal', v_nominal,
    'parcela_deduzir',  v_deduzir,
    'aliquota_efetiva', v_efetiva,
    'acima_do_teto',    COALESCE(v_rbt12, 0) > 4800000,
    'despesas_pct',     v_desp_pct,
    'despesas_origem',  v_desp_orig,
    'taxas_pct',        v_taxa_pct,
    'taxas_origem',     v_taxa_orig,
    'janela_inicio',    v_ini,
    'janela_fim',       v_fim,
    'pode_editar',      v_gestor,
    'manual',           CASE WHEN v_gestor THEN jsonb_build_object(
                          'rbt12',        v_cfg.rbt12_manual,
                          'despesas_pct', v_cfg.despesas_pct_manual,
                          'taxas_pct',    v_cfg.taxas_pct_manual) END,
    'atualizado_em',    v_cfg.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.parametros_precificacao(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.parametros_precificacao(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.salvar_parametros_precificacao(
  p_filial text,
  p_rbt12_manual numeric,
  p_despesas_pct_manual numeric,
  p_taxas_pct_manual numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Parâmetros de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial ajustam a formação de preço.'
      USING ERRCODE = '42501';
  END IF;
  IF p_rbt12_manual < 0 THEN
    RAISE EXCEPTION 'Receita dos 12 meses não pode ser negativa.' USING ERRCODE = 'P0001';
  END IF;
  IF p_despesas_pct_manual < 0 OR p_despesas_pct_manual >= 100
     OR p_taxas_pct_manual < 0 OR p_taxas_pct_manual >= 100 THEN
    RAISE EXCEPTION 'Percentual fora de 0 a 99,99.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.filial_precificacao AS fp
    (filial, rbt12_manual, despesas_pct_manual, taxas_pct_manual, updated_at, updated_by)
  VALUES (p_filial, p_rbt12_manual, p_despesas_pct_manual, p_taxas_pct_manual, now(), auth.uid())
  ON CONFLICT (filial) DO UPDATE
    SET rbt12_manual        = EXCLUDED.rbt12_manual,
        despesas_pct_manual = EXCLUDED.despesas_pct_manual,
        taxas_pct_manual    = EXCLUDED.taxas_pct_manual,
        updated_at          = EXCLUDED.updated_at,
        updated_by          = EXCLUDED.updated_by;

  RETURN public.parametros_precificacao(p_filial);
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_parametros_precificacao(text, numeric, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salvar_parametros_precificacao(text, numeric, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
