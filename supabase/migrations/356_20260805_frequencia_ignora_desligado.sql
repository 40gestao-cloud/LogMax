-- 356 — Frequência: quem foi desligado não conta na filial
--
-- O desligamento aqui não é saída do curso: o aluno sai da filial e vai para
-- recuperação, mas continua batendo ponto. Como `ponto_eletronico.filial`
-- guarda a filial de quando o registro foi feito — e a demissão (migr. 307)
-- de propósito não mexe em `funcionarios.filial`, para o RH saber de onde a
-- pessoa saiu —, o ponto dele continuava caindo na conta da filial que já não
-- o tem. Nos 4 bancos são 10 registros por filial nessa situação.
--
-- Isso é pior do que parece: o desligamento costuma vir *de* frequência ruim,
-- então a filial ficava carregando exatamente as faltas que motivaram a
-- decisão, com peso de 20% no placar (migr. 349).
--
-- Duas funções repetem a agregação de frequência e as duas precisavam do
-- filtro — o card (`frequencia_filiais_competicao`) e o placar
-- (`calcular_placar_competicao`). Corrigir só uma faria o card e a nota
-- discordarem, que é pior do que os dois errados juntos.
--
-- Régua: `funcionarios.status = 'Desligado'` exclui **todo** o ponto daquela
-- pessoa no período, não só o posterior ao desligamento. É o que o desligamento
-- quer dizer aqui — a filial não é medida por quem ela não tem. A readmissão
-- (`readmitir_funcionario`) devolve `status = 'Ativo'` e o histórico volta
-- inteiro para a conta; nada é apagado em momento algum.
--
-- `funcionarios_ativos` também passa a ignorá-los: `demitir_funcionario` mexe
-- em `status`, não em `ativo`, então o desligado ainda contava como cabeça no
-- denominador informativo do card.

BEGIN;

-- ── 0. Uma régua só para "está desligado" ────────────────────────────────────
--
-- O desligamento deixa marca em dois lugares: `funcionarios.status` (o RH) e
-- `user_profiles.desligado_em` (o acesso). A migr. 355, que tirou o desligado
-- do placar das Avaliações, olha o segundo; a frequência olharia o primeiro.
-- Dois marcadores é uma discordância esperando acontecer — e ela já existe nos
-- dados: na turma `logmax-aprendiz` há cadastro duplicado apontando para o
-- mesmo perfil, com um dos registros ainda em 'Ativo'.
--
-- Este helper responde a pergunta uma vez só, e qualquer um dos dois marcadores
-- basta. É de propósito assimétrico: na dúvida, fora da conta da filial. O
-- prejuízo de excluir alguém que voltou é um ponto a menos; o de incluir quem
-- saiu é a distorção que estamos consertando.

CREATE OR REPLACE FUNCTION public._funcionario_desligado(p_funcionario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(bool_or(
           COALESCE(f.status, 'Ativo') = 'Desligado'
           OR up.desligado_em IS NOT NULL
         ), false)
    FROM public.funcionarios f
    LEFT JOIN public.user_profiles up ON up.id = f.user_profile_id
   WHERE f.id = p_funcionario_id;
$$;

COMMENT ON FUNCTION public._funcionario_desligado(uuid) IS
  'Régua única de "está desligado": basta funcionarios.status ou user_profiles.desligado_em. Registro órfão (id inexistente) devolve false — continua contando, como sempre contou.';

-- Função nova nasce com EXECUTE para PUBLIC; revogar `anon` nominalmente é
-- obrigatório aqui (ver migr. 347).
REVOKE ALL ON FUNCTION public._funcionario_desligado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._funcionario_desligado(uuid) TO authenticated;

-- ── 1. Card de frequência ────────────────────────────────────────────────────

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
      -- Sem JOIN: o helper já resolve o caso do `funcionario_id` nulo ou órfão
      -- (devolve false, o registro continua contando como sempre contou).
     WHERE pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_inicio AND v_fim
       AND NOT public._funcionario_desligado(pe.funcionario_id)
  ),
  func AS (
    SELECT fn.filial AS f, COUNT(*)::int AS n
      FROM funcionarios fn
     WHERE fn.filial IN ('SuperMax','MaxLook','TechMax')
       AND fn.ativo = true
       AND NOT public._funcionario_desligado(fn.id)
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

REVOKE ALL ON FUNCTION public.frequencia_filiais_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.frequencia_filiais_competicao(uuid) TO authenticated;

-- ── 2. Placar da competição ──────────────────────────────────────────────────

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
     WHERE am.competicao_id = p_competicao_id
       AND am.ativo = true
       AND am.nota IS NOT NULL
       AND am.item_tipo LIKE 'tarefa\_%'
       AND up.role <> 'admin'
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
      -- O mesmo recorte do card, pelo mesmo helper: se divergir, a filial vê
      -- uma taxa no card e outra dentro da nota.
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
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
