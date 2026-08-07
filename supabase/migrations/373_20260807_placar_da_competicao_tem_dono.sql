-- =================================================================
-- 373 — O placar da competição passa a ter dono.
--
-- `calcular_placar_competicao` era SECURITY DEFINER com EXECUTE para
-- `authenticated` e nenhuma checagem de papel ou de status. Quer dizer:
-- qualquer aluno de qualquer filial rodava a RPC pelo F12 e lia o placar
-- ao vivo, incluindo média por filial e frequência, no meio da
-- competição. A tela da filial esconde isso de propósito — o comentário
-- do PodioFilialCard diz "só com a competição ENCERRADA: enquanto a
-- votação corre, a medalha oscilaria a cada nota e viraria placar ao
-- vivo" —, mas a regra morava só lá.
--
-- Pior que ver o placar: com ele dá pra furar o voto selado da 345. As
-- notas do conselho ficam invisíveis até a tarefa encerrar, só que o
-- placar SOMA todas elas. Um conselheiro que chame a RPC antes e depois
-- de um colega avaliar deriva a nota alheia por diferença — e ancorar a
-- própria nota na do outro é exatamente o que a 345 foi escrita pra
-- impedir.
--
-- Como fica:
--   • Matriz (admin/CEO/conselheiro/gerente-conselheiro): placar ao
--     vivo, como sempre — é quem conduz a competição.
--   • Filial: só depois de a competição ser declarada, e servida do
--     `placar_snapshot` congelado na declaração, não de um recálculo.
--     Isso também mata a incoerência de a medalha da filial poder mudar
--     depois do resultado, se alguma nota for mexida.
--   • Competição ainda correndo, pedida por filial: 42501 com mensagem
--     que explica, em vez de devolver número.
--   • service_role (o /api/ai-competicao gera a análise com ele):
--     passa direto. Ali não há usuário — `auth.uid()` é NULL — e o
--     endpoint já faz a própria checagem de papel antes de chamar.
--
-- Implementação: o corpo do cálculo vira `_calcular_placar_competicao_raw`,
-- fechado até para `authenticated`, e o nome público continua sendo
-- `calcular_placar_competicao` — que agora é o porteiro. Assim nada que
-- chama a RPC pelo nome (front da Matriz, `ranking_competicao`,
-- `declarar_vencedora`) precisa mudar, e o formato do retorno é o mesmo
-- nos dois caminhos: `placar_snapshot` É a saída desta função, gravada
-- na declaração.
--
-- Corpo do cálculo copiado do estado vigente no banco (364), sem uma
-- vírgula de diferença: o que muda é quem consegue chamar.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. O cálculo, agora privado ───────────────────────────────────
CREATE OR REPLACE FUNCTION public._calcular_placar_competicao_raw(p_competicao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp          competicoes_matriz;
  v_result        jsonb;
  v_incluir_eixos boolean;
  v_peso_freq     numeric := 0.20;
  v_j             ponto_jornada;
  v_target        time;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;
  IF COALESCE(v_j.configurado, false) THEN
    v_target := (v_j.entrada || ':00')::time;
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
      -- LEFT: nota órfã (sem participante) segue contando, como na 353.
      LEFT JOIN public.matriz_tarefa_participantes mtp ON mtp.id = am.item_id
     WHERE am.competicao_id = p_competicao_id
       AND am.ativo = true
       AND am.nota IS NOT NULL
       AND am.item_tipo LIKE 'tarefa\_%'
       AND up.role <> 'admin'
       -- COALESCE: sem ele, funcionario_id NULL devolveria NULL e a
       -- linha sumiria em silêncio em vez de contar.
       AND NOT COALESCE(public._funcionario_desligado(mtp.funcionario_id), false)
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
       AND c.criterio = 'Planejamento e Organização'
  ),
  todas AS (
    SELECT filial, nota FROM notas_tarefas
    UNION ALL
    SELECT filial, nota FROM notas_eixos
  ),
  freq AS (
    SELECT pe.filial AS f,
           COUNT(*) FILTER (WHERE cr.credito IS NOT NULL)::int AS registros,
           COUNT(*) FILTER (WHERE cr.credito > 0)::int         AS presencas,
           COUNT(*) FILTER (WHERE pe.status = 'Falta')::int    AS faltas,
           COUNT(*) FILTER (WHERE COALESCE(pe.status,'Normal') = 'Justificado')::int AS justificados,
           COUNT(*) FILTER (WHERE cr.credito = 0.5)::int       AS atrasos,
           SUM(cr.credito)                                     AS creditos
      FROM ponto_eletronico pe
      CROSS JOIN LATERAL (
        SELECT public._freq_credito_dia(pe.status, pe.entrada, v_target, v_j.tolerancia_min) AS credito
      ) cr
     WHERE pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_comp.data_inicio AND v_comp.data_fim
       AND NOT public._funcionario_desligado(pe.funcionario_id)
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
           COALESCE(fr.atrasos, 0)                 AS atrasos,
           CASE WHEN COALESCE(fr.registros,0) = 0 THEN NULL
                ELSE ROUND(fr.creditos / fr.registros, 4) END AS taxa
      FROM filiais f
      LEFT JOIN todas t ON t.filial = f.filial
      LEFT JOIN freq fr ON fr.f     = f.filial
     GROUP BY f.filial, fr.registros, fr.presencas, fr.faltas, fr.justificados,
              fr.atrasos, fr.creditos
  ),
  final AS (
    SELECT ag.*,
           CASE
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
               'atrasos',      atrasos,
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
    'atraso_conta',          COALESCE(v_j.configurado, false),
    'jornada_entrada',       v_j.entrada,
    'por_filial',            COALESCE(v_result, '{}'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public._calcular_placar_competicao_raw(uuid) IS
  'Calculo cru do placar, sem porteiro. Chamada so pela calcular_placar_competicao, que decide quem ve o que.';

-- Ninguém chama direto: nem `authenticated`, nem `anon`.
REVOKE ALL ON FUNCTION public._calcular_placar_competicao_raw(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. O nome público vira o porteiro ─────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(p_competicao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_jwt_role text;
  v_role     text;
  v_filial   text;
  v_cons     boolean;
  v_status   text;
  v_snapshot jsonb;
BEGIN
  -- /api/ai-competicao roda com service_role: não há usuário logado, e a
  -- checagem de papel já aconteceu no endpoint. `NULLIF` porque o claim
  -- vem string vazia quando não há JWT, e '' não casta pra jsonb.
  v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role';
  IF v_jwt_role = 'service_role' THEN
    RETURN public._calcular_placar_competicao_raw(p_competicao_id);
  END IF;

  SELECT up.role, up.filial, up.is_conselheiro
    INTO v_role, v_filial, v_cons
    FROM public.user_profiles up
   WHERE up.id = auth.uid();

  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  -- Quem conduz a competição vê o placar enquanto ela corre.
  IF v_filial = 'Matriz'
     AND (v_role IN ('admin','ceo','conselheiro')
          OR (v_role = 'gerente' AND COALESCE(v_cons, false)))
  THEN
    RETURN public._calcular_placar_competicao_raw(p_competicao_id);
  END IF;

  SELECT c.status, c.placar_snapshot
    INTO v_status, v_snapshot
    FROM public.competicoes_matriz c
   WHERE c.id = p_competicao_id AND c.ativo = true;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'encerrada' THEN
    RAISE EXCEPTION 'O placar em andamento é da Matriz — a filial vê o resultado quando a vencedora for declarada'
      USING ERRCODE = '42501';
  END IF;

  -- O snapshot é a saída desta mesma função, congelada na declaração:
  -- mesmo formato, e imune a nota mexida depois do resultado. O fallback
  -- cobre competição encerrada antes da 372, que pode não ter snapshot —
  -- ali a competição já acabou, então recalcular não antecipa nada.
  RETURN COALESCE(v_snapshot, public._calcular_placar_competicao_raw(p_competicao_id));
END;
$function$;

COMMENT ON FUNCTION public.calcular_placar_competicao(uuid) IS
  'Placar com porteiro (373): Matriz ve ao vivo; filial ve o snapshot da competicao ja declarada; service_role passa direto.';

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
