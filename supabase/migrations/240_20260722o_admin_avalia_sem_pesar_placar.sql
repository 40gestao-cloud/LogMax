-- =================================================================
-- Admin nas avaliações da Matriz: não entra em nenhuma média.
--
-- Contexto:
--   Admin tem acesso operacional total (cria/remove tarefas, deleta
--   avaliações via UI) mas NÃO é membro do conselho. Se uma nota
--   dele existir no banco (teste, correção, migração antiga), ela
--   fica invisível pra todos os agregados.
--
-- Escopo:
--   * `calcular_placar_competicao`: filtra admin nos dois inputs
--     (tarefas via avaliacoes_matriz + eixos via criterios_avaliacao).
--   * `avaliacoes_matriz_agregado` / `avaliacoes_matriz_placar_filial`:
--     JOIN com user_profiles e WHERE role <> 'admin'.
--   * `painel_matriz_metricas`: notas CTE filtra admin + eixos
--     reduzidos aos 2 subjetivos ativos.
--
-- Não altera RLS/RPCs de escrita — bloqueio da criação de nota por
-- admin já é feito na UI (AvaliacaoFilialPanel esconde o form pra
-- admin) e a RPC avaliar_item_matriz continua rejeitando admin.
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

-- ── 1. Placar filtra admin ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp           competicoes_matriz;
  v_result         jsonb;
  v_incluir_eixos  boolean;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  -- Gate: fonte "eixos subjetivos" só entra se as 3 filiais têm ≥1
  -- avaliação matriz_filial (de não-admin) no período.
  SELECT (
    COUNT(DISTINCT a.avaliada_filial) FILTER (
      WHERE a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
    ) = 3
  ) INTO v_incluir_eixos
    FROM public.avaliacoes a
    JOIN public.user_profiles up ON up.id = a.avaliador_id
   WHERE a.tipo = 'matriz_filial'
     AND up.role <> 'admin'
     AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim;

  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial
  ),
  notas_tarefas AS (
    SELECT am.filial_avaliada AS filial, am.nota::numeric AS nota
      FROM public.avaliacoes_matriz am
      JOIN public.user_profiles up ON up.id = am.avaliador_id
     WHERE am.competicao_id = p_competicao_id
       AND am.ativo = true
       AND am.nota IS NOT NULL
       AND am.item_tipo LIKE 'tarefa\_%'
       AND up.role <> 'admin'
  ),
  notas_eixos AS (
    SELECT a.avaliada_filial AS filial, c.nota::numeric AS nota
      FROM public.criterios_avaliacao c
      JOIN public.avaliacoes a     ON a.id  = c.avaliacao_id
      JOIN public.user_profiles up ON up.id = a.avaliador_id
     WHERE v_incluir_eixos
       AND a.tipo = 'matriz_filial'
       AND a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim
       AND up.role <> 'admin'
       AND c.criterio IN ('Frequência de Trabalho', 'Planejamento e Organização')
  ),
  todas AS (
    SELECT filial, nota FROM notas_tarefas
    UNION ALL
    SELECT filial, nota FROM notas_eixos
  ),
  agregado AS (
    SELECT f.filial,
           COALESCE(ROUND(AVG(t.nota) * 10, 2), 0) AS media,
           COALESCE(COUNT(t.nota), 0)              AS n
      FROM filiais f
      LEFT JOIN todas t ON t.filial = f.filial
     GROUP BY f.filial
  )
  SELECT jsonb_object_agg(filial, jsonb_build_object('media', media, 'n', n))
    INTO v_result
    FROM agregado;

  RETURN jsonb_build_object(
    'competicao', jsonb_build_object(
      'id', v_comp.id, 'nome', v_comp.nome,
      'data_inicio', v_comp.data_inicio, 'data_fim', v_comp.data_fim,
      'status', v_comp.status, 'vencedora', v_comp.vencedora
    ),
    'inclui_eixos_conselho', COALESCE(v_incluir_eixos, false),
    'por_filial', COALESCE(v_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

-- ── 2. Views agregadas excluem admin ──────────────────────────────
--    (mesmas colunas do 210; só JOIN pra filtrar avaliador admin)
CREATE OR REPLACE VIEW public.avaliacoes_matriz_agregado AS
SELECT
  am.competicao_id,
  am.filial_avaliada,
  am.item_tipo,
  am.item_id,
  COUNT(*) FILTER (WHERE am.nota IS NOT NULL)::int            AS n_notas,
  ROUND(AVG(am.nota) FILTER (WHERE am.nota IS NOT NULL), 2)    AS media_nota,
  COUNT(*) FILTER (WHERE am.decisao = 'Aprovado')::int         AS n_aprovado,
  COUNT(*) FILTER (WHERE am.decisao = 'Reprovado')::int        AS n_reprovado,
  COUNT(*)::int                                                AS n_total_avaliadores,
  MAX(am.updated_at)                                           AS ultima_atualizacao
FROM public.avaliacoes_matriz am
JOIN public.user_profiles up ON up.id = am.avaliador_id
WHERE am.ativo = true
  AND up.role <> 'admin'
GROUP BY am.competicao_id, am.filial_avaliada, am.item_tipo, am.item_id;

GRANT SELECT ON public.avaliacoes_matriz_agregado TO authenticated;

CREATE OR REPLACE VIEW public.avaliacoes_matriz_placar_filial AS
SELECT
  am.competicao_id,
  am.filial_avaliada,
  ROUND(AVG(am.nota) FILTER (WHERE am.nota IS NOT NULL), 2) AS media_nota_geral,
  COUNT(*) FILTER (WHERE am.decisao = 'Aprovado')::int      AS itens_aprovados,
  COUNT(*) FILTER (WHERE am.decisao = 'Reprovado')::int     AS itens_reprovados,
  CASE
    WHEN COUNT(*) FILTER (WHERE am.decisao IS NOT NULL) = 0 THEN NULL
    ELSE ROUND(
      100.0 * COUNT(*) FILTER (WHERE am.decisao = 'Aprovado')
      / NULLIF(COUNT(*) FILTER (WHERE am.decisao IS NOT NULL), 0),
    2)
  END AS taxa_aprovacao_pct
FROM public.avaliacoes_matriz am
JOIN public.user_profiles up ON up.id = am.avaliador_id
WHERE am.ativo = true
  AND up.role <> 'admin'
GROUP BY am.competicao_id, am.filial_avaliada;

GRANT SELECT ON public.avaliacoes_matriz_placar_filial TO authenticated;

-- ── 3. Painel Comparativo dos Eixos: filtra admin + só 2 eixos ────
--   * `notas` CTE: JOIN com user_profiles pra tirar admin.
--   * `eixos`: só os 2 subjetivos ativos (Frequência de Trabalho,
--     Planejamento e Organização). A CTE original tinha 7 — os 5
--     retirados do form eram desperdício + confundiam labels.
CREATE OR REPLACE FUNCTION public.painel_matriz_metricas(p_ciclo_matriz_id uuid)
RETURNS TABLE (
  filial          text,
  eixo            text,
  nota_subjetiva  numeric,
  metrica_valor   numeric,
  metrica_label   text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_data_inicio date;
  v_data_fim    date;
  v_ts_inicio   timestamptz;
  v_ts_fim      timestamptz;
BEGIN
  SELECT c.data_inicio, c.data_fim INTO v_data_inicio, v_data_fim
    FROM ciclos_avaliacao c
   WHERE c.id = p_ciclo_matriz_id;

  IF v_data_inicio IS NULL THEN
    RAISE EXCEPTION 'Ciclo Matriz não encontrado';
  END IF;

  v_ts_inicio := v_data_inicio::timestamptz;
  v_ts_fim    := (v_data_fim + 1)::timestamptz;

  RETURN QUERY
  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS f
  ),
  eixos AS (
    SELECT unnest(ARRAY[
      'Frequência de Trabalho',
      'Planejamento e Organização'
    ]) AS e
  ),
  grade AS (
    SELECT f AS filial, e AS eixo FROM filiais CROSS JOIN eixos
  ),
  notas AS (
    -- Notas de admin ficam de fora (moderação, não julgamento).
    SELECT a.avaliada_filial AS filial,
           ca.criterio       AS eixo,
           AVG(ca.nota)::numeric(4,2) AS nota
      FROM avaliacoes a
      JOIN criterios_avaliacao ca ON ca.avaliacao_id = a.id
      JOIN user_profiles up       ON up.id = a.avaliador_id
     WHERE a.ciclo_id = p_ciclo_matriz_id
       AND a.tipo = 'matriz_filial'
       AND up.role <> 'admin'
     GROUP BY a.avaliada_filial, ca.criterio
  ),
  m_frequencia AS (
    SELECT pe.filial,
           CASE
             WHEN COUNT(*) FILTER (WHERE pe.status IN ('Falta','Normal','Atrasado') OR pe.status IS NULL) = 0 THEN NULL
             ELSE ROUND(
               100.0 * COUNT(*) FILTER (WHERE pe.status IS NULL OR pe.status NOT IN ('Falta','Justificado'))
                     / NULLIF(COUNT(*) FILTER (WHERE pe.status IS NULL OR pe.status <> 'Justificado'), 0),
               1
             )
           END AS valor
      FROM ponto_eletronico pe
     WHERE pe.filial IS NOT NULL
       AND pe.data BETWEEN v_data_inicio AND v_data_fim
     GROUP BY pe.filial
  )
  SELECT g.filial,
         g.eixo,
         n.nota AS nota_subjetiva,
         CASE g.eixo
           WHEN 'Frequência de Trabalho' THEN mf.valor
           ELSE NULL
         END AS metrica_valor,
         CASE g.eixo
           WHEN 'Frequência de Trabalho' THEN 'Aderência do ponto (%)'
           ELSE NULL
         END AS metrica_label
    FROM grade g
    LEFT JOIN notas       n  ON n.filial  = g.filial AND n.eixo = g.eixo
    LEFT JOIN m_frequencia mf ON mf.filial = g.filial
   ORDER BY g.filial, g.eixo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.painel_matriz_metricas(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
