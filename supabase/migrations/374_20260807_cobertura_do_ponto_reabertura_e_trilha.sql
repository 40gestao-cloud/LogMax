-- =================================================================
-- 374 — Três bugs da mesma auditoria, nenhum deles no cálculo da nota.
--
-- (1) A COBERTURA DO PONTO NÃO CHEGAVA AO PLACAR
--     A frequência vale 20% e o denominador é só o que TEM registro: dia
--     sem lançamento não é presença nem falta. A `frequencia_filiais_competicao`
--     (349) sabe disso e devolve `dias_distintos` e `funcionarios_ativos`
--     justamente pra tela poder denunciar a filial que "melhora" a taxa
--     deixando de lançar ponto — mas o placar não carregava nenhum dos
--     dois. Resultado: no pódio, 100% em 6 registros e 100% em 24 são o
--     mesmo número, e a diferença entre 1º e 2º sai de um eixo cuja
--     cobertura ninguém enxerga.
--     Agora os dois campos vão dentro de `frequencia`, junto do resto.
--     O cálculo da taxa e da média NÃO muda — nenhum resultado se move.
--
-- (2) REABRIR PODIA MORRER COM ERRO CRU, E O AVISO NÃO CHEGAVA À FILIAL
--     `uniq_comp_em_andamento` só admite uma competição em andamento.
--     `reabrir_competicao` põe a competição de volta em 'em_andamento'
--     sem olhar isso: com outra já rodando, o admin levava um 23505 do
--     Postgres na cara, sem dizer o que fazer.
--     E o aviso da reabertura era inserido com `filial = 'Matriz'`, que a
--     policy `notif_read` entrega ao conselho e BARRA às filiais —
--     embora o texto fale com a filial e o diálogo da tela prometa que
--     ela é avisada. Quem viu o troféu sumir não recebia explicação.
--     Passa a notificar cada filial, como `encerrar_matriz_tarefa` faz.
--
-- (3) REMOVER PARTICIPANTE SUMIA SEM DEIXAR RASTRO
--     `remover_matriz_participante` (348) inativa junto as notas do
--     conselho — ou seja, tirar da tarefa quem foi mal avaliado sobe a
--     média da filial. É um gesto legítimo de gestão, mas nenhum lugar
--     registrava que ele aconteceu.
--     A trilha da 331 já existe e é append-only; aqui ela passa a cobrir
--     a competição, as tarefas e os participantes.
--     `avaliacoes_matriz` fica FORA de propósito: o histórico é lido por
--     quem enxerga a filial, e a nota individual é selada até a tarefa
--     encerrar (345). A remoção do participante já conta a história sem
--     revelar valor nenhum.
--
-- Idempotente. Nada de nota, voto ou placar congelado muda de valor.
-- =================================================================

BEGIN;

-- ── 1. Cobertura do ponto dentro do placar ────────────────────────
-- Corpo da 373 com duas linhas a mais na frequência: `dias_distintos` e
-- `funcionarios_ativos`, mesmos nomes da `frequencia_filiais_competicao`.
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
           -- Denominador esperado = dias com lançamento × gente ativa. É o
           -- par que denuncia a filial que lança ponto pela metade.
           COUNT(DISTINCT pe.data)::int                        AS dias,
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
  ativos AS (
    SELECT fn.filial AS f, COUNT(*)::int AS n
      FROM public.funcionarios fn
     WHERE fn.filial IN ('SuperMax','MaxLook','TechMax')
       AND fn.ativo = true
       AND NOT public._funcionario_desligado(fn.id)
     GROUP BY fn.filial
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
           COALESCE(fr.dias, 0)                    AS dias_distintos,
           COALESCE(at.n, 0)                       AS funcionarios_ativos,
           CASE WHEN COALESCE(fr.registros,0) = 0 THEN NULL
                ELSE ROUND(fr.creditos / fr.registros, 4) END AS taxa
      FROM filiais f
      LEFT JOIN todas  t  ON t.filial = f.filial
      LEFT JOIN freq   fr ON fr.f     = f.filial
      LEFT JOIN ativos at ON at.f     = f.filial
     GROUP BY f.filial, fr.registros, fr.presencas, fr.faltas, fr.justificados,
              fr.atrasos, fr.dias, at.n, fr.creditos
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
               'dias_distintos',      dias_distintos,
               'funcionarios_ativos', funcionarios_ativos,
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

REVOKE ALL ON FUNCTION public._calcular_placar_competicao_raw(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Reabrir: barreira do índice único + aviso que chega ────────
CREATE OR REPLACE FUNCTION public.reabrir_competicao(
  p_competicao_id uuid,
  p_data_fim      date DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status   text;
  v_nome     text;
  v_data_fim date;
  v_hoje     date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  v_nova_fim date;
  v_outra    text;
  v_f        text;
BEGIN
  IF auth_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas a Administração reabre uma competição'
      USING ERRCODE = '42501';
  END IF;

  SELECT status, nome, data_fim INTO v_status, v_nome, v_data_fim
    FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'encerrada' THEN
    RAISE EXCEPTION 'Só competição encerrada pode ser reaberta (status atual: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- `uniq_comp_em_andamento` só deixa uma correr por vez. Sem esta
  -- checagem o UPDATE abaixo estoura 23505, que chega na tela como erro
  -- de banco e não diz o que fazer.
  SELECT nome INTO v_outra
    FROM competicoes_matriz
   WHERE ativo = true AND status = 'em_andamento' AND id <> p_competicao_id
   LIMIT 1;
  IF v_outra IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe competição em andamento ("%") — encerre ela antes de reabrir esta', v_outra
      USING ERRCODE = 'P0001';
  END IF;

  IF p_data_fim IS NOT NULL AND p_data_fim < v_hoje THEN
    RAISE EXCEPTION 'A nova data de fim não pode ser anterior a hoje' USING ERRCODE = 'P0001';
  END IF;

  -- Só empurra se precisa: competição ainda dentro do prazo mantém a data
  -- que o admin definiu.
  v_nova_fim := COALESCE(p_data_fim, GREATEST(v_data_fim, v_hoje));

  UPDATE competicoes_matriz
     SET status                   = 'em_andamento',
         data_fim                 = v_nova_fim,
         vencedora                = NULL,
         placar_snapshot          = NULL,
         declaracao_justificativa = NULL,
         encerrada_por            = NULL,
         -- O corte do mandato (372): o que foi votado descrevia o placar
         -- anterior. Os votos ficam registrados, mas param de contar.
         reaberta_em              = now(),
         updated_at               = now()
   WHERE id = p_competicao_id;

  -- Conselho.
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  VALUES (
    'all', 'info',
    'Competição reaberta',
    format('"%s" voltou a correr até %s — o resultado anterior deixa de valer e o conselho vota de novo antes da próxima declaração.',
           v_nome, to_char(v_nova_fim, 'DD/MM/YYYY')),
    'matriz-competicao', 'Alta', auth.uid(), p_competicao_id, 'competicao_reaberta', 'Matriz'
  );

  -- Filiais: são elas que viram o troféu sumir da tela. Com `filial =
  -- 'Matriz'` a policy notif_read barrava justamente quem precisava do
  -- aviso — uma linha por filial, como faz `encerrar_matriz_tarefa`.
  FOREACH v_f IN ARRAY ARRAY['SuperMax','MaxLook','TechMax']
  LOOP
    INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
    VALUES (
      'all', 'info',
      'Competição reaberta',
      format('"%s" voltou a correr até %s — o resultado anterior deixa de valer, e a medalha só reaparece quando a Matriz declarar de novo.',
             v_nome, to_char(v_nova_fim, 'DD/MM/YYYY')),
      'avaliacoes', 'Alta', auth.uid(), p_competicao_id, 'competicao_reaberta', v_f
    );
  END LOOP;

  RETURN v_nova_fim;
END;
$$;

REVOKE ALL ON FUNCTION public.reabrir_competicao(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_competicao(uuid,date) TO authenticated;

-- ── 3. A trilha da 331 passa a cobrir a competição ────────────────
-- `competicoes_matriz` não tem coluna `filial` — o histórico nasce com
-- filial NULL, que a `historico_select` mostra a todo mundo. É o que se
-- quer aqui: quem disputa tem direito de ver que a competição foi
-- reaberta, redeclarada ou teve a data mexida.
DROP TRIGGER IF EXISTS trg_historico ON public.competicoes_matriz;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.competicoes_matriz
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'vencedora', 'data_inicio', 'data_fim', 'reaberta_em');

-- `declaracao_justificativa` fica FORA da lista de propósito: o texto iria
-- parar em `historico_operacoes.detalhe`, que com filial NULL é lido por
-- toda a empresa. Hoje ele só aparece na tela da Matriz — publicar pra
-- todo mundo é decisão de processo, não efeito colateral de trilha. Que a
-- vencedora mudou já fica registrado pela coluna `vencedora`.

DROP TRIGGER IF EXISTS trg_historico ON public.matriz_tarefas;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.matriz_tarefas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'data');

-- Participante removido leva junto a nota dele (348). O evento 'Inativado'
-- do trigger genérico é exatamente o registro que faltava — e sai com a
-- filial do participante, então a unidade lê o que aconteceu com ela.
DROP TRIGGER IF EXISTS trg_historico ON public.matriz_tarefa_participantes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.matriz_tarefa_participantes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome_snapshot', 'filial');

COMMIT;

NOTIFY pgrst, 'reload schema';
