-- 671_20261004_admin_avalia_e_vota_na_competicao.sql
--
-- A Administração (role = 'admin', o professor) passa a DAR NOTA e a VOTAR na
-- Competição entre Filiais. Decisão do usuário em 2026-10-04, revertendo a
-- regra da 240 ("admin modera, não pesa") e a da 369 ("admin vota só para
-- desempatar"):
--
--   1. Nota do Admin entra na média com PESO 3. A unidade de medida continua
--      sendo o ITEM (375): dentro do item a média passa a ser ponderada,
--      SUM(nota × peso) / SUM(peso). Ex.: conselho 6, 7, 8 e Admin 9 →
--      (6+7+8+9×3)/6 = 8,0. Vale para Tarefas da Matriz e para o eixo
--      Planejamento e Organização da Avaliação de Filial.
--   2. Admin continua vendo as notas de todos antes de a tarefa encerrar
--      (RLS da 345 intocada) — escolha explícita do usuário.
--   3. Admin vira ELEITOR NORMAL na votação final: conta no eleitorado, no
--      quórum e na maioria, sem a condição de empate. Continua sendo o único
--      que declara a vencedora (`declarar_vencedora` não muda).
--   4. Vale já nas competições em curso. Conferido antes de escrever, nas 4
--      turmas: nenhuma nota de admin em `avaliacoes_matriz`, nenhuma nota de
--      admin no eixo, nenhuma competição encerrada — nada já lançado muda de
--      valor. Competição encerrada mostra o snapshot congelado (372/373),
--      então nem uma futura reabertura reescreve resultado publicado sem
--      passar por nova declaração.
--
-- O peso mora em UM lugar: `_peso_nota_matriz(role)`. O placar, a média que a
-- filial lê, as duas views e (no front) `src/lib/pesoNotaMatriz.ts` leem
-- dele — mexeu no peso, mexe nos dois. As cláusulas de vínculo da 609
-- (papel congelado na nota, ninguém pontua a própria unidade) seguem.
--
-- CORPOS copiados do banco nesta sessão (pg_get_functiondef), idênticos nas
-- 4 turmas por MD5. IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ── Peso da nota ────────────────────────────────────────────────────────
-- Papel NULL (nota sem vínculo congelado) é tratado como conselheiro, a mesma
-- leitura do COALESCE da 609.
CREATE OR REPLACE FUNCTION public._peso_nota_matriz(p_role text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN COALESCE(p_role, 'conselheiro') = 'admin' THEN 3::numeric ELSE 1::numeric END;
$function$;

-- As views são security_invoker: quem lê precisa de EXECUTE no helper.
REVOKE ALL ON FUNCTION public._peso_nota_matriz(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._peso_nota_matriz(text) TO authenticated, service_role;

-- ── Escrita de nota: Admin entra ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avaliar_item_matriz(p_competicao_id uuid, p_filial_avaliada text, p_item_tipo text, p_item_id uuid, p_decisao text DEFAULT NULL::text, p_nota numeric DEFAULT NULL::numeric, p_comentario text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- (671) A Administração também avalia — com peso 3 no placar.
  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT COALESCE(v_role = 'admin' OR v_role = 'ceo' OR v_role = 'conselheiro'
                     OR (v_role = 'gerente' AND COALESCE(v_is_cons, false)), false)
  THEN
    RAISE EXCEPTION 'Apenas a Administração, o CEO e os conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.remover_avaliacao_matriz(p_competicao_id uuid, p_item_tipo text, p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  uuid := auth.uid();
  v_role     text;
  v_filial   text;
  v_is_cons  boolean;
  v_tstatus  text;
  v_afetadas int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_is_cons
    FROM public.user_profiles WHERE id = v_user_id;

  -- (671) Mesmo portão de `avaliar_item_matriz`.
  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT COALESCE(v_role = 'admin' OR v_role = 'ceo' OR v_role = 'conselheiro'
                     OR (v_role = 'gerente' AND COALESCE(v_is_cons, false)), false)
  THEN
    RAISE EXCEPTION 'Apenas a Administração, o CEO e os conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competicoes_matriz
     WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  IF p_item_tipo LIKE 'tarefa\_%' THEN
    SELECT t.status INTO v_tstatus
      FROM public.matriz_tarefa_participantes p
      JOIN public.matriz_tarefas t ON t.id = p.tarefa_id
     WHERE p.id = p_item_id AND p.ativo = true AND t.ativo = true;
    IF v_tstatus IS NULL THEN
      RAISE EXCEPTION 'Participante ou tarefa não encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus <> 'aberta' THEN
      RAISE EXCEPTION 'Tarefa não está liberada para notas' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.avaliacoes_matriz
     SET ativo = false, updated_at = now()
   WHERE competicao_id = p_competicao_id
     AND item_tipo     = p_item_tipo
     AND item_id       = p_item_id
     AND avaliador_id  = v_user_id
     AND ativo         = true;

  GET DIAGNOSTICS v_afetadas = ROW_COUNT;
  IF v_afetadas = 0 THEN
    RAISE EXCEPTION 'Você não tem avaliação registrada neste item' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- ── Placar: média ponderada por item ────────────────────────────────────
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
  v_peso_pont     numeric := 0.10;
  v_j             ponto_jornada;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;

  -- (671) Nota de admin no eixo passou a contar, então conta também para
  -- completar a cobertura das 3 filiais.
  SELECT (
    COUNT(DISTINCT a.avaliada_filial) FILTER (
      WHERE a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
    ) = 3
  ) INTO v_incluir_eixos
    FROM public.avaliacoes a
   WHERE a.tipo = 'matriz_filial'
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
    SELECT am.filial_avaliada AS filial, am.item_id::text AS item, am.nota::numeric AS nota,
           -- (671) Admin pesa 3 dentro do item. Papel CONGELADO na nota (609).
           public._peso_nota_matriz(am.avaliador_role) AS peso
      FROM public.avaliacoes_matriz am
      -- LEFT: nota órfã (sem participante) segue contando, como na 353.
      LEFT JOIN public.matriz_tarefa_participantes mtp ON mtp.id = am.item_id
     WHERE am.competicao_id = p_competicao_id
       AND am.ativo = true
       AND am.nota IS NOT NULL
       AND am.item_tipo LIKE 'tarefa\_%'
       -- (609) Ninguém pontua a própria unidade — vínculo congelado na nota.
       AND COALESCE(am.avaliador_filial, 'Matriz') IS DISTINCT FROM am.filial_avaliada
       AND NOT COALESCE(public._funcionario_desligado(mtp.funcionario_id), false)
  ),
  notas_eixos AS (
    -- Item ÚNICO por filial: o eixo subjetivo é um julgamento da unidade.
    SELECT a.avaliada_filial AS filial, 'eixo:' || c.criterio AS item, c.nota::numeric AS nota,
           public._peso_nota_matriz(up.role) AS peso
      FROM public.criterios_avaliacao c
      JOIN public.avaliacoes a     ON a.id  = c.avaliacao_id
      JOIN public.user_profiles up ON up.id = a.avaliador_id
     WHERE v_incluir_eixos
       AND a.tipo = 'matriz_filial'
       AND a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim
       -- (609) `avaliacoes.filial` é o vínculo do avaliador quando avaliou.
       AND COALESCE(a.filial, 'Matriz') IS DISTINCT FROM a.avaliada_filial
       AND c.criterio = 'Planejamento e Organização'
  ),
  todas AS (
    SELECT filial, item, nota, peso FROM notas_tarefas
    UNION ALL
    SELECT filial, item, nota, peso FROM notas_eixos
  ),
  itens AS (
    SELECT filial, item,
           SUM(nota * peso) / NULLIF(SUM(peso), 0) AS media_item,
           COUNT(*)::int AS n_notas
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
  -- (617) Terceiro eixo: parcela de empréstimo paga até o vencimento.
  pt AS (
    SELECT * FROM public._pontualidade_competicao(p_competicao_id)
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
           fr.taxa                                    AS taxa,
           COALESCE(pn.vencidas, 0)                   AS parcelas_vencidas,
           COALESCE(pn.em_dia, 0)                     AS parcelas_em_dia,
           COALESCE(pn.atrasadas, 0)                  AS parcelas_atrasadas,
           pn.taxa                                    AS taxa_pont
      FROM filiais f
      LEFT JOIN julgamento jg ON jg.filial = f.filial
      LEFT JOIN fq         fr ON fr.filial = f.filial
      LEFT JOIN pt         pn ON pn.filial = f.filial
  ),
  pesos AS (
    -- Eixo objetivo sem dado não entra, e o peso dele volta para o conselho:
    -- é a régua que a frequência já seguia.
    SELECT ag.*,
           CASE WHEN ag.taxa      IS NULL THEN 0 ELSE v_peso_freq END AS p_freq,
           CASE WHEN ag.taxa_pont IS NULL THEN 0 ELSE v_peso_pont END AS p_pont
      FROM agregado ag
  ),
  final AS (
    SELECT pe.*,
           CASE
             WHEN pe.n = 0 THEN pe.media_conselho
             ELSE ROUND(
                    pe.media_conselho * (1 - pe.p_freq - pe.p_pont)
                    + COALESCE(pe.taxa, 0)      * 100 * pe.p_freq
                    + COALESCE(pe.taxa_pont, 0) * 100 * pe.p_pont
                  , 2)
           END AS media
      FROM pesos pe
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
             ),
             'pontualidade', jsonb_build_object(
               'taxa',      taxa_pont,
               'vencidas',  parcelas_vencidas,
               'em_dia',    parcelas_em_dia,
               'atrasadas', parcelas_atrasadas,
               'entrou',    (n > 0 AND taxa_pont IS NOT NULL)
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
    'peso_pontualidade',     v_peso_pont,
    -- (671) Peso da nota do Admin dentro do item — a tela mostra de onde veio.
    'peso_nota_admin',       public._peso_nota_matriz('admin'),
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

-- ── Média que a filial lê: mesma régua ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.media_participantes_competicao(p_competicao_id uuid)
 RETURNS TABLE(item_id uuid, filial_avaliada text, media_nota numeric, n_notas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_filial text;
BEGIN
  SELECT up.filial INTO v_filial FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT am.item_id,
         am.filial_avaliada,
         -- (671) Média ponderada: Admin pesa 3 (`_peso_nota_matriz`).
         ROUND(SUM(am.nota * public._peso_nota_matriz(am.avaliador_role))
               / NULLIF(SUM(public._peso_nota_matriz(am.avaliador_role)), 0), 2) AS media_nota,
         COUNT(*) FILTER (WHERE am.nota IS NOT NULL)::int AS n_notas
    FROM avaliacoes_matriz am
    JOIN matriz_tarefa_participantes p ON p.id = am.item_id
    JOIN matriz_tarefas t ON t.id = p.tarefa_id
   WHERE am.competicao_id = p_competicao_id
     AND am.ativo = true
     AND am.nota IS NOT NULL
     AND am.item_tipo LIKE 'tarefa\_%'
     -- (609) Ninguém pontua a própria unidade — vínculo congelado na nota.
     AND COALESCE(am.avaliador_filial, 'Matriz') IS DISTINCT FROM am.filial_avaliada
     AND t.ativo = true
     AND t.status = 'encerrada'          -- só resultado fechado
     AND (v_filial = 'Matriz' OR am.filial_avaliada = v_filial)
   GROUP BY am.item_id, am.filial_avaliada;
END;
$function$;

-- ── Views: mesma régua (security_invoker explícito — o REPLACE derruba) ──
CREATE OR REPLACE VIEW public.avaliacoes_matriz_agregado WITH (security_invoker = true) AS
 SELECT competicao_id,
    filial_avaliada,
    item_tipo,
    item_id,
    (count(*) FILTER (WHERE (nota IS NOT NULL)))::integer AS n_notas,
    round(sum(nota * _peso_nota_matriz(avaliador_role)) FILTER (WHERE (nota IS NOT NULL))
          / NULLIF(sum(_peso_nota_matriz(avaliador_role)) FILTER (WHERE (nota IS NOT NULL)), 0), 2) AS media_nota,
    (count(*) FILTER (WHERE (decisao = 'Aprovado'::text)))::integer AS n_aprovado,
    (count(*) FILTER (WHERE (decisao = 'Reprovado'::text)))::integer AS n_reprovado,
    (count(*))::integer AS n_total_avaliadores,
    max(updated_at) AS ultima_atualizacao
   FROM avaliacoes_matriz am
  WHERE ((ativo = true) AND (COALESCE(avaliador_filial, 'Matriz'::text) IS DISTINCT FROM filial_avaliada))
  GROUP BY competicao_id, filial_avaliada, item_tipo, item_id;

CREATE OR REPLACE VIEW public.avaliacoes_matriz_placar_filial WITH (security_invoker = true) AS
 SELECT competicao_id,
    filial_avaliada,
    round(sum(nota * _peso_nota_matriz(avaliador_role)) FILTER (WHERE (nota IS NOT NULL))
          / NULLIF(sum(_peso_nota_matriz(avaliador_role)) FILTER (WHERE (nota IS NOT NULL)), 0), 2) AS media_nota_geral,
    (count(*) FILTER (WHERE (decisao = 'Aprovado'::text)))::integer AS itens_aprovados,
    (count(*) FILTER (WHERE (decisao = 'Reprovado'::text)))::integer AS itens_reprovados,
        CASE
            WHEN (count(*) FILTER (WHERE (decisao IS NOT NULL)) = 0) THEN NULL::numeric
            ELSE round(((100.0 * (count(*) FILTER (WHERE (decisao = 'Aprovado'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (decisao IS NOT NULL)), 0))::numeric), 2)
        END AS taxa_aprovacao_pct
   FROM avaliacoes_matriz am
  WHERE ((ativo = true) AND (COALESCE(avaliador_filial, 'Matriz'::text) IS DISTINCT FROM filial_avaliada))
  GROUP BY competicao_id, filial_avaliada;

-- ── Eleitorado: Admin conta ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contar_votantes_matriz()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::int
  FROM public.user_profiles
  WHERE filial = 'Matriz'
    AND desligado_em IS NULL
    AND (
      role = 'admin'          -- (671) eleitor normal, não só desempate
      OR role = 'ceo'
      OR role = 'conselheiro'
      OR (role = 'gerente' AND is_conselheiro = true)
    );
$function$;

-- Empate agora é de TODO o eleitorado (Admin incluso). Sem o voto de
-- desempate, ele deixou de destravar a escrita e fica só como leitura.
CREATE OR REPLACE FUNCTION public._competicao_empatada(p_competicao_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*) = public.contar_votantes_matriz()
     AND COUNT(*) FILTER (WHERE voto = 'aceita')
       = COUNT(*) FILTER (WHERE voto = 'rejeita')
     AND COUNT(*) > 0
    FROM public._competicao_votos_validos(p_competicao_id);
$function$;

DROP POLICY IF EXISTS voto_write ON public.competicao_votos;
CREATE POLICY voto_write ON public.competicao_votos FOR INSERT
  WITH CHECK (
    (votante_id = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = (SELECT auth.uid())
         AND up.filial = 'Matriz'
         AND up.desligado_em IS NULL
         -- (671) Admin vota como qualquer eleitor.
         AND (up.role = ANY (ARRAY['admin','ceo','conselheiro'])
              OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro, false)))
    )
  );

DROP POLICY IF EXISTS voto_update ON public.competicao_votos;
CREATE POLICY voto_update ON public.competicao_votos FOR UPDATE
  USING (
    (votante_id = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.competicoes_matriz c
       WHERE c.id = competicao_votos.competicao_id
         AND c.status = ANY (ARRAY['aguardando_encerramento','em_andamento'])
    )
  )
  WITH CHECK (
    (votante_id = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = (SELECT auth.uid())
         AND up.filial = 'Matriz'
         AND up.desligado_em IS NULL
         AND (up.role = ANY (ARRAY['admin','ceo','conselheiro'])
              OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro, false)))
    )
  );

-- ── Progresso e cobertura: Admin é avaliador ────────────────────────────
CREATE OR REPLACE FUNCTION public.progresso_avaliacao_matriz(p_competicao_id uuid)
 RETURNS TABLE(avaliador_id uuid, nome text, role text, notas_dadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT up.role INTO v_role
    FROM user_profiles up
   WHERE up.id = auth.uid() AND up.filial = 'Matriz'
     AND (up.role IN ('admin','ceo','conselheiro') OR (up.role = 'gerente' AND up.is_conselheiro = true));
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Apenas a Matriz vê o progresso da avaliação' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT up.id,
         up.nome,
         up.role,
         (SELECT COUNT(*)::int
            FROM avaliacoes_matriz am
            -- INNER de propósito: nota sem participante não tem par no
            -- denominador, então não pode entrar no numerador.
            JOIN matriz_tarefa_participantes p ON p.id = am.item_id
           WHERE am.avaliador_id  = up.id
             AND am.competicao_id = p_competicao_id
             AND am.ativo         = true
             AND am.nota IS NOT NULL
             AND am.item_tipo LIKE 'tarefa\_%'
             AND p.ativo = true
             -- COALESCE: funcionario_id NULL devolveria NULL e a nota
             -- sumiria da contagem em vez de contar.
             AND NOT COALESCE(public._funcionario_desligado(p.funcionario_id), false)
         )
    FROM user_profiles up
   WHERE up.filial = 'Matriz'
     -- (671) Admin entra na lista de quem avalia; desligado sai, como no
     -- eleitorado (`contar_votantes_matriz`).
     AND up.desligado_em IS NULL
     AND (up.role IN ('admin','ceo','conselheiro') OR (up.role = 'gerente' AND up.is_conselheiro = true))
   ORDER BY up.nome;
END;
$function$;

CREATE OR REPLACE FUNCTION public.participantes_sem_nota_competicao(p_competicao_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     -- (671) Admin avalia e está no eleitorado: a nota dele conta aqui.
     AND (
       SELECT COUNT(*) FROM avaliacoes_matriz am
        WHERE am.item_id = p.id AND am.ativo = true AND am.nota IS NOT NULL
     ) < public.contar_votantes_matriz();

  RETURN COALESCE(v_n, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.lembrar_avaliacoes_pendentes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje      date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  v_comp      record;
  v_pendentes int;
  v_dias      int;
  v_avisos    int := 0;
BEGIN
  FOR v_comp IN
    SELECT id, nome, data_fim FROM competicoes_matriz
     WHERE ativo = true AND status = 'em_andamento'
       AND data_fim - v_hoje BETWEEN 0 AND 3
  LOOP
    -- Participante de tarefa aberta que ainda não recebeu nota de
    -- TODOS os eleitores conta como pendência.
    -- (671) Eleitorado = `contar_votantes_matriz` (Admin incluso, desligado
    -- fora) — antes era uma cópia da lista, sem o Admin.
    SELECT COUNT(*) INTO v_pendentes
      FROM matriz_tarefa_participantes p
      JOIN matriz_tarefas t ON t.id = p.tarefa_id
     WHERE t.competicao_id = v_comp.id
       AND t.ativo = true AND p.ativo = true
       AND t.status = 'aberta'
       AND (
         SELECT COUNT(*) FROM avaliacoes_matriz am
          WHERE am.item_id = p.id AND am.ativo = true AND am.nota IS NOT NULL
       ) < public.contar_votantes_matriz();

    CONTINUE WHEN v_pendentes = 0;

    -- 1 aviso por competição por dia.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM notificacoes
       WHERE ref_id = v_comp.id AND motivo = 'lembrete_avaliacao'
         AND (created_at AT TIME ZONE 'America/Rio_Branco')::date = v_hoje
    );

    v_dias := v_comp.data_fim - v_hoje;
    INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, ref_id, motivo, filial)
    VALUES (
      'all', 'info',
      'Avaliações pendentes',
      format('%s participante(s) ainda sem nota de todo o conselho. "%s" encerra %s.',
             v_pendentes, v_comp.nome,
             CASE WHEN v_dias = 0 THEN 'hoje'
                  WHEN v_dias = 1 THEN 'amanhã'
                  ELSE 'em ' || v_dias || ' dias' END),
      'matriz-avaliacoes', 'Alta', v_comp.id, 'lembrete_avaliacao', 'Matriz'
    );
    v_avisos := v_avisos + 1;
  END LOOP;

  RETURN jsonb_build_object('avisos', v_avisos);
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
