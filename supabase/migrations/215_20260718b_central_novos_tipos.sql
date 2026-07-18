-- =================================================================
-- Ajusta a Central de Avaliação:
--
-- Adiciona tipos:
--   • treinamento          (Vendas)
--   • frequencia_trabalho  (RH)
--   • avaliacao_desempenho (RH)
--
-- Mantém ferias/requerimento no CHECK como LEGADO — some da UI, mas
-- históricos permanecem íntegros. calcular_placar_competicao deixa de
-- somar esses 2 tipos.
--
-- Cria view auxiliar `frequencia_trabalho_com_filial` — join com
-- funcionarios pra derivar filial (frequencia_trabalho não tem a coluna
-- diretamente). Usada pela Central pra listar itens.
--
-- Reescreve calcular_placar_competicao:
--   Vendas ← pedido_venda + treinamento
--   RH     ← frequencia_trabalho + avaliacao_desempenho
--   demais dims idênticas.
-- =================================================================

BEGIN;

-- 1. Constraint item_tipo expandida ─────────────────────────────────
ALTER TABLE public.avaliacoes_matriz
  DROP CONSTRAINT IF EXISTS avaliacoes_matriz_item_tipo_check;

ALTER TABLE public.avaliacoes_matriz
  ADD CONSTRAINT avaliacoes_matriz_item_tipo_check
  CHECK (item_tipo IN (
    'requisicao','cotacao','promocao','arte','campanha',
    'pedido_venda','ferias','requerimento',
    'cadastro_produto','cadastro_cliente','cadastro_fornecedor',
    'cadastro_servico','cadastro_categoria',
    'conta_pagar','conta_receber',
    'treinamento','frequencia_trabalho','avaliacao_desempenho'
  ));

-- 2. View: frequencia_trabalho com filial via join ─────────────────
CREATE OR REPLACE VIEW public.frequencia_trabalho_com_filial AS
SELECT ft.id, ft.funcionario_id, ft.nome_funcionario, ft.data, ft.status,
       ft.justificativa, ft.created_at, ft.ativo,
       f.filial
  FROM public.frequencia_trabalho ft
  LEFT JOIN public.funcionarios f ON f.id = ft.funcionario_id;

GRANT SELECT ON public.frequencia_trabalho_com_filial TO authenticated;

-- 3. Placar: RH e Vendas remapeados ─────────────────────────────────
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

  WITH filiais AS (SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial),
  marketing AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND nota IS NOT NULL
                   AND item_tipo IN ('arte','promocao','campanha')), 0) AS valor,
      COALESCE((SELECT COUNT(*)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND nota IS NOT NULL
                   AND item_tipo IN ('arte','promocao','campanha')), 0) AS n
    FROM filiais f
  ),
  vendas AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('pedido_venda','treinamento')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('pedido_venda','treinamento')), 0) AS n
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
    -- Antes: ferias + requerimento (legado, ainda no CHECK mas fora do placar)
    -- Agora: frequencia_trabalho + avaliacao_desempenho
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
  )
  SELECT jsonb_build_object(
    'marketing',  jsonb_object_agg(m.filial, m.v),
    'vendas',     jsonb_object_agg(v.filial, v.v),
    'compras',    jsonb_object_agg(c.filial, c.v),
    'rh',         jsonb_object_agg(r.filial, r.v),
    'cadastros',  jsonb_object_agg(cd.filial, cd.v),
    'financeiro', jsonb_object_agg(fi.filial, fi.v)
  ) INTO v_kpis
  FROM (SELECT filial, valor AS v FROM marketing) m
  FULL JOIN (SELECT filial, valor AS v FROM vendas)      v  USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM compras)     c  USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM rh)          r  USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM cadastros)   cd USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM financeiro)  fi USING (filial);

  SELECT jsonb_build_object(
    'marketing',  CASE WHEN (SELECT SUM(n) FROM marketing)  > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'vendas',     CASE WHEN (SELECT SUM(n) FROM vendas)     > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'compras',    CASE WHEN (SELECT SUM(n) FROM compras)    > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'rh',         CASE WHEN (SELECT SUM(n) FROM rh)         > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'cadastros',  CASE WHEN (SELECT SUM(n) FROM cadastros)  > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'financeiro', CASE WHEN (SELECT SUM(n) FROM financeiro) > 0 THEN 'julgada' ELSE 'sem_julgamento' END
  ) INTO v_origem
  FROM (SELECT 1) x
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM marketing)  mkt ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM vendas)     ven ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM compras)    com ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM rh)         rrh ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM cadastros)  cad ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM financeiro) fin ON true;

  WITH dims AS (
    SELECT d.dim, d.peso FROM (VALUES
      ('marketing',  COALESCE((v_comp.pesos->>'marketing')::numeric,  0)),
      ('vendas',     COALESCE((v_comp.pesos->>'vendas')::numeric,     0)),
      ('compras',    COALESCE((v_comp.pesos->>'compras')::numeric,    0)),
      ('rh',         COALESCE((v_comp.pesos->>'rh')::numeric,         0)),
      ('cadastros',  COALESCE((v_comp.pesos->>'cadastros')::numeric,  0)),
      ('financeiro', COALESCE((v_comp.pesos->>'financeiro')::numeric, 0))
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
    'dims_origem', v_origem,
    'placar',      v_scores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
