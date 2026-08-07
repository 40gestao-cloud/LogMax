-- =================================================================
-- 375 — Três mudanças de regra no julgamento da Competição.
--
-- Não são correções de defeito: são decisões sobre COMO se julga, e
-- estão aqui porque as três atacam a mesma fragilidade — o resultado
-- podia mudar por causa de quem avaliou o quê, e não do que a filial fez.
--
-- (1) CADA ITEM VALE UM, NÃO CADA NOTA
--     O placar era média simples de TODAS as notas. Quem avaliou mais
--     pesava mais: um conselheiro que deixasse de avaliar 3 participantes
--     de uma filial mudava a média dela sem que nada acusasse. E a
--     severidade entre avaliadores é enorme — nesta turma, sobre os
--     MESMOS participantes, um deu média 2,83–5,25 e outro 5,84–8,69.
--     Com cobertura desigual, essa diferença vaza direto pro pódio.
--
--     Agora: média por ITEM primeiro (as notas que ele recebeu), depois
--     média dos itens da filial. Item = participante de tarefa. As notas
--     do eixo subjetivo da Avaliação de Filial entram como UM item por
--     filial — se cada nota de eixo virasse um item, as 2 notas de eixo
--     pesariam como 2 participantes, e um eixo passaria a valer mais do
--     que vale hoje.
--
--     Efeito medido no LogMax-ERP antes de aplicar (cobertura hoje está
--     completa, então a diferença é só de arredondamento e a ordem não
--     muda): SuperMax 67,60 → 67,69 · MaxLook 66,67 → 66,96 · TechMax
--     49,61 → 49,80. O ganho aparece na competição em que alguém não
--     avaliar tudo.
--
--     `n` continua sendo a contagem de notas (é o que a tela diz), e
--     `itens` entra ao lado pra a régua ficar legível.
--
-- (2) VOTO DO CONSELHO SELADO
--     A 345 selou a NOTA porque ver o julgamento alheio antes de julgar
--     ancora o próprio. O voto sobre o placar ficou de fora: `voto_read`
--     entregava voto e comentário de todo mundo assim que registrados, e
--     a tela listava. O segundo e o terceiro votante decidiam olhando o
--     placar de aceita × rejeita.
--     Agora: cada um vê o próprio voto sempre; os alheios só depois de a
--     competição ser declarada. O admin segue vendo tudo — ele não vota
--     (exceto pra desempatar) e é quem homologa.
--     Pra a tela não ficar cega, `progresso_votacao_competicao` devolve
--     quantos já votaram, sem revelar em quê.
--
-- (3) DECLARAR COM AVALIAÇÃO PELA METADE EXIGE JUSTIFICATIVA
--     `lembrar_avaliacoes_pendentes` (345) já sabia contar participante
--     sem nota de todo o conselho — mas isso só virava aviso no sino, e
--     a declaração seguia liberada. Homologar um placar em que metade
--     dos participantes de uma filial não foi avaliada é o cenário em
--     que a média mente mais.
--     Não bloqueia de vez, porque conselheiro ausente travaria a
--     competição pra sempre: entra na mesma régua da divergência (372) —
--     passa com justificativa escrita, que fica gravada.
--
-- Idempotente. Nenhuma nota, voto ou snapshot já congelado muda.
-- =================================================================

BEGIN;

-- ── 1. Placar por item ────────────────────────────────────────────
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
    -- `item` é o participante: todas as notas que ele recebeu viram uma
    -- média só antes de a filial ser medida.
    SELECT am.filial_avaliada AS filial, am.item_id::text AS item, am.nota::numeric AS nota
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
    -- Item ÚNICO por filial: o eixo subjetivo é um julgamento da unidade,
    -- não N julgamentos. Um item por nota faria o eixo pesar como se
    -- fossem vários participantes.
    SELECT a.avaliada_filial AS filial, 'eixo:' || c.criterio AS item, c.nota::numeric AS nota
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
           COALESCE(ROUND(jg.media_itens * 10, 2), 0) AS media_conselho,
           COALESCE(jg.n, 0)                          AS n,
           COALESCE(jg.itens, 0)                      AS itens,
           COALESCE(fr.registros, 0)                  AS registros,
           COALESCE(fr.presencas, 0)                  AS presencas,
           COALESCE(fr.faltas, 0)                     AS faltas,
           COALESCE(fr.justificados, 0)               AS justificados,
           COALESCE(fr.atrasos, 0)                    AS atrasos,
           COALESCE(fr.dias, 0)                       AS dias_distintos,
           COALESCE(at.n, 0)                          AS funcionarios_ativos,
           CASE WHEN COALESCE(fr.registros,0) = 0 THEN NULL
                ELSE ROUND(fr.creditos / fr.registros, 4) END AS taxa
      FROM filiais f
      LEFT JOIN julgamento jg ON jg.filial = f.filial
      LEFT JOIN freq       fr ON fr.f      = f.filial
      LEFT JOIN ativos     at ON at.f      = f.filial
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
    'media_por_item',        true,
    'atraso_conta',          COALESCE(v_j.configurado, false),
    'jornada_entrada',       v_j.entrada,
    'por_filial',            COALESCE(v_result, '{}'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._calcular_placar_competicao_raw(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Voto selado até a declaração ───────────────────────────────
DROP POLICY IF EXISTS voto_read ON public.competicao_votos;
CREATE POLICY voto_read ON public.competicao_votos
  FOR SELECT TO authenticated
  USING (
    -- Admin da Matriz: modera, homologa e não vota (exceto desempate).
    EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = auth.uid() AND up.filial = 'Matriz' AND up.role = 'admin'
    )
    -- O próprio voto, sempre.
    OR votante_id = auth.uid()
    -- Conselho: voto alheio só depois de a competição ser declarada.
    OR (
      EXISTS (
        SELECT 1 FROM public.user_profiles up
         WHERE up.id = auth.uid() AND up.filial = 'Matriz'
           AND (up.role IN ('ceo','conselheiro')
                OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro,false)))
      )
      AND EXISTS (
        SELECT 1 FROM public.competicoes_matriz c
         WHERE c.id = competicao_votos.competicao_id
           AND c.status = 'encerrada'
      )
    )
  );

COMMENT ON POLICY voto_read ON public.competicao_votos IS
  'Voto selado (375): o proprio sempre; o alheio so depois de declarada. Admin ve tudo — homologa e nao vota.';

-- "Quantos já votaram" sem revelar em quê — o equivalente da
-- `progresso_avaliacao_matriz` (345) para a votação.
CREATE OR REPLACE FUNCTION public.progresso_votacao_competicao(p_competicao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role      text;
  v_filial    text;
  v_cons      boolean;
  v_votos     int;
  v_eleitores int;
  v_eu        boolean;
BEGIN
  SELECT up.role, up.filial, up.is_conselheiro
    INTO v_role, v_filial, v_cons
    FROM user_profiles up WHERE up.id = auth.uid();

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT COALESCE(v_role IN ('admin','ceo','conselheiro')
                     OR (v_role = 'gerente' AND COALESCE(v_cons,false)), false)
  THEN
    RAISE EXCEPTION 'Apenas a Matriz vê o progresso da votação' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int,
         COUNT(*) FILTER (WHERE votante_id = auth.uid()) > 0
    INTO v_votos, v_eu
    FROM public._competicao_votos_validos(p_competicao_id);

  v_eleitores := public.contar_votantes_matriz();

  RETURN jsonb_build_object(
    'votos',     v_votos,
    'eleitores', v_eleitores,
    -- Maioria simples: MAIS da metade. Mesma conta de `declarar_vencedora`.
    'quorum',    GREATEST(1, (GREATEST(v_eleitores,1) / 2) + 1),
    'ja_votei',  COALESCE(v_eu, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.progresso_votacao_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.progresso_votacao_competicao(uuid) TO authenticated;

-- ── 3. Cobertura da avaliação ─────────────────────────────────────
-- Participante de tarefa já liberada que ainda não recebeu nota de TODO
-- o conselho. Mesma conta da `lembrar_avaliacoes_pendentes` (345), agora
-- também disponível pra tela e pro gate da declaração.
CREATE OR REPLACE FUNCTION public.participantes_sem_nota_competicao(p_competicao_id uuid)
RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_filial text;
  v_n      int;
BEGIN
  SELECT up.filial INTO v_filial FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial IS DISTINCT FROM 'Matriz' THEN
    RAISE EXCEPTION 'Apenas a Matriz vê a cobertura da avaliação' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int INTO v_n
    FROM matriz_tarefa_participantes p
    JOIN matriz_tarefas t ON t.id = p.tarefa_id
   WHERE t.competicao_id = p_competicao_id
     AND t.ativo = true AND p.ativo = true
     -- Rascunho ainda não aceita nota: cobrar dele seria cobrar o que a
     -- própria Matriz não liberou.
     AND t.status IN ('aberta','encerrada')
     -- Desligado não recebe nota nova (364) — cobrar seria impossível.
     AND NOT COALESCE(public._funcionario_desligado(p.funcionario_id), false)
     AND (
       SELECT COUNT(*) FROM avaliacoes_matriz am
        JOIN user_profiles av ON av.id = am.avaliador_id
        WHERE am.item_id = p.id AND am.ativo = true AND am.nota IS NOT NULL
          AND av.role <> 'admin'
     ) < public.contar_votantes_matriz();

  RETURN COALESCE(v_n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.participantes_sem_nota_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.participantes_sem_nota_competicao(uuid) TO authenticated;

-- Declaração passa a cobrar a cobertura. Assinatura inalterada (372) —
-- CREATE OR REPLACE, sem DROP.
CREATE OR REPLACE FUNCTION public.declarar_vencedora(
  p_competicao_id uuid,
  p_vencedora     text,
  p_justificativa text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_comp       competicoes_matriz;
  v_snapshot   jsonb;
  v_validos    int;
  v_quorum     int;
  v_eleitores  int;
  v_sugestao   text;
  v_topo       record;
  v_esperada   text;
  v_sem_nota   int;
  v_divergente boolean;
  v_just       text := NULLIF(TRIM(COALESCE(p_justificativa,'')), '');
BEGIN
  -- Quem julga é o conselho; quem homologa é a Administração.
  -- `auth_is_admin()` não serve aqui: devolve true para CEO e conselheiro.
  IF auth_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas a Administração declara a vencedora'
      USING ERRCODE = '42501';
  END IF;

  IF p_vencedora NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Filial inválida: %', p_vencedora USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_comp FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.status = 'encerrada' THEN
    RAISE EXCEPTION 'Competição já encerrada' USING ERRCODE = 'P0001';
  END IF;
  -- Em 'em_andamento' a competição ainda aceita nota nova: declarar ali
  -- seria congelar um placar que o próprio conselho ainda está mexendo.
  IF v_comp.status <> 'aguardando_encerramento' THEN
    RAISE EXCEPTION 'Encerre a competição antes de declarar (status atual: %)', v_comp.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Quórum de maioria simples — MAIS da metade, não a metade: com 4
  -- eleitores são 3, porque 2×2 é empate e não mandato.
  SELECT COUNT(*)::int INTO v_validos
    FROM public._competicao_votos_validos(p_competicao_id);

  v_eleitores := public.contar_votantes_matriz();
  v_quorum    := GREATEST(1, (GREATEST(v_eleitores, 1) / 2) + 1);

  IF v_validos < v_quorum THEN
    RAISE EXCEPTION 'Quórum não atingido: % de % voto(s) necessário(s)%',
      v_validos, v_quorum,
      CASE WHEN v_comp.reaberta_em IS NOT NULL
           THEN ' — a competição foi reaberta, o conselho precisa votar de novo'
           ELSE '' END
      USING ERRCODE = 'P0001';
  END IF;

  -- Vencedora esperada: o que o conselho decidiu ao rejeitar o placar
  -- ou, na falta disso, o topo do ranking.
  v_sugestao := public._sugestao_rejeicao_competicao(p_competicao_id);

  SELECT r.filial, r.n INTO v_topo
    FROM public.ranking_competicao(p_competicao_id) r
   WHERE r.posicao = 1;

  IF v_topo IS NULL OR v_topo.n = 0 THEN
    RAISE EXCEPTION 'Nenhuma nota registrada — não há placar para homologar'
      USING ERRCODE = 'P0001';
  END IF;

  v_esperada   := COALESCE(v_sugestao, v_topo.filial);
  v_divergente := p_vencedora IS DISTINCT FROM v_esperada;
  v_sem_nota   := public.participantes_sem_nota_competicao(p_competicao_id);

  -- Divergir do apurado é prerrogativa da Administração, não acidente.
  IF v_divergente AND (v_just IS NULL OR LENGTH(v_just) < 20) THEN
    RAISE EXCEPTION
      'Declarar % contraria o resultado (esperada: %). Escreva uma justificativa de ao menos 20 caracteres.',
      p_vencedora, v_esperada
      USING ERRCODE = 'P0001';
  END IF;

  -- Homologar média de gente que metade do conselho não avaliou é o
  -- cenário em que ela mente mais. Não trava — conselheiro ausente
  -- pararia a competição pra sempre —, mas exige que fique escrito.
  IF v_sem_nota > 0 AND (v_just IS NULL OR LENGTH(v_just) < 20) THEN
    RAISE EXCEPTION
      '% participante(s) ainda sem nota de todo o conselho. Complete as notas ou justifique por escrito (20+ caracteres) por que o placar já pode ser homologado.',
      v_sem_nota
      USING ERRCODE = 'P0001';
  END IF;

  -- Sem divergência e com avaliação completa não há o que justificar:
  -- evita texto órfão descrevendo decisão que não houve.
  IF NOT v_divergente AND v_sem_nota = 0 THEN
    v_just := NULL;
  END IF;

  -- Congela placar do momento da declaração.
  v_snapshot := calcular_placar_competicao(p_competicao_id);

  UPDATE competicoes_matriz
     SET status                   = 'encerrada',
         vencedora                = p_vencedora,
         placar_snapshot          = v_snapshot,
         declaracao_justificativa = v_just,
         encerrada_por            = auth.uid(),
         updated_at               = now()
   WHERE id = p_competicao_id;

  RETURN jsonb_build_object(
    'competicao_id', p_competicao_id,
    'vencedora',     p_vencedora,
    'esperada',      v_esperada,
    'divergente',    v_divergente,
    'sem_nota',      v_sem_nota,
    'votos',         v_validos,
    'quorum',        v_quorum,
    'snapshot',      v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.declarar_vencedora(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declarar_vencedora(uuid,text,text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
