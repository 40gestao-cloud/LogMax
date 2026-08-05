-- =================================================================
-- 349 — "Frequência de Trabalho" deixa de ser voto e vira medida.
--       (Etapa 1 de 2 — ver limitação do atraso no fim do cabeçalho.)
--
-- O eixo era nota 0-10 dada no olho por cada conselheiro, sendo que
-- `ponto_eletronico` já registra presença/falta por funcionário e por
-- dia, e a competição já delimita o período. O aluno era julgado por
-- uma régua que ele não podia conferir.
--
-- O que muda:
--   • `calcular_placar_competicao` para de somar o eixo subjetivo
--     'Frequência de Trabalho' (sobra 'Planejamento e Organização',
--     que é julgamento de verdade) e passa a compor a nota final com
--     uma parcela objetiva de frequência, peso 20%.
--   • RPC nova `frequencia_filiais_competicao` devolve os números
--     crus por filial — presenças, faltas, justificados, atrasos e a
--     taxa — pra tela mostrar a régua inteira em vez de só a nota.
--
-- Regras do cálculo:
--   • Falta = 0, Presente = 1.
--   • JUSTIFICADO FICA FORA DO DENOMINADOR. É afastamento deferido
--     pelo RH — punir aqui seria punir alguém por ter tido atestado
--     aceito.
--   • Denominador é o que TEM registro, nunca "dias do período": dia
--     sem lançamento não é presença nem falta, é buraco de dado. Por
--     isso a RPC também devolve dias_distintos e funcionarios_ativos —
--     é como a tela denuncia a filial que "melhora" a taxa deixando de
--     lançar ponto.
--   • Filial sem nenhum registro no período não é zerada: a parcela de
--     frequência simplesmente não entra e a nota fica sendo a do
--     conselho.
--
-- ETAPA 2 (pendente): atraso ainda NÃO penaliza. Atraso não é status
-- no banco — deriva de comparar `entrada` com o horário-alvo da turma,
-- que hoje só existe em env do cliente (VITE_PONTO_ENTRADA) e é
-- passado como parâmetro pra folha (`p_target_entrada`). Enquanto esse
-- horário não morar numa tabela, o banco não consegue classificar
-- atraso de forma confiável: cada cliente poderia mandar um alvo
-- diferente e o placar mudaria de valor conforme quem abriu a tela.
-- Então aqui o atraso é devolvido apenas como INFORMAÇÃO (quando a
-- chamada informa p_target_entrada), fora da taxa e fora do placar. Na
-- etapa 2 a jornada da turma vira dado do banco e o atraso passa a
-- valer 0,5 — ou seja, perde metade do ponto do dia.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Números crus da frequência por filial ──────────────────────
-- p_target_entrada ('HH:MM') é opcional e serve só pra contar atrasos
-- na exibição. Não entra em taxa_presenca nem no placar.
CREATE OR REPLACE FUNCTION public.frequencia_filiais_competicao(
  p_competicao_id  uuid,
  p_target_entrada text DEFAULT NULL
) RETURNS TABLE (
  filial             text,
  registros          int,      -- denominador: presenças + faltas
  presencas          int,
  faltas             int,
  justificados       int,
  atrasos            int,      -- informativo (etapa 1)
  dias_distintos     int,
  funcionarios_ativos int,
  taxa_presenca      numeric   -- 0..1, NULL quando não há registro
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_filial_user text;
  v_inicio date;
  v_fim    date;
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

  -- Alvo malformado não derruba a consulta: só desliga a contagem de atraso.
  IF p_target_entrada ~ '^[0-9]{1,2}:[0-9]{2}$' THEN
    v_target := (p_target_entrada || ':00')::time;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS f
  ),
  pontos AS (
    SELECT pe.filial AS f, pe.data, pe.status, pe.entrada
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
           COUNT(*) FILTER (WHERE COALESCE(p.status,'Normal') <> 'Justificado')::int AS registros,
           COUNT(*) FILTER (WHERE COALESCE(p.status,'Normal') NOT IN ('Falta','Justificado'))::int AS presencas,
           COUNT(*) FILTER (WHERE p.status = 'Falta')::int        AS faltas,
           COUNT(*) FILTER (WHERE p.status = 'Justificado')::int  AS justificados,
           -- Mesma régua da tela de Frequência de Trabalho (entrada > alvo,
           -- sem tolerância). A folha usa tolerância de 1 min pra descontar;
           -- aqui o número serve pra conferência visual, não pra dinheiro.
           -- `entrada` é text — o cast ::time é o padrão do projeto (migr. 129).
           COUNT(*) FILTER (
             WHERE v_target IS NOT NULL
               AND COALESCE(p.status,'Normal') NOT IN ('Falta','Justificado')
               AND p.entrada IS NOT NULL
               AND p.entrada::time > v_target
           )::int AS atrasos,
           COUNT(DISTINCT p.data)::int AS dias_distintos
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
              ELSE ROUND(a.presencas::numeric / a.registros, 4) END
    FROM base b
    LEFT JOIN agg  a  ON a.f  = b.f
    LEFT JOIN func fu ON fu.f = b.f
   WHERE v_filial_user = 'Matriz' OR b.f = v_filial_user
   ORDER BY b.f;
END;
$$;

REVOKE ALL ON FUNCTION public.frequencia_filiais_competicao(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.frequencia_filiais_competicao(uuid, text) TO authenticated;

-- ── 2. Placar: eixo subjetivo sai, parcela objetiva entra ─────────
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp          competicoes_matriz;
  v_result        jsonb;
  v_incluir_eixos boolean;
  -- Peso da frequência na nota final. Fica explícito no retorno pra
  -- tela poder dizer ao aluno quanto vale.
  v_peso_freq     numeric := 0.20;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

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
    -- 'Frequência de Trabalho' saiu daqui: virou medida (bloco freq).
    SELECT a.avaliada_filial AS filial, c.nota::numeric AS nota
      FROM public.criterios_avaliacao c
      JOIN public.avaliacoes a     ON a.id  = c.avaliacao_id
      JOIN public.user_profiles up ON up.id = a.avaliador_id
     WHERE v_incluir_eixos
       AND a.tipo = 'matriz_filial'
       AND a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim
       AND up.role <> 'admin'
       AND c.criterio = 'Planejamento e Organização'
  ),
  todas AS (
    SELECT filial, nota FROM notas_tarefas
    UNION ALL
    SELECT filial, nota FROM notas_eixos
  ),
  freq AS (
    SELECT pe.filial AS f,
           COUNT(*) FILTER (WHERE COALESCE(pe.status,'Normal') <> 'Justificado')::int AS registros,
           COUNT(*) FILTER (WHERE COALESCE(pe.status,'Normal') NOT IN ('Falta','Justificado'))::int AS presencas,
           COUNT(*) FILTER (WHERE pe.status = 'Falta')::int       AS faltas,
           COUNT(*) FILTER (WHERE pe.status = 'Justificado')::int AS justificados
      FROM ponto_eletronico pe
     WHERE pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_comp.data_inicio AND v_comp.data_fim
     GROUP BY pe.filial
  ),
  agregado AS (
    SELECT f.filial,
           COALESCE(ROUND(AVG(t.nota) * 10, 2), 0) AS media_conselho,
           COALESCE(COUNT(t.nota), 0)              AS n,
           COALESCE(fr.registros, 0)               AS registros,
           COALESCE(fr.presencas, 0)               AS presencas,
           COALESCE(fr.faltas, 0)                  AS faltas,
           COALESCE(fr.justificados, 0)            AS justificados,
           CASE WHEN COALESCE(fr.registros,0) = 0 THEN NULL
                ELSE ROUND(fr.presencas::numeric / fr.registros, 4) END AS taxa
      FROM filiais f
      LEFT JOIN todas t ON t.filial = f.filial
      LEFT JOIN freq fr ON fr.f     = f.filial
     GROUP BY f.filial, fr.registros, fr.presencas, fr.faltas, fr.justificados
  ),
  final AS (
    SELECT ag.*,
           CASE
             -- Sem nota do conselho o pódio não significa nada; a tela já
             -- mostra "—". Sem registro de ponto, a frequência não entra e
             -- a filial não é punida pela ausência de dado.
             WHEN ag.n = 0 OR ag.taxa IS NULL THEN ag.media_conselho
             ELSE ROUND(ag.media_conselho * (1 - v_peso_freq) + ag.taxa * 100 * v_peso_freq, 2)
           END AS media
      FROM agregado ag
  )
  SELECT jsonb_object_agg(
           filial,
           jsonb_build_object(
             'media',          media,
             'n',              n,
             'media_conselho', media_conselho,
             'frequencia', jsonb_build_object(
               'taxa',         taxa,
               'registros',    registros,
               'presencas',    presencas,
               'faltas',       faltas,
               'justificados', justificados,
               'entrou',       (n > 0 AND taxa IS NOT NULL)
             )
           )
         )
    INTO v_result
    FROM final;

  RETURN jsonb_build_object(
    'competicao', jsonb_build_object(
      'id', v_comp.id, 'nome', v_comp.nome,
      'data_inicio', v_comp.data_inicio, 'data_fim', v_comp.data_fim,
      'status', v_comp.status, 'vencedora', v_comp.vencedora
    ),
    'inclui_eixos_conselho', COALESCE(v_incluir_eixos, false),
    'peso_frequencia',       v_peso_freq,
    'por_filial',            COALESCE(v_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
