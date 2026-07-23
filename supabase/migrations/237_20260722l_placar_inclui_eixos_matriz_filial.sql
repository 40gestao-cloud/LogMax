-- =================================================================
-- Placar de Competição — funde notas de Tarefas + 7 eixos da Avaliação
-- das Filiais numa média unificada.
--
-- Contexto:
--   Após a migração 227, o placar é a média × 10 das notas do conselho
--   em `tarefa_%` (avaliacoes_matriz). As notas que CEO/conselheiros dão
--   à filial nos 7 eixos (ciclo Padrão, tipo 'matriz_filial') ficavam
--   órfãs — só apareciam num card, sem influenciar o ranking.
--
-- Mudança:
--   • `calcular_placar_competicao` passa a agregar as duas fontes:
--     (a) notas de tarefas do avaliacoes_matriz — como já era.
--     (b) NOVO: notas de `criterios_avaliacao` das avaliações
--         `matriz_filial` cujo `created_at` caia entre `data_inicio` e
--         `data_fim` da competição.
--   • Cada nota individual pesa igual — sem dimensão, sem peso
--     configurável (fiel ao modelo simplificado do 227).
--
-- Gate (i):
--   A fonte (b) só entra se as 3 filiais têm ≥1 avaliação `matriz_filial`
--   no período. Se falta pra alguma → ignora a fonte inteira; placar
--   volta a ser só (a). Evita distorção quando o conselho não avaliou.
--
-- Saída ganha campo `inclui_eixos_conselho: boolean` pra UI sinalizar
-- que os 7 eixos entraram (ou não) no cálculo.
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

  -- Gate (i): fonte "7 eixos" só entra se TODAS as 3 filiais têm ≥1
  -- avaliação matriz_filial no período. Falta em qualquer → ignora fonte.
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
