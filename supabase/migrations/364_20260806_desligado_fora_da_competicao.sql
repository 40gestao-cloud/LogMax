-- =================================================================
-- 364 — Desligado sai do placar da Competição e para de receber nota.
--
-- Buraco: a 356 tirou o desligado da FREQUÊNCIA do placar, e a tela do
-- Padrão já filtrava pendência por `desligado_em`. A Competição do
-- Conselho ficou de fora das duas — participante desligado continuava
-- valendo nota e puxando a média da filial que ele não integra mais.
--
-- Confirmado no LogMax-ERP: 3 desligadas em 03/08 seguiam na tarefa de
-- 28/07 com 16 notas ativas, derrubando as 3 filiais (SuperMax 60,61 →
-- 69,03; MaxLook 57,05 → 63,95; TechMax 39,47 → 44,17).
--
-- Fecha a régua já estabelecida em [desligado vai pra recuperação sob a
-- Matriz]: quem foi desligado não sai do curso, sai da filial — e por
-- isso não pesa mais no placar dela.
--
-- 1) `calcular_placar_competicao` ignora nota de participante desligado.
-- 2) `avaliar_item_matriz` recusa nota nova em participante desligado.
--
-- Nota órfã (item_id sem participante, cenário da 353) CONTINUA
-- contando: o LEFT JOIN + COALESCE preserva esse comportamento de
-- propósito — trocar por INNER JOIN silenciaria aquelas notas junto,
-- que é outro assunto e não foi pedido.
--
-- Idempotente. Não apaga nada: as notas seguem no banco, só param de
-- entrar na conta.
-- =================================================================

BEGIN;

-- ── 1. Placar ignora nota de desligado ────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(p_competicao_id uuid)
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

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

-- ── 2. Nota nova em desligado é recusada ──────────────────────────
CREATE OR REPLACE FUNCTION public.avaliar_item_matriz(
  p_competicao_id  uuid,
  p_filial_avaliada text,
  p_item_tipo      text,
  p_item_id        uuid,
  p_decisao        text DEFAULT NULL,
  p_nota           numeric DEFAULT NULL,
  p_comentario     text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_role        text;
  v_filial      text;
  v_is_cons     boolean;
  v_id          uuid;
  v_tstatus     text;
  v_filial_item text;
  v_comp_tarefa uuid;
  v_func_id     uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_is_cons
  FROM public.user_profiles WHERE id = v_user_id;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role = 'ceo' OR v_role = 'conselheiro' OR (v_role = 'gerente' AND COALESCE(v_is_cons, false)))
  THEN
    RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competicoes_matriz
    WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  v_filial_item := p_filial_avaliada;

  IF p_item_tipo LIKE 'tarefa\_%' THEN
    SELECT t.status, p.filial, t.competicao_id, p.funcionario_id
      INTO v_tstatus, v_filial_item, v_comp_tarefa, v_func_id
      FROM public.matriz_tarefa_participantes p
      JOIN public.matriz_tarefas t ON t.id = p.tarefa_id
     WHERE p.id = p_item_id AND p.ativo = true AND t.ativo = true;

    IF v_tstatus IS NULL THEN
      RAISE EXCEPTION 'Participante ou tarefa não encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF v_comp_tarefa IS DISTINCT FROM p_competicao_id THEN
      RAISE EXCEPTION 'Participante não pertence a esta competição' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus = 'rascunho' THEN
      RAISE EXCEPTION 'Tarefa ainda não liberada para notas' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus <> 'aberta' THEN
      RAISE EXCEPTION 'Tarefa encerrada — reabra pra alterar notas' USING ERRCODE = 'P0001';
    END IF;
    -- Desligado saiu da filial: não recebe nota nova nem alteração.
    IF COALESCE(public._funcionario_desligado(v_func_id), false) THEN
      RAISE EXCEPTION 'Participante desligado — não recebe mais nota nesta competição'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.avaliacoes_matriz (
    competicao_id, filial_avaliada, item_tipo, item_id,
    avaliador_id, decisao, nota, comentario
  )
  VALUES (
    p_competicao_id, v_filial_item, p_item_tipo, p_item_id,
    v_user_id, p_decisao, p_nota, p_comentario
  )
  ON CONFLICT (competicao_id, item_tipo, item_id, avaliador_id)
    WHERE ativo = true
  DO UPDATE SET
    filial_avaliada = EXCLUDED.filial_avaliada,
    decisao         = EXCLUDED.decisao,
    nota            = EXCLUDED.nota,
    comentario      = EXCLUDED.comentario,
    updated_at      = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.avaliar_item_matriz(uuid,text,text,uuid,text,numeric,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_item_matriz(uuid,text,text,uuid,text,numeric,text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
