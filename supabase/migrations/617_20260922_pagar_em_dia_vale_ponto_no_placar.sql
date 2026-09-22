-- 617_20260922_pagar_em_dia_vale_ponto_no_placar.sql
--
-- Pagar a parcela em dia passa a valer no placar da competição, como terceiro
-- eixo objetivo, ao lado da frequência do ponto.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE NO PLACAR E NÃO NO CAIXA
-- ────────────────────────────────────────────────────────────────────────────
-- A ideia original era bônus em dinheiro por pagar em dia. Em dinheiro, o
-- prêmio seria proporcional à dívida: a MaxLook, que pegou R$ 5 milhões,
-- ganharia 3,3× mais que a SuperMax por fazer exatamente a mesma coisa —
-- cumprir a obrigação. E pagar o que se deve não é mérito extraordinário, é o
-- mínimo; o castigo por não pagar já existe (multa de 2% + 0,0333% ao dia,
-- `financeiro_config`).
--
-- No placar, a régua é a mesma para as três, independente do tamanho da
-- dívida: é uma TAXA (parcelas pagas em dia ÷ parcelas vencidas), não um valor.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A RÉGUA
-- ────────────────────────────────────────────────────────────────────────────
-- · Denominador: parcelas cujo vencimento caiu DENTRO do período da competição
--   e JÁ PASSOU. Parcela futura não é mérito nem demérito de ninguém, e é o
--   mesmo princípio do `LEAST(v_fim, hoje)` da frequência (610).
-- · Em dia = título quitado com `pago_em <= vencimento`. Não pagar conta como
--   atraso — senão bastaria não pagar para não ter atraso.
-- · Parcela antecipada (616) entra como em dia, naturalmente: quem paga antes
--   paga antes do vencimento.
-- · Unidade sem parcela vencida no período fica FORA do eixo (taxa NULL) e o
--   peso dela volta para o conselho. Quem não tem dívida não ganha nem perde
--   por isso — a competição não premia quem não pegou empréstimo.
--
-- Pesos: conselho 70%, frequência 20%, pontualidade 10%. Quando um eixo
-- objetivo não entra, o peso dele volta para o conselho, exatamente como a
-- frequência já fazia desde a 349.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ISTO MUDA O PLACAR — E PRECISA SER ANUNCIADO
-- ────────────────────────────────────────────────────────────────────────────
-- Mudar a régua no meio de uma competição com prêmio é coisa que se faz com a
-- turma sabendo. A 002 começou hoje (22/09), sem nenhuma nota lançada e sem
-- nenhuma parcela vencida — é a única janela em que esta mudança não reescreve
-- resultado de ninguém.
--
-- NOTA SOBRE O CORPO: `_calcular_placar_competicao_raw` copiada do banco nesta
-- sessão (idêntica nos 4). Muda o cálculo da média, entra o CTE do novo
-- `_pontualidade_competicao` e o terceiro eixo no JSON.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public._pontualidade_competicao(p_competicao_id uuid)
 RETURNS TABLE(filial text, vencidas integer, em_dia integer, atrasadas integer, taxa numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inicio date;
  v_fim    date;
  v_hoje   date := public.acre_today();
BEGIN
  SELECT c.data_inicio, c.data_fim INTO v_inicio, v_fim
    FROM competicoes_matriz c WHERE c.id = p_competicao_id AND c.ativo = true;
  IF v_inicio IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT * FROM (VALUES ('SuperMax',1),('MaxLook',2),('TechMax',3)) AS v(f, ord)
  ),
  titulos AS (
    SELECT e.filial AS f,
           (cp.status = 'Pago' AND cp.pago_em IS NOT NULL AND cp.pago_em <= cp.vencimento) AS em_dia
      FROM public.parcelas_emprestimo pe
      JOIN public.contas_pagar        cp ON cp.id = pe.contas_pagar_id
      JOIN public.emprestimos_filial  e  ON e.id  = pe.emprestimo_id
     WHERE e.filial IN ('SuperMax','MaxLook','TechMax')
       AND e.arquivado_em IS NULL
       AND COALESCE(cp.ativo, true)
       -- Venceu dentro do período E já passou.
       AND cp.vencimento BETWEEN v_inicio AND LEAST(v_fim, v_hoje)
  ),
  agg AS (
    SELECT t.f,
           COUNT(*)::int                         AS vencidas,
           COUNT(*) FILTER (WHERE t.em_dia)::int AS em_dia
      FROM titulos t
     GROUP BY t.f
  )
  SELECT b.f,
         COALESCE(a.vencidas, 0),
         COALESCE(a.em_dia, 0),
         COALESCE(a.vencidas, 0) - COALESCE(a.em_dia, 0),
         CASE WHEN COALESCE(a.vencidas, 0) = 0 THEN NULL
              ELSE ROUND(a.em_dia::numeric / a.vencidas, 4) END
    FROM base b
    LEFT JOIN agg a ON a.f = b.f
   ORDER BY b.ord;
END;
$function$;

REVOKE ALL ON FUNCTION public._pontualidade_competicao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._pontualidade_competicao(uuid) TO authenticated;

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
