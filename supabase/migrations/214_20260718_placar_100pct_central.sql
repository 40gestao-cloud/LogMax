-- =================================================================
-- Placar 100% derivado da Central de Avaliação.
--
-- Muda o modelo:
--   Antes → Placar mesclava BI + fórmulas operacionais + notas do
--   conselho por dimensão.
--   Agora → 6 dimensões, cada uma alimentada exclusivamente por tipos
--   avaliados pelo conselho na Central. Fim das fórmulas operacionais.
--
-- Dimensões (fonte única = avaliacoes_matriz):
--   Marketing  ← arte, promocao, campanha         (média nota × 10)
--   Vendas     ← pedido_venda                     (% aprovação)
--   Compras    ← requisicao, cotacao              (% aprovação)
--   RH         ← ferias, requerimento             (% aprovação)
--   Cadastros  ← 5 tipos (produto/cliente/etc)    (% aprovação)
--   Financeiro ← conta_pagar, conta_receber       (% aprovação)  [NOVO]
--
-- Filial sem julgamento em uma dim → 0 pts. Sem fallback.
--
-- Novidades:
--   • ALTER item_tipo_check + 2 tipos (conta_pagar, conta_receber)
--   • criar_competicao valida 6 chaves (marketing/vendas/compras/rh/
--     cadastros/financeiro), soma=100. Legado (logistica/etc) aceito
--     via COALESCE nas leituras — não quebra placar de andamento.
--   • calcular_placar_competicao reescrito: só lê avaliacoes_matriz.
--     Não chama gerar_painel_bi nem toca em contas_pagar/receber/
--     produtos/funcionarios/marketing_campanhas.
--   • atualizar_pesos_competicao(uuid, jsonb) — admin/CEO edita pesos
--     durante status='em_andamento'.
--
-- Snapshots históricos (placar_snapshot em competições encerradas)
-- ficam preservados — não recomputa.
-- =================================================================

BEGIN;

-- 1. Adicionar tipos financeiros ─────────────────────────────────────
ALTER TABLE public.avaliacoes_matriz
  DROP CONSTRAINT IF EXISTS avaliacoes_matriz_item_tipo_check;

ALTER TABLE public.avaliacoes_matriz
  ADD CONSTRAINT avaliacoes_matriz_item_tipo_check
  CHECK (item_tipo IN (
    'requisicao','cotacao','promocao','arte','campanha',
    'pedido_venda','ferias','requerimento',
    'cadastro_produto','cadastro_cliente','cadastro_fornecedor',
    'cadastro_servico','cadastro_categoria',
    'conta_pagar','conta_receber'
  ));

-- 2. criar_competicao: 6 chaves obrigatórias ─────────────────────────
CREATE OR REPLACE FUNCTION public.criar_competicao(
  p_nome        text,
  p_data_inicio date,
  p_data_fim    date,
  p_pesos       jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_soma numeric;
  v_id   uuid;
BEGIN
  IF NOT auth_is_admin() THEN
    RAISE EXCEPTION 'Apenas admin/CEO cria competição' USING ERRCODE = '42501';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'Data fim anterior ao início' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (p_pesos ? 'marketing' AND p_pesos ? 'vendas' AND p_pesos ? 'compras'
          AND p_pesos ? 'rh' AND p_pesos ? 'cadastros' AND p_pesos ? 'financeiro') THEN
    RAISE EXCEPTION 'Pesos exigem chaves: marketing, vendas, compras, rh, cadastros, financeiro'
      USING ERRCODE = 'P0001';
  END IF;

  v_soma := (p_pesos->>'marketing')::numeric + (p_pesos->>'vendas')::numeric
          + (p_pesos->>'compras')::numeric + (p_pesos->>'rh')::numeric
          + (p_pesos->>'cadastros')::numeric + (p_pesos->>'financeiro')::numeric;
  IF v_soma <> 100 THEN
    RAISE EXCEPTION 'Soma dos pesos deve ser 100 (recebido: %)', v_soma USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competicoes_matriz (nome, data_inicio, data_fim, pesos, criado_por)
  VALUES (p_nome, p_data_inicio, p_data_fim, p_pesos, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe competição em andamento — encerre a atual antes'
      USING ERRCODE = 'P0001';
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_competicao(text, date, date, jsonb) TO authenticated;

-- 3. Editar pesos durante em_andamento ───────────────────────────────
CREATE OR REPLACE FUNCTION public.atualizar_pesos_competicao(
  p_competicao_id uuid,
  p_pesos         jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_soma   numeric;
  v_status text;
BEGIN
  IF auth_user_role() NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO pode editar pesos' USING ERRCODE = '42501';
  END IF;

  IF NOT (p_pesos ? 'marketing' AND p_pesos ? 'vendas' AND p_pesos ? 'compras'
          AND p_pesos ? 'rh' AND p_pesos ? 'cadastros' AND p_pesos ? 'financeiro') THEN
    RAISE EXCEPTION 'Pesos exigem chaves: marketing, vendas, compras, rh, cadastros, financeiro'
      USING ERRCODE = 'P0001';
  END IF;

  v_soma := (p_pesos->>'marketing')::numeric + (p_pesos->>'vendas')::numeric
          + (p_pesos->>'compras')::numeric + (p_pesos->>'rh')::numeric
          + (p_pesos->>'cadastros')::numeric + (p_pesos->>'financeiro')::numeric;
  IF v_soma <> 100 THEN
    RAISE EXCEPTION 'Soma dos pesos deve ser 100 (recebido: %)', v_soma USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'em_andamento' THEN
    RAISE EXCEPTION 'Pesos só podem ser editados durante a competição (status atual: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE competicoes_matriz
     SET pesos = p_pesos, updated_at = now()
   WHERE id = p_competicao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_pesos_competicao(uuid, jsonb) TO authenticated;

-- 4. Placar 100% Central ────────────────────────────────────────────
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

  -- KPIs por dim × filial, calculados 100% a partir de avaliacoes_matriz.
  -- Marketing usa nota (0-10 × 10); demais usam taxa_aprovacao_pct.
  -- Filial sem avaliação na dim → valor 0.
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
                   AND item_tipo = 'pedido_venda'), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo = 'pedido_venda'), 0) AS n
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
                   AND item_tipo IN ('ferias','requerimento')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('ferias','requerimento')), 0) AS n
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

  -- Contagem de avaliações totais por dim (dim tem julgamento? qualquer filial julgada conta).
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

  -- Ranking 3-2-1 por dim × peso. Legados (pesos com chaves antigas)
  -- ficam com COALESCE=0 e não pontuam nas dims novas — admin deve
  -- editar via atualizar_pesos_competicao.
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
