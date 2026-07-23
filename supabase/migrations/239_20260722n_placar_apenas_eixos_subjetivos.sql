-- =================================================================
-- Placar de Competição — considera só os eixos subjetivos ativos.
--
-- Contexto:
--   A migração 237 fundia todas as notas de `criterios_avaliacao`
--   ligadas a `matriz_filial` no placar. Isso incluía os 7 eixos
--   originais. Removemos 5 do form (Financeiro, RH, Redes Sociais e
--   Marketing, Logística, Vendas e Atendimento) por serem redundantes
--   com Tarefas da Matriz + painel BI. Só que avaliações antigas ainda
--   têm essas notas gravadas em `criterios_avaliacao`, então o placar
--   continuaria puxando-as.
--
-- Mudança:
--   `notas_eixos` filtra `c.criterio IN (...)` — só os 2 eixos que
--   sobraram (`Frequência de Trabalho`, `Planejamento e Organização`)
--   entram na média. Se um dia a lista subjetiva mudar, ajustar aqui.
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
  v_comp           competicoes_matriz;
  v_result         jsonb;
  v_incluir_eixos  boolean;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  -- Gate: fonte "eixos subjetivos" só entra se as 3 filiais têm ≥1
  -- avaliação matriz_filial no período.
  SELECT (
    COUNT(DISTINCT a.avaliada_filial) FILTER (
      WHERE a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
    ) = 3
  ) INTO v_incluir_eixos
    FROM public.avaliacoes a
   WHERE a.tipo = 'matriz_filial'
     AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim;

  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial
  ),
  notas_tarefas AS (
    SELECT filial_avaliada AS filial, nota::numeric AS nota
      FROM public.avaliacoes_matriz
     WHERE competicao_id = p_competicao_id
       AND ativo = true
       AND nota IS NOT NULL
       AND item_tipo LIKE 'tarefa\_%'
  ),
  notas_eixos AS (
    SELECT a.avaliada_filial AS filial, c.nota::numeric AS nota
      FROM public.criterios_avaliacao c
      JOIN public.avaliacoes a ON a.id = c.avaliacao_id
     WHERE v_incluir_eixos
       AND a.tipo = 'matriz_filial'
       AND a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim
       -- Só os eixos subjetivos que restaram após a poda. Notas antigas
       -- dos 5 eixos removidos continuam no banco mas ficam de fora da média.
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

COMMIT;

NOTIFY pgrst, 'reload schema';
