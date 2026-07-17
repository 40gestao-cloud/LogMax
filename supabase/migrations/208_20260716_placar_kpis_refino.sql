-- =================================================================
-- Refino dos KPIs do placar da competição.
--
-- Contexto:
--   A versão MVP (migração 206) usava métricas fracas em RH e Marketing:
--     - RH: nº de funcionários ativos (estático, não reflete desempenho)
--     - Marketing: campanhas ativas + artes count (só quantidade, não retorno)
--
-- Refino:
--   - RH: taxa de presença no período (frequencia_trabalho). Considera
--     Presente + Presente com Atraso vs Falta. Maior = melhor.
--   - Marketing: receita gerada por campanhas da filial no período
--     (soma de receita em v_campanha_roi das campanhas cujo período
--     sobrepõe o da competição). Reflete retorno real, não vaidade.
--   - Vendas, Financeiro, Logística: mantidos.
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp   competicoes_matriz;
  v_dados  jsonb;
  v_kpis   jsonb;
  v_scores jsonb;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  v_dados := gerar_painel_bi(v_comp.data_inicio, v_comp.data_fim);

  WITH filiais AS (SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial),
  -- Vendas: faturamento por filial no período (via gerar_painel_bi).
  vendas AS (
    SELECT
      (item->>'filial')::text AS filial,
      COALESCE((item->>'faturamento')::numeric, 0) AS valor
      FROM jsonb_array_elements(COALESCE(v_dados->'vendas'->'por_filial', '[]'::jsonb)) AS item
  ),
  -- Financeiro: receitas pagas - despesas pagas no período, por filial.
  financeiro AS (
    SELECT f.filial,
      COALESCE((SELECT SUM(valor) FROM contas_receber
                 WHERE filial = f.filial AND status='Pago' AND ativo IS NOT FALSE
                   AND vencimento BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      -
      COALESCE((SELECT SUM(valor) FROM contas_pagar
                 WHERE filial = f.filial AND status='Pago' AND ativo IS NOT FALSE
                   AND vencimento BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      AS valor
    FROM filiais f
  ),
  -- Logística: 100 - taxa % de produtos em estoque crítico (higher = melhor).
  -- Estoque é estado atual, não série temporal — período aqui é ignorado
  -- de propósito (não faz sentido "estoque médio no período" pra este KPI).
  logistica AS (
    SELECT f.filial,
      CASE WHEN COUNT(p.*) = 0 THEN 100
           ELSE 100 - ROUND(100.0 * SUM(CASE WHEN COALESCE(p.estoque,0) <= COALESCE(p.estoque_minimo,10) THEN 1 ELSE 0 END) / COUNT(*), 1)
      END AS valor
    FROM filiais f
    LEFT JOIN produtos p ON p.filial = f.filial AND COALESCE(p.ativo,true)
    GROUP BY f.filial
  ),
  -- RH: taxa de presença no período (higher = melhor).
  -- Considera Presente + Presente com Atraso vs Falta.
  -- frequencia_trabalho não tem filial; join via funcionarios.
  rh AS (
    SELECT f.filial,
      CASE WHEN COUNT(fr.*) = 0 THEN 100
           ELSE ROUND(100.0 * SUM(CASE WHEN fr.status IN ('Presente','Presente com Atraso') THEN 1 ELSE 0 END) / COUNT(*), 1)
      END AS valor
    FROM filiais f
    LEFT JOIN funcionarios fu ON fu.filial = f.filial AND COALESCE(fu.status,'Ativo') = 'Ativo'
    LEFT JOIN frequencia_trabalho fr ON fr.funcionario_id = fu.id
                                     AND fr.data BETWEEN v_comp.data_inicio AND v_comp.data_fim
    GROUP BY f.filial
  ),
  -- Marketing: receita gerada por campanhas da filial cujo período
  -- sobrepõe o da competição (higher = melhor). Só campanhas com filial
  -- definida entram — campanhas globais (filial NULL) ignoradas pra não
  -- distorcer o comparativo.
  marketing AS (
    SELECT f.filial,
      COALESCE((
        SELECT SUM(receita) FROM v_campanha_roi
         WHERE filial = f.filial
           AND data_inicio <= v_comp.data_fim
           AND data_fim   >= v_comp.data_inicio
      ), 0) AS valor
    FROM filiais f
  )
  SELECT jsonb_build_object(
    'vendas',     jsonb_object_agg(x.filial, x.v),
    'financeiro', jsonb_object_agg(y.filial, y.v),
    'logistica',  jsonb_object_agg(l.filial, l.v),
    'rh',         jsonb_object_agg(r.filial, r.v),
    'marketing',  jsonb_object_agg(m.filial, m.v)
  ) INTO v_kpis
  FROM (SELECT filial, valor AS v FROM vendas) x
  FULL JOIN (SELECT filial, valor AS v FROM financeiro) y USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM logistica)  l USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM rh)         r USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM marketing)  m USING (filial);

  -- Ranking 3-2-1 por dimensão + pontuação ponderada. Empate divide igual.
  WITH dims AS (
    SELECT d.dim, d.peso FROM (VALUES
      ('vendas',     (v_comp.pesos->>'vendas')::numeric),
      ('financeiro', (v_comp.pesos->>'financeiro')::numeric),
      ('logistica',  (v_comp.pesos->>'logistica')::numeric),
      ('rh',         (v_comp.pesos->>'rh')::numeric),
      ('marketing',  (v_comp.pesos->>'marketing')::numeric)
    ) d(dim, peso)
  ),
  raw AS (
    SELECT d.dim, d.peso, f AS filial,
           COALESCE((v_kpis->d.dim->>f)::numeric, 0) AS valor
    FROM dims d
    CROSS JOIN unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS f
  ),
  ranked AS (
    SELECT dim, peso, filial, valor,
           (4 - RANK() OVER (PARTITION BY dim ORDER BY valor DESC))::numeric AS pontos_raw
    FROM raw
  ),
  scored AS (
    SELECT dim, peso, filial, valor,
           AVG(pontos_raw) OVER (PARTITION BY dim, valor) AS pontos_dim,
           (peso/100.0) * AVG(pontos_raw) OVER (PARTITION BY dim, valor) AS pontos_ponderados
    FROM ranked
  )
  SELECT jsonb_build_object(
    'por_dimensao', (
      SELECT jsonb_object_agg(dim, dim_data)
      FROM (
        SELECT dim,
               jsonb_build_object(
                 'peso', MAX(peso),
                 'filiais', jsonb_object_agg(filial, jsonb_build_object(
                   'valor', valor, 'pontos', pontos_dim, 'ponderado', pontos_ponderados
                 ))
               ) AS dim_data
        FROM scored GROUP BY dim
      ) s
    ),
    'total_por_filial', (
      SELECT jsonb_object_agg(filial, total)
      FROM (
        SELECT filial, ROUND(SUM(pontos_ponderados)::numeric, 2) AS total
        FROM scored GROUP BY filial
      ) t
    )
  ) INTO v_scores
  FROM scored LIMIT 1;

  RETURN jsonb_build_object(
    'competicao', jsonb_build_object(
      'id', v_comp.id, 'nome', v_comp.nome,
      'data_inicio', v_comp.data_inicio, 'data_fim', v_comp.data_fim,
      'status', v_comp.status, 'pesos', v_comp.pesos, 'vencedora', v_comp.vencedora
    ),
    'kpis', v_kpis,
    'placar', v_scores
  );
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
