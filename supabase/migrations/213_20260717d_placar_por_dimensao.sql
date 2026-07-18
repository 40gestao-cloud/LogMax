-- =================================================================
-- Placar da Competição consome TODOS os 8 tipos avaliados pelo
-- conselho, cada um alimentando a dimensão apropriada:
--
--   Marketing  ← arte, promocao, campanha  (usa nota 0-10 × 10)
--   Financeiro ← requisicao, cotacao       (usa taxa_aprovacao_pct 0-100)
--   Vendas     ← pedido_venda              (usa taxa_aprovacao_pct 0-100)
--   RH         ← ferias, requerimento      (usa taxa_aprovacao_pct 0-100)
--   Logística  → sem tipo julgado — mantém fórmula operacional original
--
-- Regra: cada dimensão que tem QUALQUER avaliação do conselho passa a
-- usar o julgamento como valor; sem avaliações, mantém a fórmula
-- operacional antiga. Filial sem julgamento na dim → valor 0
-- (intencional: se conselho não julgou, filial não pontua ali).
--
-- Retorno do RPC ganha `dims_origem` (jsonb): mapa dim → 'conselho'|'atividade'.
-- Antigo `marketing_origem` mantido no jsonb pra compat, refletindo dims_origem.marketing.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp        competicoes_matriz;
  v_dados       jsonb;
  v_kpis        jsonb;
  v_scores      jsonb;
  v_dims_origem jsonb;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  v_dados := gerar_painel_bi(v_comp.data_inicio, v_comp.data_fim);

  -- Detecta origem por dimensão: 'conselho' se há avaliação relevante.
  SELECT jsonb_build_object(
    'marketing', CASE WHEN EXISTS (
      SELECT 1 FROM avaliacoes_matriz
       WHERE competicao_id = p_competicao_id AND ativo = true
         AND nota IS NOT NULL
         AND item_tipo IN ('arte','promocao','campanha')
    ) THEN 'conselho' ELSE 'atividade' END,
    'financeiro', CASE WHEN EXISTS (
      SELECT 1 FROM avaliacoes_matriz
       WHERE competicao_id = p_competicao_id AND ativo = true
         AND decisao IS NOT NULL
         AND item_tipo IN ('requisicao','cotacao')
    ) THEN 'conselho' ELSE 'atividade' END,
    'vendas', CASE WHEN EXISTS (
      SELECT 1 FROM avaliacoes_matriz
       WHERE competicao_id = p_competicao_id AND ativo = true
         AND decisao IS NOT NULL
         AND item_tipo = 'pedido_venda'
    ) THEN 'conselho' ELSE 'atividade' END,
    'rh', CASE WHEN EXISTS (
      SELECT 1 FROM avaliacoes_matriz
       WHERE competicao_id = p_competicao_id AND ativo = true
         AND decisao IS NOT NULL
         AND item_tipo IN ('ferias','requerimento')
    ) THEN 'conselho' ELSE 'atividade' END,
    'logistica', 'atividade'
  ) INTO v_dims_origem;

  WITH filiais AS (SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial),
  vendas AS (
    SELECT f.filial,
      CASE WHEN v_dims_origem->>'vendas' = 'conselho' THEN
        COALESCE((SELECT ROUND(
          100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
          / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
          FROM avaliacoes_matriz
         WHERE competicao_id = p_competicao_id AND ativo = true
           AND filial_avaliada = f.filial
           AND item_tipo = 'pedido_venda'), 0)
      ELSE
        COALESCE((SELECT (item->>'faturamento')::numeric
                    FROM jsonb_array_elements(COALESCE(v_dados->'vendas'->'por_filial','[]'::jsonb)) AS item
                   WHERE (item->>'filial')::text = f.filial LIMIT 1), 0)
      END AS valor
    FROM filiais f
  ),
  financeiro AS (
    SELECT f.filial,
      CASE WHEN v_dims_origem->>'financeiro' = 'conselho' THEN
        COALESCE((SELECT ROUND(
          100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
          / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
          FROM avaliacoes_matriz
         WHERE competicao_id = p_competicao_id AND ativo = true
           AND filial_avaliada = f.filial
           AND item_tipo IN ('requisicao','cotacao')), 0)
      ELSE
        COALESCE((SELECT SUM(valor) FROM contas_receber
                   WHERE filial = f.filial AND status='Pago' AND ativo IS NOT FALSE
                     AND vencimento BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
        -
        COALESCE((SELECT SUM(valor) FROM contas_pagar
                   WHERE filial = f.filial AND status='Pago' AND ativo IS NOT FALSE
                     AND vencimento BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      END AS valor
    FROM filiais f
  ),
  logistica AS (
    -- Sem tipo julgado — mantém fórmula operacional.
    SELECT f.filial,
      CASE WHEN COUNT(p.*) = 0 THEN 100
           ELSE 100 - ROUND(100.0 * SUM(CASE WHEN COALESCE(p.estoque,0) <= COALESCE(p.estoque_minimo,10) THEN 1 ELSE 0 END) / COUNT(*), 1)
      END AS valor
    FROM filiais f
    LEFT JOIN produtos p ON p.filial = f.filial AND COALESCE(p.ativo,true)
    GROUP BY f.filial
  ),
  rh AS (
    SELECT f.filial,
      CASE WHEN v_dims_origem->>'rh' = 'conselho' THEN
        COALESCE((SELECT ROUND(
          100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
          / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
          FROM avaliacoes_matriz
         WHERE competicao_id = p_competicao_id AND ativo = true
           AND filial_avaliada = f.filial
           AND item_tipo IN ('ferias','requerimento')), 0)
      ELSE
        COALESCE((SELECT COUNT(*) FROM funcionarios
                   WHERE filial = f.filial AND COALESCE(status,'Ativo') = 'Ativo'), 0)
      END AS valor
    FROM filiais f
  ),
  marketing AS (
    SELECT f.filial,
      CASE WHEN v_dims_origem->>'marketing' = 'conselho' THEN
        COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                   FROM avaliacoes_matriz
                  WHERE competicao_id = p_competicao_id AND ativo = true
                    AND filial_avaliada = f.filial
                    AND nota IS NOT NULL
                    AND item_tipo IN ('arte','promocao','campanha')), 0)
      ELSE
        COALESCE((SELECT COUNT(*) FROM marketing_campanhas
                   WHERE filial = f.filial AND COALESCE(ativo,true) AND status='Ativa'), 0)
        +
        COALESCE((SELECT COUNT(*) FROM marketing_artes
                   WHERE filial = f.filial AND created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      END AS valor
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
    'dims_origem',      v_dims_origem,
    'marketing_origem', v_dims_origem->>'marketing',
    'placar',           v_scores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
