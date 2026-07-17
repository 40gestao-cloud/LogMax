-- =================================================================
-- Fix: calcular_placar_competicao explode "field name must not be null"
-- quando não há vendas no período.
--
-- Causa:
--   A CTE `vendas` extrai rows de v_dados->'vendas'->'por_filial'. Se
--   o array está vazio (nenhuma venda no período), a CTE fica com 0
--   rows. O FULL JOIN com as outras dimensões (que já ancoravam em
--   `filiais`) gera linhas onde `x.filial IS NULL`, e
--   jsonb_object_agg(x.filial, x.v) rejeita chave NULL.
--
-- Fix:
--   Ancorar `vendas` na CTE `filiais` (LEFT JOIN LATERAL), garantindo
--   sempre 3 rows (uma por filial), com valor 0 quando não houver.
--   Mesmo padrão de financeiro/logistica/rh/marketing.
--
-- Idempotente (CREATE OR REPLACE mesma assinatura).
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
  vendas AS (
    -- Ancorado em `filiais` pra garantir 3 rows mesmo sem vendas no período
    SELECT f.filial,
      COALESCE(SUM((item->>'faturamento')::numeric), 0) AS valor
    FROM filiais f
    LEFT JOIN LATERAL jsonb_array_elements(COALESCE(v_dados->'vendas'->'por_filial', '[]'::jsonb)) AS item
      ON (item->>'filial')::text = f.filial
    GROUP BY f.filial
  ),
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
  logistica AS (
    SELECT f.filial,
      CASE WHEN COUNT(p.*) = 0 THEN 0
           ELSE 100 - ROUND(100.0 * SUM(CASE WHEN COALESCE(p.estoque,0) <= COALESCE(p.estoque_minimo,10) THEN 1 ELSE 0 END) / COUNT(*), 1)
      END AS valor
    FROM filiais f
    LEFT JOIN produtos p ON p.filial = f.filial AND COALESCE(p.ativo,true)
    GROUP BY f.filial
  ),
  rh AS (
    SELECT f.filial,
      CASE
        WHEN COUNT(fu.id) = 0 THEN 0
        WHEN COUNT(fr.*) = 0 THEN 0
        ELSE ROUND(100.0 * SUM(CASE WHEN fr.status IN ('Presente','Presente com Atraso') THEN 1 ELSE 0 END) / COUNT(fr.*), 1)
      END AS valor
    FROM filiais f
    LEFT JOIN funcionarios fu ON fu.filial = f.filial AND COALESCE(fu.status,'Ativo') = 'Ativo'
    LEFT JOIN frequencia_trabalho fr ON fr.funcionario_id = fu.id
                                     AND fr.data BETWEEN v_comp.data_inicio AND v_comp.data_fim
    GROUP BY f.filial
  ),
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
