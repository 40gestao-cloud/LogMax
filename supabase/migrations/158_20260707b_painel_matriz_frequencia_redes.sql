-- =================================================================
-- Painel Matriz: amarra Frequência e Redes Sociais a dados reais
-- =================================================================
-- Substitui painel_matriz_metricas para incluir métrica objetiva em:
--   - Frequência de Trabalho → aderência (%) no ponto eletrônico
--     (presenças / (presenças + faltas)) do período por filial
--   - Redes Sociais e Marketing → total de interações
--     (curtidas + visualizacoes + compartilhamentos + comentarios) por filial
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

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
      'Financeiro',
      'Planejamento e Organização',
      'Recursos Humanos',
      'Redes Sociais e Marketing',
      'Logística',
      'Vendas e Atendimento'
    ]) AS e
  ),
  grade AS (
    SELECT f AS filial, e AS eixo FROM filiais CROSS JOIN eixos
  ),
  notas AS (
    SELECT a.avaliada_filial AS filial,
           ca.criterio       AS eixo,
           AVG(ca.nota)::numeric(4,2) AS nota
      FROM avaliacoes a
      JOIN criterios_avaliacao ca ON ca.avaliacao_id = a.id
     WHERE a.ciclo_id = p_ciclo_matriz_id
       AND a.tipo = 'matriz_filial'
     GROUP BY a.avaliada_filial, ca.criterio
  ),
  m_vendas AS (
    SELECT v.filial, SUM(v.total_final)::numeric AS valor
      FROM vendas v
     WHERE v.filial IS NOT NULL
       AND v.status = 'Concluída'
       AND v.created_at >= v_ts_inicio AND v.created_at < v_ts_fim
     GROUP BY v.filial
  ),
  m_receber AS (
    SELECT cr.filial, SUM(cr.valor)::numeric AS valor
      FROM contas_receber cr
     WHERE cr.status = 'Pago'
       AND cr.created_at >= v_ts_inicio AND cr.created_at < v_ts_fim
     GROUP BY cr.filial
  ),
  m_pagar_pend AS (
    SELECT cp.filial, SUM(cp.valor)::numeric AS valor
      FROM contas_pagar cp
     WHERE cp.status IN ('Pendente','Atrasado')
       AND cp.created_at >= v_ts_inicio AND cp.created_at < v_ts_fim
     GROUP BY cp.filial
  ),
  m_rh AS (
    SELECT a.filial, COUNT(*)::numeric AS valor
      FROM avaliacoes a
      JOIN ciclos_avaliacao c ON c.id = a.ciclo_id
     WHERE a.tipo IN ('gerente_colaborador','feedback_colaborador','ceo_gerente')
       AND c.filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at >= v_ts_inicio AND a.created_at < v_ts_fim
     GROUP BY a.filial
  ),
  m_frequencia AS (
    -- Aderência (%): presenças / (presenças + faltas). Justificado não conta.
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
  ),
  m_redes AS (
    -- Interações totais no período (curtidas + views + shares + comentários)
    SELECT mrs.filial,
           SUM(COALESCE(mrs.curtidas,0) + COALESCE(mrs.visualizacoes,0)
             + COALESCE(mrs.compartilhamentos,0) + COALESCE(mrs.comentarios,0))::numeric AS valor
      FROM metricas_redes_sociais mrs
     WHERE mrs.ativo = true
       AND mrs.data_registro BETWEEN v_data_inicio AND v_data_fim
     GROUP BY mrs.filial
  )
  SELECT g.filial,
         g.eixo,
         n.nota AS nota_subjetiva,
         CASE g.eixo
           WHEN 'Vendas e Atendimento'      THEN COALESCE(mv.valor, 0)
           WHEN 'Financeiro'                THEN COALESCE(mr.valor, 0) - COALESCE(mp.valor, 0)
           WHEN 'Recursos Humanos'          THEN COALESCE(mrh.valor, 0)
           WHEN 'Frequência de Trabalho'    THEN mf.valor
           WHEN 'Redes Sociais e Marketing' THEN COALESCE(mrd.valor, 0)
           ELSE NULL
         END AS metrica_valor,
         CASE g.eixo
           WHEN 'Vendas e Atendimento'      THEN 'R$ vendido no período'
           WHEN 'Financeiro'                THEN 'Recebido − Pendente (R$)'
           WHEN 'Recursos Humanos'          THEN 'Avaliações internas registradas'
           WHEN 'Frequência de Trabalho'    THEN 'Aderência do ponto (%)'
           WHEN 'Redes Sociais e Marketing' THEN 'Interações totais'
           ELSE NULL
         END AS metrica_label
    FROM grade g
    LEFT JOIN notas       n   ON n.filial   = g.filial AND n.eixo = g.eixo
    LEFT JOIN m_vendas    mv  ON mv.filial  = g.filial
    LEFT JOIN m_receber   mr  ON mr.filial  = g.filial
    LEFT JOIN m_pagar_pend mp ON mp.filial  = g.filial
    LEFT JOIN m_rh        mrh ON mrh.filial = g.filial
    LEFT JOIN m_frequencia mf ON mf.filial  = g.filial
    LEFT JOIN m_redes     mrd ON mrd.filial = g.filial
   ORDER BY g.filial, g.eixo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.painel_matriz_metricas(uuid) TO authenticated;

COMMIT;
