-- =================================================================
-- Painel Comparativo Matriz: métricas objetivas + notas subjetivas
-- =================================================================
-- Consolida por (filial × eixo) para o ciclo Matriz informado:
--   - nota_subjetiva  → média das notas do critério na tabela
--                       criterios_avaliacao ligada a avaliacoes.tipo='matriz_filial'
--   - metrica_valor   → dado objetivo do sistema (vendas, financeiro, RH)
--                       null quando o eixo não tem métrica automática
--
-- Idempotente.
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
    -- Contagem de avaliações internas concluídas (gerente_colaborador + feedback_colaborador)
    SELECT a.filial, COUNT(*)::numeric AS valor
      FROM avaliacoes a
      JOIN ciclos_avaliacao c ON c.id = a.ciclo_id
     WHERE a.tipo IN ('gerente_colaborador','feedback_colaborador','ceo_gerente')
       AND c.filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at >= v_ts_inicio AND a.created_at < v_ts_fim
     GROUP BY a.filial
  )
  SELECT g.filial,
         g.eixo,
         n.nota AS nota_subjetiva,
         CASE g.eixo
           WHEN 'Vendas e Atendimento' THEN COALESCE(mv.valor, 0)
           WHEN 'Financeiro'           THEN COALESCE(mr.valor, 0) - COALESCE(mp.valor, 0)
           WHEN 'Recursos Humanos'     THEN COALESCE(mrh.valor, 0)
           ELSE NULL
         END AS metrica_valor,
         CASE g.eixo
           WHEN 'Vendas e Atendimento' THEN 'R$ vendido no período'
           WHEN 'Financeiro'           THEN 'Recebido − Pendente (R$)'
           WHEN 'Recursos Humanos'     THEN 'Avaliações internas registradas'
           ELSE NULL
         END AS metrica_label
    FROM grade g
    LEFT JOIN notas       n  ON n.filial  = g.filial AND n.eixo = g.eixo
    LEFT JOIN m_vendas    mv ON mv.filial = g.filial
    LEFT JOIN m_receber   mr ON mr.filial = g.filial
    LEFT JOIN m_pagar_pend mp ON mp.filial = g.filial
    LEFT JOIN m_rh        mrh ON mrh.filial = g.filial
   ORDER BY g.filial, g.eixo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.painel_matriz_metricas(uuid) TO authenticated;

COMMIT;
