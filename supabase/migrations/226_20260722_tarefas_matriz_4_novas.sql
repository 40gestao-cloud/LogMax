-- =================================================================
-- Central de Avaliação — Competição do Conselho ganha 4 novos tipos
-- de tarefa da Matriz, agrupados na mesma dimensão "matriz" do placar:
--   Recursos Humanos     → tipo 'tarefa_rh'
--   Marketing            → tipo 'tarefa_marketing'
--   Financeiro           → tipo 'tarefa_financeiro'
--   Logística            → tipo 'tarefa_logistica'
--
-- Segue o padrão dos 3 pré-existentes (treinamento_vendas/ia/apresentacao):
-- nota 0-10 do conselho por participante, placar = média × 10 na dimensão
-- matriz. Pra evitar reescrever a função a cada tipo novo daqui pra frente,
-- a CTE `matriz` passa a filtrar por `item_tipo LIKE 'tarefa\_%'`.
-- =================================================================

BEGIN;

-- 1. avaliacoes_matriz.item_tipo — CHECK amplia enum ─────────────────
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
    'treinamento','frequencia_trabalho','avaliacao_desempenho',
    'orcamento','redes_sociais',
    'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
    'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica'
  ));

-- 2. chk_nota_apenas_criativos — libera nota 0-10 nos 4 novos ────────
ALTER TABLE public.avaliacoes_matriz
  DROP CONSTRAINT IF EXISTS chk_nota_apenas_criativos;

ALTER TABLE public.avaliacoes_matriz
  ADD CONSTRAINT chk_nota_apenas_criativos CHECK (
    nota IS NULL OR item_tipo IN (
      'arte','promocao','campanha','redes_sociais',
      'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
      'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica'
    )
  );

-- 3. matriz_tarefas.tipo — CHECK amplia enum ─────────────────────────
ALTER TABLE public.matriz_tarefas
  DROP CONSTRAINT IF EXISTS matriz_tarefas_tipo_check;

ALTER TABLE public.matriz_tarefas
  ADD CONSTRAINT matriz_tarefas_tipo_check CHECK (tipo IN (
    'tarefa_treinamento_vendas',
    'tarefa_treinamento_ia',
    'tarefa_apresentacao',
    'tarefa_rh',
    'tarefa_marketing',
    'tarefa_financeiro',
    'tarefa_logistica'
  ));

-- 4. RPC criar_matriz_tarefa — reproduzida com a lista atualizada ────
CREATE OR REPLACE FUNCTION public.criar_matriz_tarefa(
  p_competicao_id uuid,
  p_tipo          text,
  p_nome          text,
  p_descricao     text,
  p_data          date,
  p_participantes jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_role   text;
  v_filial text;
  v_cons   boolean;
  v_tarefa uuid;
  v_p      jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro INTO v_role, v_filial, v_cons
    FROM user_profiles WHERE id = v_user;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role IN ('admin','ceo','conselheiro') OR (v_role='gerente' AND v_cons))
  THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro da Matriz cria tarefa' USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN (
    'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
    'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica'
  ) THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competicoes_matriz
    WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO matriz_tarefas (competicao_id, tipo, nome, descricao, data, criado_por)
  VALUES (p_competicao_id, p_tipo, p_nome, NULLIF(p_descricao,''), p_data, v_user)
  RETURNING id INTO v_tarefa;

  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes,'[]'::jsonb))
  LOOP
    INSERT INTO matriz_tarefa_participantes (tarefa_id, funcionario_id, nome_snapshot, filial)
    VALUES (
      v_tarefa,
      NULLIF(v_p->>'funcionario_id','')::uuid,
      COALESCE(v_p->>'nome',''),
      v_p->>'filial'
    );
  END LOOP;

  RETURN v_tarefa;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_matriz_tarefa(uuid,text,text,text,date,jsonb) TO authenticated;

-- 5. Placar — CTE matriz passa a usar LIKE 'tarefa\_%' (future-proof) ─
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
                   AND item_tipo LIKE 'cadastro\_%'), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo LIKE 'cadastro\_%'), 0) AS n
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
    -- Todas as tarefas da Matriz (prefixo 'tarefa_') vão pra dimensão matriz.
    -- LIKE 'tarefa\_%' evita ter que reeditar esta função a cada tipo novo.
    SELECT f.filial,
      COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo LIKE 'tarefa\_%'), 0) AS valor,
      COALESCE((SELECT COUNT(*)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo LIKE 'tarefa\_%'), 0) AS n
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
  julgadas AS (
    SELECT
      ((SELECT SUM(n) FROM marketing)  > 0) AS marketing,
      ((SELECT SUM(n) FROM vendas)     > 0) AS vendas,
      ((SELECT SUM(n) FROM compras)    > 0) AS compras,
      ((SELECT SUM(n) FROM rh)         > 0) AS rh,
      ((SELECT SUM(n) FROM cadastros)  > 0) AS cadastros,
      ((SELECT SUM(n) FROM financeiro) > 0) AS financeiro,
      ((SELECT SUM(n) FROM matriz)     > 0) AS matriz
  ),
  origem AS (
    SELECT jsonb_build_object(
      'marketing',  CASE WHEN (SELECT marketing  FROM julgadas) THEN 'julgada' ELSE 'sem_julgamento' END,
      'vendas',     CASE WHEN (SELECT vendas     FROM julgadas) THEN 'julgada' ELSE 'sem_julgamento' END,
      'compras',    CASE WHEN (SELECT compras    FROM julgadas) THEN 'julgada' ELSE 'sem_julgamento' END,
      'rh',         CASE WHEN (SELECT rh         FROM julgadas) THEN 'julgada' ELSE 'sem_julgamento' END,
      'cadastros',  CASE WHEN (SELECT cadastros  FROM julgadas) THEN 'julgada' ELSE 'sem_julgamento' END,
      'financeiro', CASE WHEN (SELECT financeiro FROM julgadas) THEN 'julgada' ELSE 'sem_julgamento' END,
      'matriz',     CASE WHEN (SELECT matriz     FROM julgadas) THEN 'julgada' ELSE 'sem_julgamento' END
    ) AS v
  ),
  dims AS (
    SELECT d.dim, d.peso, d.julgada FROM (VALUES
      ('marketing',  COALESCE((v_comp.pesos->>'marketing')::numeric,  0), (SELECT marketing  FROM julgadas)),
      ('vendas',     COALESCE((v_comp.pesos->>'vendas')::numeric,     0), (SELECT vendas     FROM julgadas)),
      ('compras',    COALESCE((v_comp.pesos->>'compras')::numeric,    0), (SELECT compras    FROM julgadas)),
      ('rh',         COALESCE((v_comp.pesos->>'rh')::numeric,         0), (SELECT rh         FROM julgadas)),
      ('cadastros',  COALESCE((v_comp.pesos->>'cadastros')::numeric,  0), (SELECT cadastros  FROM julgadas)),
      ('financeiro', COALESCE((v_comp.pesos->>'financeiro')::numeric, 0), (SELECT financeiro FROM julgadas)),
      ('matriz',     COALESCE((v_comp.pesos->>'matriz')::numeric,     0), (SELECT matriz     FROM julgadas))
    ) d(dim, peso, julgada)
  ),
  raw AS (
    SELECT d.dim, d.peso, d.julgada, f.filial,
           COALESCE(((SELECT v FROM kpis)->d.dim->>f.filial)::numeric, 0) AS valor
    FROM dims d
    CROSS JOIN filiais f
  ),
  ranked AS (
    SELECT dim, peso, julgada, filial, valor,
           CASE
             WHEN NOT julgada THEN 0
             ELSE (4 - RANK() OVER (PARTITION BY dim ORDER BY valor DESC))::numeric
           END AS pontos_raw
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
