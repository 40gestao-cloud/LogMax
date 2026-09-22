-- 609_20260922_a_nota_carrega_quem_era_o_avaliador.sql
--
-- Duas coisas que o placar da competição não deveria permitir, e permitia:
--
-- 1. NOTA PARA A PRÓPRIA FILIAL. A `avaliar_item_matriz` exige que o avaliador
--    seja da Matriz, o que parecia bastar. Não basta: na 001 três conselheiros
--    voltaram para SuperMax, MaxLook e TechMax (a 608 fecha essa porta daqui
--    pra frente) e cada um tinha dado nota para a unidade que hoje é a dele.
--    Com prêmio único em jogo, o último colocado tem argumento pronto.
--
-- 2. O PLACAR MUDAVA SOZINHO. O cálculo lia `user_profiles` JUNTO com a nota e
--    filtrava `role <> 'admin'` pelo papel de HOJE. Aluno que vira admin depois
--    apaga retroativamente as notas que deu; admin que vira conselheiro faz
--    aparecerem. O pódio de uma competição encerrada em agosto podia virar em
--    setembro sem ninguém tocar em nota nenhuma.
--
-- A nota passa a carregar quem era o avaliador quando a nota foi dada:
-- `avaliador_filial` e `avaliador_role`, gravados por gatilho. Mesma ideia que
-- `matriz_tarefa_participantes.nome_snapshot` e que `avaliacoes.filial` — esta
-- última, aliás, já guardava o vínculo do avaliador desde sempre, e é por ela
-- que se sabe que os três eram Matriz em agosto. É o que justifica o backfill
-- abaixo: toda linha de `avaliacoes_matriz` nasceu pela RPC, que só aceita
-- CEO/conselheiro da Matriz (a RLS bloqueia escrita direta, `WITH CHECK
-- false`), então o vínculo de origem de TODAS elas é Matriz.
--
-- Consequência prática, e é de propósito: o placar da 001 NÃO muda com esta
-- migração. A trava vale pelo vínculo de origem, não pelo de agora. Desprezar
-- as notas dos três por causa de para onde eles foram DEPOIS é outra decisão,
-- do professor, e essa mexe no pódio.
--
-- O gatilho carimba SÓ no INSERT (ou quando a coluna está nula), e a razão é
-- concreta: na primeira tentativa desta migração ele pegava também o UPDATE, o
-- próprio UPDATE do backfill disparou o carimbo e gravou SuperMax/MaxLook/
-- TechMax nas notas de agosto. Resultado: 18 notas saíram do placar da 001 por
-- "nota para a própria filial" e as três médias caíram (63,86 → 65,19;
-- 61,69 → 62,06; 51,93 → 49,97 — pódio na mesma ordem, números diferentes).
-- Desfeito. Carimbo de origem que se reescreve não é carimbo de origem.
--
-- Gatilho em vez de mexer na `avaliar_item_matriz`: a RPC tem 200 linhas e um
-- UPSERT; acrescentar duas colunas lá dentro é transcrever corpo alheio à toa
-- ([[feedback_replace_function_copiar_do_banco]]). O gatilho pega qualquer
-- caminho de escrita, inclusive um futuro.
--
-- NOTA SOBRE O CORPO DA `_calcular_placar_competicao_raw`: copiado do banco
-- nesta sessão (idêntico nos 4 projetos, md5 conferido). As mudanças são as
-- duas cláusulas de trava e a troca do JOIN em `user_profiles` pelas colunas
-- novas.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

ALTER TABLE public.avaliacoes_matriz
  ADD COLUMN IF NOT EXISTS avaliador_filial text,
  ADD COLUMN IF NOT EXISTS avaliador_role   text;

COMMENT ON COLUMN public.avaliacoes_matriz.avaliador_filial IS
  'Vínculo do avaliador no momento da nota. O placar compara com filial_avaliada: ninguém pontua a própria unidade.';
COMMENT ON COLUMN public.avaliacoes_matriz.avaliador_role IS
  'Papel do avaliador no momento da nota. O placar exclui admin por aqui, não pelo papel de hoje.';

CREATE OR REPLACE FUNCTION public.fn_avaliacao_matriz_congela_avaliador()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Congela SÓ no nascimento da linha. No UPDATE (a RPC faz UPSERT: "última
  -- palavra do avaliador vale") o vínculo original fica de pé — reescrever
  -- aqui devolveria o bug que esta migração fecha, agora pela porta dos
  -- fundos: bastaria um UPDATE qualquer pra que o placar passasse a enxergar
  -- o avaliador onde ele está HOJE.
  IF TG_OP = 'INSERT' OR NEW.avaliador_filial IS NULL THEN
    SELECT up.filial, up.role
      INTO NEW.avaliador_filial, NEW.avaliador_role
      FROM public.user_profiles up
     WHERE up.id = NEW.avaliador_id;
  END IF;

  -- Perfil sumido não abre exceção: a nota fica sem vínculo e o placar a trata
  -- como Matriz/conselheiro pelo COALESCE, que é o que a RPC exigiu pra criar.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_avaliacoes_matriz_congela_avaliador ON public.avaliacoes_matriz;
CREATE TRIGGER trg_avaliacoes_matriz_congela_avaliador
  BEFORE INSERT OR UPDATE ON public.avaliacoes_matriz
  FOR EACH ROW EXECUTE FUNCTION public.fn_avaliacao_matriz_congela_avaliador();

-- Backfill do que já existe: ver o parágrafo sobre a RPC no cabeçalho.
UPDATE public.avaliacoes_matriz
   SET avaliador_filial = 'Matriz',
       avaliador_role   = 'conselheiro'
 WHERE avaliador_filial IS NULL;

CREATE OR REPLACE FUNCTION public._calcular_placar_competicao_raw(p_competicao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp          competicoes_matriz;
  v_result        jsonb;
  v_incluir_eixos boolean;
  v_peso_freq     numeric := 0.20;
  v_j             ponto_jornada;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;

  SELECT (
    COUNT(DISTINCT a.avaliada_filial) FILTER (
      WHERE a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
    ) = 3
  ) INTO v_incluir_eixos
    FROM public.avaliacoes a
    JOIN public.user_profiles up ON up.id = a.avaliador_id
   WHERE a.tipo = 'matriz_filial'
     AND up.role <> 'admin'
     -- (609) Mesma trava do eixo lá embaixo: se sobrar só nota da própria
     -- unidade, a cobertura das 3 filiais não se completa e o eixo não entra.
     AND COALESCE(a.filial, 'Matriz') IS DISTINCT FROM a.avaliada_filial
     AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim;

  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial
  ),
  notas_tarefas AS (
    -- `item` é o participante: todas as notas que ele recebeu viram uma
    -- média só antes de a filial ser medida (375).
    SELECT am.filial_avaliada AS filial, am.item_id::text AS item, am.nota::numeric AS nota
      FROM public.avaliacoes_matriz am
      -- LEFT: nota órfã (sem participante) segue contando, como na 353.
      LEFT JOIN public.matriz_tarefa_participantes mtp ON mtp.id = am.item_id
     WHERE am.competicao_id = p_competicao_id
       AND am.ativo = true
       AND am.nota IS NOT NULL
       AND am.item_tipo LIKE 'tarefa\_%'
       -- (609) Papel e vínculo CONGELADOS na nota. Antes isto era um JOIN em
       -- `user_profiles`, e o placar mudava quando alguém trocava de papel.
       AND COALESCE(am.avaliador_role, 'conselheiro') <> 'admin'
       AND COALESCE(am.avaliador_filial, 'Matriz') IS DISTINCT FROM am.filial_avaliada
       AND NOT COALESCE(public._funcionario_desligado(mtp.funcionario_id), false)
  ),
  notas_eixos AS (
    -- Item ÚNICO por filial: o eixo subjetivo é um julgamento da unidade.
    SELECT a.avaliada_filial AS filial, 'eixo:' || c.criterio AS item, c.nota::numeric AS nota
      FROM public.criterios_avaliacao c
      JOIN public.avaliacoes a     ON a.id  = c.avaliacao_id
      JOIN public.user_profiles up ON up.id = a.avaliador_id
     WHERE v_incluir_eixos
       AND a.tipo = 'matriz_filial'
       AND a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim
       AND up.role <> 'admin'
       -- (609) `avaliacoes.filial` é o vínculo do avaliador quando avaliou.
       AND COALESCE(a.filial, 'Matriz') IS DISTINCT FROM a.avaliada_filial
       AND c.criterio = 'Planejamento e Organização'
  ),
  todas AS (
    SELECT filial, item, nota FROM notas_tarefas
    UNION ALL
    SELECT filial, item, nota FROM notas_eixos
  ),
  itens AS (
    SELECT filial, item, AVG(nota) AS media_item, COUNT(*)::int AS n_notas
      FROM todas
     GROUP BY filial, item
  ),
  julgamento AS (
    SELECT filial,
           AVG(media_item)   AS media_itens,
           SUM(n_notas)::int AS n,
           COUNT(*)::int     AS itens
      FROM itens
     GROUP BY filial
  ),
  fq AS (
    SELECT * FROM public._frequencia_competicao(p_competicao_id)
  ),
  agregado AS (
    SELECT f.filial,
           COALESCE(ROUND(jg.media_itens * 10, 2), 0) AS media_conselho,
           COALESCE(jg.n, 0)                          AS n,
           COALESCE(jg.itens, 0)                      AS itens,
           COALESCE(fr.registros, 0)                  AS registros,
           COALESCE(fr.presencas, 0)                  AS presencas,
           COALESCE(fr.faltas, 0)                     AS faltas,
           COALESCE(fr.ausencias, 0)                  AS ausencias,
           COALESCE(fr.justificados, 0)               AS justificados,
           COALESCE(fr.atrasos, 0)                    AS atrasos,
           COALESCE(fr.dias_letivos, 0)               AS dias_letivos,
           COALESCE(fr.funcionarios_ativos, 0)        AS funcionarios_ativos,
           COALESCE(fr.esperado, 0)                   AS esperado,
           COALESCE(fr.tem_calendario, false)         AS tem_calendario,
           fr.taxa                                    AS taxa
      FROM filiais f
      LEFT JOIN julgamento jg ON jg.filial = f.filial
      LEFT JOIN fq         fr ON fr.filial = f.filial
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
             'itens',          itens,
             'media_conselho', media_conselho,
             'frequencia', jsonb_build_object(
               'taxa',         taxa,
               'registros',    registros,
               'presencas',    presencas,
               'faltas',       faltas,
               'ausencias',    ausencias,
               'justificados', justificados,
               'atrasos',      atrasos,
               'dias_letivos', dias_letivos,
               'funcionarios_ativos', funcionarios_ativos,
               'esperado',     esperado,
               'calendario',   tem_calendario,
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
    'media_por_item',        true,
    'trava_filial_propria',  true,
    'atraso_conta',          COALESCE(v_j.configurado, false),
    'jornada_entrada',       v_j.entrada,
    'calendario_turma',      COALESCE(array_length(v_j.dias_semana, 1), 0) > 0,
    'dias_semana',           to_jsonb(COALESCE(v_j.dias_semana, '{}'::smallint[])),
    'por_filial',            COALESCE(v_result, '{}'::jsonb)
  );
END;
$function$;

COMMIT;
