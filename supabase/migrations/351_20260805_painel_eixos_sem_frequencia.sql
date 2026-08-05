-- =================================================================
-- 351 — Painel Comparativo dos Eixos para de mostrar Frequência de
--       Trabalho.
--
-- Desde a 349 a frequência não é mais nota do conselho, e desde a 350
-- ela tem cálculo próprio (presença 1, atraso 0,5, falta 0, justificado
-- fora do denominador) exposto pela `frequencia_filiais_competicao`,
-- que a Central mostra inteira logo acima deste painel.
--
-- A `painel_matriz_metricas` continuava devolvendo uma linha
-- 'Frequência de Trabalho' com uma "aderência do ponto" calculada de
-- OUTRO jeito — sem peso de atraso e sem a jornada da turma. Dois
-- números diferentes pra mesma coisa na mesma tela é convite pra
-- discussão sobre qual é o certo, e o certo é o do card.
--
-- Fica só o eixo que ainda é julgamento: Planejamento e Organização.
-- O painel volta a ser o que o nome diz — comparativo dos eixos
-- votados. Avaliações antigas seguem no banco; só não aparecem aqui.
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
BEGIN
  SELECT c.data_inicio, c.data_fim INTO v_data_inicio, v_data_fim
    FROM ciclos_avaliacao c
   WHERE c.id = p_ciclo_matriz_id;

  IF v_data_inicio IS NULL THEN
    RAISE EXCEPTION 'Ciclo Matriz não encontrado';
  END IF;

  RETURN QUERY
  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS f
  ),
  eixos AS (
    -- Só o que o conselho ainda vota. Frequência saiu (migr. 349/350).
    SELECT unnest(ARRAY['Planejamento e Organização']) AS e
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
  )
  SELECT g.filial,
         g.eixo,
         n.nota AS nota_subjetiva,
         NULL::numeric AS metrica_valor,
         NULL::text    AS metrica_label
    FROM grade g
    LEFT JOIN notas n ON n.filial = g.filial AND n.eixo = g.eixo
   ORDER BY
     -- Ordem canônica das unidades, não alfabética.
     CASE g.filial WHEN 'SuperMax' THEN 1 WHEN 'MaxLook' THEN 2 ELSE 3 END,
     g.eixo;
END;
$$;

REVOKE ALL ON FUNCTION public.painel_matriz_metricas(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.painel_matriz_metricas(uuid) TO authenticated;

-- Mesma ordem canônica na frequência: a 350 devolvia alfabético e o
-- MaxLook aparecia antes do SuperMax.
CREATE OR REPLACE FUNCTION public.frequencia_filiais_competicao(p_competicao_id uuid)
RETURNS TABLE (
  filial              text,
  registros           int,
  presencas           int,
  faltas              int,
  justificados        int,
  atrasos             int,
  dias_distintos      int,
  funcionarios_ativos int,
  taxa_presenca       numeric,
  jornada_entrada     text,
  jornada_tolerancia  int,
  atraso_conta        boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_filial_user text;
  v_inicio date;
  v_fim    date;
  v_j      ponto_jornada;
  v_target time;
BEGIN
  SELECT up.filial INTO v_filial_user FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT c.data_inicio, c.data_fim INTO v_inicio, v_fim
    FROM competicoes_matriz c WHERE c.id = p_competicao_id AND c.ativo = true;
  IF v_inicio IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;
  IF COALESCE(v_j.configurado, false) THEN
    v_target := (v_j.entrada || ':00')::time;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT * FROM (VALUES ('SuperMax',1),('MaxLook',2),('TechMax',3)) AS v(f, ord)
  ),
  pontos AS (
    SELECT pe.filial AS f, pe.data, pe.status, pe.entrada,
           public._freq_credito_dia(pe.status, pe.entrada, v_target, v_j.tolerancia_min) AS credito
      FROM ponto_eletronico pe
     WHERE pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_inicio AND v_fim
  ),
  func AS (
    SELECT fn.filial AS f, COUNT(*)::int AS n
      FROM funcionarios fn
     WHERE fn.filial IN ('SuperMax','MaxLook','TechMax')
       AND fn.ativo = true
     GROUP BY fn.filial
  ),
  agg AS (
    SELECT p.f,
           COUNT(*) FILTER (WHERE p.credito IS NOT NULL)::int AS registros,
           COUNT(*) FILTER (WHERE p.credito > 0)::int         AS presencas,
           COUNT(*) FILTER (WHERE p.status = 'Falta')::int    AS faltas,
           COUNT(*) FILTER (WHERE COALESCE(p.status,'Normal') = 'Justificado')::int AS justificados,
           COUNT(*) FILTER (WHERE p.credito = 0.5)::int       AS atrasos,
           COUNT(DISTINCT p.data)::int                        AS dias_distintos,
           SUM(p.credito)                                     AS creditos
      FROM pontos p
     GROUP BY p.f
  )
  SELECT b.f,
         COALESCE(a.registros, 0),
         COALESCE(a.presencas, 0),
         COALESCE(a.faltas, 0),
         COALESCE(a.justificados, 0),
         COALESCE(a.atrasos, 0),
         COALESCE(a.dias_distintos, 0),
         COALESCE(fu.n, 0),
         CASE WHEN COALESCE(a.registros, 0) = 0 THEN NULL
              ELSE ROUND(a.creditos / a.registros, 4) END,
         v_j.entrada,
         v_j.tolerancia_min,
         COALESCE(v_j.configurado, false)
    FROM base b
    LEFT JOIN agg  a  ON a.f  = b.f
    LEFT JOIN func fu ON fu.f = b.f
   WHERE v_filial_user = 'Matriz' OR b.f = v_filial_user
   ORDER BY b.ord;
END;
$$;

REVOKE ALL ON FUNCTION public.frequencia_filiais_competicao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.frequencia_filiais_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
