-- =================================================================
-- 376 — O calendário da turma vira configuração, e faltar passa a doer.
--
-- Último item aberto da auditoria de lisura. A frequência vale 20% do
-- placar, mas o denominador era "o que foi lançado": quem não lançava
-- ponto simplesmente não aparecia na conta. Não faltar e não registrar
-- davam o mesmo número — e o segundo é mais fácil.
--
-- Por que não bastava dividir por "dias × pessoas": as turmas não têm
-- aula todo dia. Hoje, ERP, contabilidade e aprendiz têm 2 dias por
-- semana; adm tem 1. Contar sábado, domingo e os dias sem aula como
-- falta zeraria as três filiais de todas as turmas. E deixar isso no
-- código significaria mexer em código a cada turma nova — a próxima
-- pode ter 5 dias.
--
-- Então o calendário é DADO, configurado no app:
--   • `ponto_jornada.dias_semana` — os dias da semana com aula, por
--     projeto. Cada turma tem o seu, e ninguém precisa saber disso na
--     hora de calcular.
--   • `ponto_calendario_excecoes` — feriado, recesso e aula cancelada
--     saem ('sem_aula'); reposição entra ('aula_extra'). Sem isso, o
--     primeiro feriado marcaria a turma inteira como ausente.
--
-- Com o calendário configurado, a régua vira:
--   universo   = cada pessoa ativa × cada dia letivo do período
--   presença   = 1 · atraso = 0,5 · falta lançada = 0
--   AUSÊNCIA SEM LANÇAMENTO = 0  ← a mudança
--   justificado sai do denominador (afastamento deferido pelo RH)
--   taxa       = créditos / (universo − justificados)
--
-- Duas decisões que valem estar escritas:
--   1. Quem foi admitido no meio do período só responde pelos dias
--      letivos a partir da admissão. Aluno que entrou na semana passada
--      não deve falta da semana retrasada.
--   2. Lançamento em dia NÃO letivo é ignorado — nem soma nem divide.
--      Se contasse, bastaria lançar ponto no domingo pra subir a taxa.
--
-- Sem `dias_semana` configurado, tudo continua exatamente como estava
-- (denominador = o que foi lançado). A turma que não configurar não é
-- punida por uma régua que ninguém confirmou — mesma lógica que a 350
-- usou para o atraso.
--
-- Aproveita e mata uma duplicação que já tinha custado caro: o placar e
-- o card de frequência calculavam a MESMA coisa em dois lugares. Agora
-- os dois chamam `_frequencia_competicao`.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Calendário da turma ────────────────────────────────────────
-- 0 = domingo … 6 = sábado (mesma numeração de EXTRACT(DOW)).
ALTER TABLE public.ponto_jornada
  ADD COLUMN IF NOT EXISTS dias_semana smallint[];

COMMENT ON COLUMN public.ponto_jornada.dias_semana IS
  'Dias da semana com aula (0=dom..6=sab). NULL ou vazio = calendario nao configurado: a frequencia volta a medir so o que foi lancado.';

CREATE TABLE IF NOT EXISTS public.ponto_calendario_excecoes (
  data       date PRIMARY KEY,
  tipo       text NOT NULL CHECK (tipo IN ('sem_aula','aula_extra')),
  motivo     text,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ponto_calendario_excecoes IS
  'Feriado/recesso/aula cancelada (sem_aula) e reposicao (aula_extra). Sem isto o feriado vira falta coletiva.';

ALTER TABLE public.ponto_calendario_excecoes ENABLE ROW LEVEL SECURITY;

-- Leitura aberta a quem loga: o aluno tem de poder conferir por que o
-- dia dele não contou. Escrita só por RPC (admin/CEO da Matriz).
DROP POLICY IF EXISTS excecao_read ON public.ponto_calendario_excecoes;
CREATE POLICY excecao_read ON public.ponto_calendario_excecoes
  FOR SELECT TO authenticated USING (true);

-- Realtime: a tela de configuração é compartilhada entre admin e CEO.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'ponto_calendario_excecoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ponto_calendario_excecoes;
  END IF;
END $$;

-- ── 2. Quais dias do período têm aula ─────────────────────────────
CREATE OR REPLACE FUNCTION public.dias_letivos_periodo(p_inicio date, p_fim date)
RETURNS SETOF date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT d::date AS dia
    FROM generate_series(p_inicio, p_fim, interval '1 day') d
   WHERE (
           -- Dia da semana previsto e não cancelado.
           EXTRACT(DOW FROM d)::smallint = ANY (
             COALESCE((SELECT j.dias_semana FROM public.ponto_jornada j WHERE j.id = true), '{}'::smallint[])
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.ponto_calendario_excecoes e
              WHERE e.data = d::date AND e.tipo = 'sem_aula'
           )
         )
         -- Reposição entra mesmo caindo fora dos dias da semana.
         OR EXISTS (
           SELECT 1 FROM public.ponto_calendario_excecoes e
            WHERE e.data = d::date AND e.tipo = 'aula_extra'
         )
   ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.dias_letivos_periodo(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dias_letivos_periodo(date,date) TO authenticated;

-- ── 3. Fonte única da frequência da competição ────────────────────
CREATE OR REPLACE FUNCTION public._frequencia_competicao(p_competicao_id uuid)
RETURNS TABLE (
  filial              text,
  registros           int,   -- pessoa-dia COM lançamento (justificado incluído)
  presencas           int,
  faltas              int,   -- 'Falta' lançada
  ausencias           int,   -- dia letivo sem lançamento nenhum
  justificados        int,
  atrasos             int,
  dias_letivos        int,
  funcionarios_ativos int,
  esperado            int,   -- tamanho do universo pessoa-dia
  taxa                numeric,
  tem_calendario      boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_inicio date;
  v_fim    date;
  v_j      ponto_jornada;
  v_target time;
  v_cal    boolean;
BEGIN
  SELECT c.data_inicio, c.data_fim INTO v_inicio, v_fim
    FROM competicoes_matriz c WHERE c.id = p_competicao_id AND c.ativo = true;
  IF v_inicio IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;
  IF COALESCE(v_j.configurado, false) THEN
    v_target := (v_j.entrada || ':00')::time;
  END IF;

  v_cal := COALESCE(array_length(v_j.dias_semana, 1), 0) > 0;

  RETURN QUERY
  WITH base AS (
    SELECT * FROM (VALUES ('SuperMax',1),('MaxLook',2),('TechMax',3)) AS v(f, ord)
  ),
  letivos AS (
    SELECT dia FROM public.dias_letivos_periodo(v_inicio, v_fim) dia
     WHERE v_cal
  ),
  ativos AS (
    SELECT fn.id, fn.filial AS f, fn.data_admissao
      FROM funcionarios fn
     WHERE fn.filial IN ('SuperMax','MaxLook','TechMax')
       AND fn.ativo = true
       AND NOT public._funcionario_desligado(fn.id)
  ),
  -- Universo de pessoa-dia. Com calendário: cada ativo × cada dia letivo
  -- a partir da admissão dele. Sem calendário: só o que foi lançado, que
  -- é o comportamento anterior à 376.
  -- As duas primeiras pernas são UNION (dedupe); a terceira é UNION ALL e
  -- só tem linha quando NÃO há calendário — aí as outras duas estão vazias.
  -- Operadores de conjunto avaliam da esquerda pra direita: (A ∪ B) ⊎ C.
  universo AS (
    SELECT a.f, a.id AS func_id, l.dia
      FROM ativos a
      CROSS JOIN letivos l
     WHERE a.data_admissao IS NULL OR l.dia >= a.data_admissao
    UNION
    -- Lançamento que EXISTE sempre conta, mesmo em dia anterior à admissão
    -- registrada: se há ponto, a pessoa estava lá. Sem esta perna, uma
    -- `data_admissao` preenchida depois (comum aqui — é a data em que a
    -- ficha foi criada, não em que a pessoa chegou) apagaria presença real.
    SELECT a.f, a.id, pe.data
      FROM ponto_eletronico pe
      JOIN ativos  a ON a.id  = pe.funcionario_id
      JOIN letivos l ON l.dia = pe.data
    UNION ALL
    SELECT pe.filial, pe.funcionario_id, pe.data
      FROM ponto_eletronico pe
     WHERE NOT v_cal
       AND pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_inicio AND v_fim
       AND NOT public._funcionario_desligado(pe.funcionario_id)
  ),
  -- Lançamento de cada pessoa-dia. Sem lançamento em dia letivo, crédito
  -- 0: é a ausência que passou a doer.
  marcado AS (
    SELECT u.f,
           u.dia,
           pe.status,
           CASE
             WHEN pe.data IS NULL THEN 0::numeric
             ELSE public._freq_credito_dia(pe.status, pe.entrada, v_target, v_j.tolerancia_min)
           END AS credito,
           (pe.data IS NOT NULL) AS lancado
      FROM universo u
      LEFT JOIN ponto_eletronico pe
             ON pe.funcionario_id = u.func_id
            AND pe.data           = u.dia
  ),
  agg AS (
    SELECT m.f,
           COUNT(*) FILTER (WHERE m.lancado)::int                     AS registros,
           COUNT(*) FILTER (WHERE m.credito > 0)::int                 AS presencas,
           COUNT(*) FILTER (WHERE m.status = 'Falta')::int            AS faltas,
           COUNT(*) FILTER (WHERE NOT m.lancado)::int                 AS ausencias,
           COUNT(*) FILTER (WHERE m.credito IS NULL)::int             AS justificados,
           COUNT(*) FILTER (WHERE m.credito = 0.5)::int               AS atrasos,
           COUNT(*) FILTER (WHERE m.credito IS NOT NULL)::int         AS denominador,
           COUNT(*)::int                                              AS esperado,
           SUM(m.credito)                                             AS creditos
      FROM marcado m
     GROUP BY m.f
  ),
  func AS (
    SELECT a.f, COUNT(*)::int AS n FROM ativos a GROUP BY a.f
  )
  SELECT b.f,
         COALESCE(ag.registros, 0),
         COALESCE(ag.presencas, 0),
         COALESCE(ag.faltas, 0),
         COALESCE(ag.ausencias, 0),
         COALESCE(ag.justificados, 0),
         COALESCE(ag.atrasos, 0),
         (SELECT COUNT(*)::int FROM letivos),
         COALESCE(fu.n, 0),
         COALESCE(ag.esperado, 0),
         CASE WHEN COALESCE(ag.denominador, 0) = 0 THEN NULL
              ELSE ROUND(ag.creditos / ag.denominador, 4) END,
         v_cal
    FROM base b
    LEFT JOIN agg  ag ON ag.f = b.f
    LEFT JOIN func fu ON fu.f = b.f
   ORDER BY b.ord;
END;
$$;

REVOKE ALL ON FUNCTION public._frequencia_competicao(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. Card de frequência: mesma fonte do placar ──────────────────
-- DROP antes: RETURNS TABLE ganhou colunas, e trocar coluna OUT num
-- REPLACE devolve 42P13 e derruba a transação inteira.
DROP FUNCTION IF EXISTS public.frequencia_filiais_competicao(uuid);

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
  atraso_conta        boolean,
  ausencias           int,
  esperado            int,
  tem_calendario      boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_filial_user text;
  v_j           ponto_jornada;
BEGIN
  SELECT up.filial INTO v_filial_user FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;

  RETURN QUERY
  SELECT fq.filial, fq.registros, fq.presencas, fq.faltas, fq.justificados,
         fq.atrasos, fq.dias_letivos, fq.funcionarios_ativos, fq.taxa,
         v_j.entrada, v_j.tolerancia_min, COALESCE(v_j.configurado, false),
         fq.ausencias, fq.esperado, fq.tem_calendario
    FROM public._frequencia_competicao(p_competicao_id) fq
   WHERE v_filial_user = 'Matriz' OR fq.filial = v_filial_user;
END;
$$;

REVOKE ALL ON FUNCTION public.frequencia_filiais_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.frequencia_filiais_competicao(uuid) TO authenticated;

-- ── 5. Placar consome o mesmo helper ──────────────────────────────
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
     AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim;

  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial
  ),
  notas_tarefas AS (
    -- `item` é o participante: todas as notas que ele recebeu viram uma
    -- média só antes de a filial ser medida (375).
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
    'atraso_conta',          COALESCE(v_j.configurado, false),
    'jornada_entrada',       v_j.entrada,
    'calendario_turma',      COALESCE(array_length(v_j.dias_semana, 1), 0) > 0,
    'dias_semana',           to_jsonb(COALESCE(v_j.dias_semana, '{}'::smallint[])),
    'por_filial',            COALESCE(v_result, '{}'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._calcular_placar_competicao_raw(uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. Configuração pelo app ──────────────────────────────────────
-- Ganha `p_dias_semana`: assinatura muda, então DROP antes do CREATE.
DROP FUNCTION IF EXISTS public.definir_ponto_jornada(text, text, text, integer);

CREATE OR REPLACE FUNCTION public.definir_ponto_jornada(
  p_entrada        text,
  p_retorno        text     DEFAULT NULL,
  p_saida          text     DEFAULT NULL,
  p_tolerancia_min integer  DEFAULT NULL,
  p_dias_semana    smallint[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_d smallint;
BEGIN
  PERFORM _assert_matriz_admin();

  IF p_entrada !~ '^[0-9]{1,2}:[0-9]{2}$' THEN
    RAISE EXCEPTION 'Horário de entrada inválido: % (use HH:MM)', p_entrada USING ERRCODE = 'P0001';
  END IF;

  IF p_dias_semana IS NOT NULL THEN
    FOREACH v_d IN ARRAY p_dias_semana LOOP
      IF v_d < 0 OR v_d > 6 THEN
        RAISE EXCEPTION 'Dia da semana inválido: % (0=domingo … 6=sábado)', v_d USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  UPDATE ponto_jornada
     SET entrada        = p_entrada,
         retorno        = COALESCE(NULLIF(p_retorno,''), retorno),
         saida          = COALESCE(NULLIF(p_saida,''),   saida),
         tolerancia_min = COALESCE(p_tolerancia_min,     tolerancia_min),
         -- Array vazio é "desconfigurar de propósito"; NULL é "não mexi".
         dias_semana    = CASE
                            WHEN p_dias_semana IS NULL THEN dias_semana
                            WHEN COALESCE(array_length(p_dias_semana,1),0) = 0 THEN NULL
                            ELSE (SELECT array_agg(DISTINCT d ORDER BY d)
                                    FROM unnest(p_dias_semana) d)
                          END,
         configurado    = true,
         updated_at     = now(),
         updated_por    = auth.uid()
   WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.definir_ponto_jornada(text,text,text,integer,smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_ponto_jornada(text,text,text,integer,smallint[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.definir_excecao_calendario(
  p_data   date,
  p_tipo   text,
  p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM _assert_matriz_admin();

  IF p_tipo NOT IN ('sem_aula','aula_extra') THEN
    RAISE EXCEPTION 'Tipo inválido: % (use sem_aula ou aula_extra)', p_tipo USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO ponto_calendario_excecoes (data, tipo, motivo, criado_por)
  VALUES (p_data, p_tipo, NULLIF(TRIM(COALESCE(p_motivo,'')),''), auth.uid())
  ON CONFLICT (data) DO UPDATE
    SET tipo       = EXCLUDED.tipo,
        motivo     = EXCLUDED.motivo,
        criado_por = EXCLUDED.criado_por;
END;
$$;

REVOKE ALL ON FUNCTION public.definir_excecao_calendario(date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_excecao_calendario(date,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remover_excecao_calendario(p_data date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM _assert_matriz_admin();
  DELETE FROM ponto_calendario_excecoes WHERE data = p_data;
END;
$$;

REVOKE ALL ON FUNCTION public.remover_excecao_calendario(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_excecao_calendario(date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
