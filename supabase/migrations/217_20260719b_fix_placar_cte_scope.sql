-- =================================================================
-- Fix calcular_placar_competicao: CTEs `marketing`, `vendas`, etc.
-- só existem dentro do SELECT que as declara. A versão anterior tinha
-- 3 SELECTs separados que reusavam os nomes, e o segundo/terceiro
-- SELECT quebram com "relation X does not exist".
--
-- Solução: consolidar todo o cálculo em UMA única query WITH que
-- devolve kpis, origem e scores no mesmo row, e SELECT ... INTO
-- distribui para as 3 vars.
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
  v_kpis   jsonb;
  v_scores jsonb;
  v_origem jsonb;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial
  ),
  marketing AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('arte','promocao','campanha','redes_sociais')), 0) AS valor,
      COALESCE((SELECT COUNT(*)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('arte','promocao','campanha','redes_sociais')), 0) AS n
    FROM filiais f
  ),
  vendas AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND item_tipo = 'orcamento'), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND item_tipo = 'orcamento'), 0) AS n
    FROM filiais f
  ),
  compras AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('requisicao','cotacao')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('requisicao','cotacao')), 0) AS n
    FROM filiais f
  ),
  rh AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('frequencia_trabalho','avaliacao_desempenho')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('frequencia_trabalho','avaliacao_desempenho')), 0) AS n
    FROM filiais f
  ),
  cadastros AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo LIKE 'cadastro_%'), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo LIKE 'cadastro_%'), 0) AS n
    FROM filiais f
  ),
  financeiro AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('conta_pagar','conta_receber')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('conta_pagar','conta_receber')), 0) AS n
    FROM filiais f
  ),
  matriz AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao')), 0) AS valor,
      COALESCE((SELECT COUNT(*)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao')), 0) AS n
    FROM filiais f
  ),
  kpis AS (
    SELECT jsonb_build_object(
      'marketing',  (SELECT jsonb_object_agg(filial, valor) FROM marketing),
      'vendas',     (SELECT jsonb_object_agg(filial, valor) FROM vendas),
      'compras',    (SELECT jsonb_object_agg(filial, valor) FROM compras),
      'rh',         (SELECT jsonb_object_agg(filial, valor) FROM rh),
      'cadastros',  (SELECT jsonb_object_agg(filial, valor) FROM cadastros),
      'financeiro', (SELECT jsonb_object_agg(filial, valor) FROM financeiro),
      'matriz',     (SELECT jsonb_object_agg(filial, valor) FROM matriz)
    ) AS v
  ),
  origem AS (
    SELECT jsonb_build_object(
      'marketing',  CASE WHEN (SELECT SUM(n) FROM marketing)  > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
      'vendas',     CASE WHEN (SELECT SUM(n) FROM vendas)     > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
      'compras',    CASE WHEN (SELECT SUM(n) FROM compras)    > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
      'rh',         CASE WHEN (SELECT SUM(n) FROM rh)         > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
      'cadastros',  CASE WHEN (SELECT SUM(n) FROM cadastros)  > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
      'financeiro', CASE WHEN (SELECT SUM(n) FROM financeiro) > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
      'matriz',     CASE WHEN (SELECT SUM(n) FROM matriz)     > 0 THEN 'julgada' ELSE 'sem_julgamento' END
    ) AS v
  ),
  dims AS (
    SELECT d.dim, d.peso FROM (VALUES
      ('marketing',  COALESCE((v_comp.pesos->>'marketing')::numeric,  0)),
      ('vendas',     COALESCE((v_comp.pesos->>'vendas')::numeric,     0)),
      ('compras',    COALESCE((v_comp.pesos->>'compras')::numeric,    0)),
      ('rh',         COALESCE((v_comp.pesos->>'rh')::numeric,         0)),
      ('cadastros',  COALESCE((v_comp.pesos->>'cadastros')::numeric,  0)),
      ('financeiro', COALESCE((v_comp.pesos->>'financeiro')::numeric, 0)),
      ('matriz',     COALESCE((v_comp.pesos->>'matriz')::numeric,     0))
    ) d(dim, peso)
  ),
  raw AS (
    SELECT d.dim, d.peso, f.filial,
           COALESCE(((SELECT v FROM kpis)->d.dim->>f.filial)::numeric, 0) AS valor
    FROM dims d
    CROSS JOIN filiais f
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
  ),
  scores AS (
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
    ) AS v
  )
  SELECT kpis.v, origem.v, scores.v
    INTO v_kpis, v_origem, v_scores
    FROM kpis, origem, scores;

  RETURN jsonb_build_object(
    'competicao', jsonb_build_object(
      'id', v_comp.id, 'nome', v_comp.nome,
      'data_inicio', v_comp.data_inicio, 'data_fim', v_comp.data_fim,
      'status', v_comp.status, 'pesos', v_comp.pesos, 'vencedora', v_comp.vencedora
    ),
    'dims_origem', v_origem,
    'placar',      v_scores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
