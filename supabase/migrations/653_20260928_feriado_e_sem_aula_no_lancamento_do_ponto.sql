-- 653_20260928_feriado_e_sem_aula_no_lancamento_do_ponto.sql
--
-- Pedido: no Registro de Ponto, marcar o dia como Feriado ou Sem Aula para
-- que ele não apareça como "sem registro" nem mexa na frequência e no placar.
--
-- O calendário de exceções já existia (migr. 376, `ponto_calendario_excecoes`),
-- mas escondido no modal de configuração e com dois furos:
--
--   1. Só havia 'sem_aula'. Feriado entra como tipo próprio — o efeito é o
--      mesmo (o dia sai dos letivos), a diferença é o que a tela mostra.
--   2. A exceção só valia com os dias da semana configurados. Sem calendário
--      (`dias_semana` vazio) a frequência conta o que foi lançado, e um dia
--      de feriado lançado por engano continuava contando. Agora o dia de folga
--      sai da conta nos dois modos: `_frequencia_competicao` (placar) e
--      `minha_frequencia` (Meu Crachá).
--
--   3. Dia marcado TRAVA o lançamento (pedido do usuário). A trava é gatilho
--      em `ponto_eletronico`, não um IF em `registrar_ponto_manual`, porque o
--      ponto entra por várias portas: lançamento manual, crachá, totem e o
--      aceite da justificativa (650). Exceção: linha de afastamento —
--      `aplicar_afastamento_no_ponto` escreve período corrido, que pode
--      atravessar um feriado, e travar quebraria o afastamento (e a reversão
--      dele, que devolve a linha ao estado anterior).
--   4. Marcar um dia que já tem lançamento é recusado: o dia marcado nasce
--      vazio, senão a falta lançada ali continuaria descontando na folha. A
--      tela oferece excluir os registros antes (só o professor exclui, 635).
--
-- Corpos de `_frequencia_competicao` e `minha_frequencia` copiados do banco
-- (md5 iguais nas 4 turmas antes desta migração); a mudança é só a perna de
-- folga. IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ── Tipo 'feriado' ─────────────────────────────────────────────────────────
ALTER TABLE public.ponto_calendario_excecoes
  DROP CONSTRAINT IF EXISTS ponto_calendario_excecoes_tipo_check;
ALTER TABLE public.ponto_calendario_excecoes
  ADD CONSTRAINT ponto_calendario_excecoes_tipo_check
  CHECK (tipo = ANY (ARRAY['sem_aula'::text, 'feriado'::text, 'aula_extra'::text]));

-- ── Dia de folga: uma régua só ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._dia_de_folga(p_data date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ponto_calendario_excecoes e
     WHERE e.data = p_data AND e.tipo IN ('sem_aula', 'feriado')
  );
$function$;

REVOKE ALL ON FUNCTION public._dia_de_folga(date) FROM public;
REVOKE ALL ON FUNCTION public._dia_de_folga(date) FROM anon;
GRANT EXECUTE ON FUNCTION public._dia_de_folga(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public._dia_de_folga(date) TO service_role;

-- ── Porta de gravação aceita o tipo novo ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.definir_excecao_calendario(p_data date, p_tipo text, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lancados int;
BEGIN
  PERFORM _assert_matriz_admin();

  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Escolha a data.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo NOT IN ('sem_aula','feriado','aula_extra') THEN
    RAISE EXCEPTION 'Tipo inválido: % (use feriado, sem_aula ou aula_extra)', p_tipo USING ERRCODE = 'P0001';
  END IF;

  -- Dia de folga nasce vazio: lançamento que já está lá (fora afastamento)
  -- continuaria valendo na folha.
  IF p_tipo IN ('sem_aula','feriado') THEN
    SELECT COUNT(*) INTO v_lancados
      FROM ponto_eletronico
     WHERE data = p_data AND afastamento_id IS NULL;
    IF v_lancados > 0 THEN
      RAISE EXCEPTION '% já tem % registro(s) de ponto. Exclua os registros do dia antes de marcá-lo como %.',
        to_char(p_data, 'DD/MM/YYYY'), v_lancados,
        CASE p_tipo WHEN 'feriado' THEN 'feriado' ELSE 'sem aula' END
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO ponto_calendario_excecoes (data, tipo, motivo, criado_por)
  VALUES (p_data, p_tipo, NULLIF(TRIM(COALESCE(p_motivo,'')),''), auth.uid())
  ON CONFLICT (data) DO UPDATE
    SET tipo       = EXCLUDED.tipo,
        motivo     = EXCLUDED.motivo,
        criado_por = EXCLUDED.criado_por;
END;
$function$;

-- ── Trava: dia de folga não recebe ponto ───────────────────────────────────
-- Nome começa com "trg_ponto_d…" para rodar antes de `trg_ponto_filial`
-- (gatilhos BEFORE disparam em ordem alfabética): recusa cedo.
CREATE OR REPLACE FUNCTION public.fn_ponto_recusa_dia_de_folga()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo   text;
  v_motivo text;
BEGIN
  -- Afastamento escreve período corrido e pode atravessar o feriado; a
  -- reversão dele (UPDATE de linha que era de afastamento) também passa.
  IF NEW.afastamento_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.afastamento_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.tipo, e.motivo INTO v_tipo, v_motivo
    FROM public.ponto_calendario_excecoes e
   WHERE e.data = NEW.data AND e.tipo IN ('sem_aula', 'feriado');
  IF FOUND THEN
    RAISE EXCEPTION '% está marcado como % no calendário da turma%. Não se lança ponto nesse dia — para lançar, desmarque o dia no Registro de Ponto.',
      to_char(NEW.data, 'DD/MM/YYYY'),
      CASE v_tipo WHEN 'feriado' THEN 'feriado' ELSE 'sem aula' END,
      COALESCE(' (' || v_motivo || ')', '')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ponto_dia_de_folga ON public.ponto_eletronico;
CREATE TRIGGER trg_ponto_dia_de_folga
  BEFORE INSERT OR UPDATE OF data, status, entrada ON public.ponto_eletronico
  FOR EACH ROW EXECUTE FUNCTION public.fn_ponto_recusa_dia_de_folga();

-- ── Dias letivos: feriado tira o dia como sem_aula ─────────────────────────
CREATE OR REPLACE FUNCTION public.dias_letivos_periodo(p_inicio date, p_fim date)
 RETURNS SETOF date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d::date AS dia
    FROM generate_series(p_inicio, p_fim, interval '1 day') d
   WHERE (
           -- Dia da semana previsto e não cancelado (sem aula ou feriado).
           EXTRACT(DOW FROM d)::smallint = ANY (
             COALESCE((SELECT j.dias_semana FROM public.ponto_jornada j WHERE j.id = true), '{}'::smallint[])
           )
           AND NOT public._dia_de_folga(d::date)
         )
         -- Reposição entra mesmo caindo fora dos dias da semana.
         OR EXISTS (
           SELECT 1 FROM public.ponto_calendario_excecoes e
            WHERE e.data = d::date AND e.tipo = 'aula_extra'
         )
   ORDER BY 1;
$function$;

-- ── Placar: sem calendário, lançamento em dia de folga não conta ───────────
CREATE OR REPLACE FUNCTION public._frequencia_competicao(p_competicao_id uuid)
 RETURNS TABLE(filial text, registros integer, presencas integer, faltas integer, ausencias integer, justificados integer, atrasos integer, dias_letivos integer, funcionarios_ativos integer, esperado integer, taxa numeric, tem_calendario boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inicio date;
  v_fim    date;
  v_j      ponto_jornada;
  v_target time;
  v_cal    boolean;
  v_desde  date;
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

  -- (610) Calendário com vigência: competição que TERMINA antes da data segue
  -- na régua antiga, medida pelo que foi lançado.
  v_desde := GREATEST(v_inicio, COALESCE(v_j.calendario_desde, v_inicio));
  v_cal   := COALESCE(array_length(v_j.dias_semana, 1), 0) > 0
             AND (v_j.calendario_desde IS NULL OR v_fim >= v_j.calendario_desde);

  RETURN QUERY
  WITH base AS (
    SELECT * FROM (VALUES ('SuperMax',1),('MaxLook',2),('TechMax',3)) AS v(f, ord)
  ),
  letivos AS (
    -- Até HOJE, nunca até o fim do período: aula que ainda não aconteceu não é
    -- ausência de ninguém. Sem o LEAST, competição em curso nasce com todo o
    -- futuro contado como falta e mostra 0% de frequência até encerrar.
    SELECT dia FROM public.dias_letivos_periodo(v_desde, LEAST(v_fim, public.acre_today())) dia
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
    -- (653) Feriado/sem aula também vale sem calendário: o lançamento
    -- daquele dia não entra.
    SELECT pe.filial, pe.funcionario_id, pe.data
      FROM ponto_eletronico pe
     WHERE NOT v_cal
       AND pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_inicio AND v_fim
       AND NOT public._funcionario_desligado(pe.funcionario_id)
       AND NOT public._dia_de_folga(pe.data)
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
$function$;

-- ── Meu Crachá: mesma régua ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.minha_frequencia(p_inicio date, p_fim date)
 RETURNS TABLE(dia date, conta boolean, status text, entrada text, saida text, situacao text, credito numeric, motivo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_func   uuid;
  v_adm    date;
  v_j      public.ponto_jornada;
  v_target time;
  v_cal    boolean;
  v_desde  date;
BEGIN
  PERFORM public._assert_rpc();

  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período grande demais — escolha até um ano.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
           (SELECT up.funcionario_id FROM public.user_profiles up WHERE up.id = auth.uid()),
           (SELECT f.id FROM public.funcionarios f WHERE f.user_profile_id = auth.uid() LIMIT 1))
    INTO v_func;
  IF v_func IS NULL THEN
    RETURN;  -- conta sem cadastro de funcionário: não há ponto a mostrar
  END IF;

  SELECT f.data_admissao INTO v_adm FROM public.funcionarios f WHERE f.id = v_func;

  -- Jornada e calendário: a mesma leitura de _frequencia_competicao.
  SELECT * INTO v_j FROM public.ponto_jornada WHERE id = true;
  IF COALESCE(v_j.configurado, false) THEN
    v_target := (v_j.entrada || ':00')::time;
  END IF;
  v_desde := GREATEST(p_inicio, COALESCE(v_j.calendario_desde, p_inicio));
  v_cal   := COALESCE(array_length(v_j.dias_semana, 1), 0) > 0
             AND (v_j.calendario_desde IS NULL OR p_fim >= v_j.calendario_desde);

  RETURN QUERY
  WITH letivos AS (
    -- Até hoje: aula que ainda não aconteceu não é ausência de ninguém.
    SELECT d::date AS dia
      FROM public.dias_letivos_periodo(v_desde, LEAST(p_fim, public.acre_today())) d
     WHERE v_cal AND (v_adm IS NULL OR d >= v_adm)
  ),
  lanc AS (
    SELECT pe.data, pe.status, pe.entrada, pe.saida, pe.observacao
      FROM public.ponto_eletronico pe
     WHERE pe.funcionario_id = v_func
       AND pe.data BETWEEN p_inicio AND p_fim
  ),
  dias AS (
    SELECT l.dia FROM letivos l
    UNION
    SELECT la.data FROM lanc la
  ),
  just AS (
    SELECT DISTINCT ON (jf.data) jf.data, jf.motivo
      FROM public.justificativas_falta jf
     WHERE jf.funcionario_id IN (v_func, auth.uid())
       AND COALESCE(jf.ativo, true)
       AND jf.data BETWEEN p_inicio AND p_fim
     ORDER BY jf.data, jf.created_at DESC
  )
  SELECT d.dia,
         -- Com calendário, só o dia letivo conta (lançamento em dia sem aula
         -- aparece, mas não entra). Sem calendário, conta o que foi lançado,
         -- menos feriado e dia sem aula (653).
         CASE WHEN v_cal THEN EXISTS (SELECT 1 FROM letivos l WHERE l.dia = d.dia)
              ELSE NOT public._dia_de_folga(d.dia) END,
         la.status,
         la.entrada,
         la.saida,
         CASE
           WHEN la.data IS NULL THEN 'Sem registro'
           ELSE CASE public._freq_credito_dia(la.status, la.entrada, v_target, v_j.tolerancia_min)
                  WHEN 1   THEN 'Presente'
                  WHEN 0.5 THEN 'Atraso'
                  WHEN 0   THEN 'Falta'
                  ELSE 'Justificada'
                END
         END,
         CASE WHEN la.data IS NULL THEN 0::numeric
              ELSE public._freq_credito_dia(la.status, la.entrada, v_target, v_j.tolerancia_min) END,
         COALESCE(NULLIF(btrim(la.observacao), ''), j.motivo)
    FROM dias d
    LEFT JOIN lanc la ON la.data = d.dia
    LEFT JOIN just j  ON j.data  = d.dia
   ORDER BY d.dia;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verificação ────────────────────────────────────────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'ponto_calendario_excecoes_tipo_check';   -- inclui feriado
--   SELECT proname, md5(prosrc) FROM pg_proc
--    WHERE proname IN ('_dia_de_folga','definir_excecao_calendario','dias_letivos_periodo',
--                      '_frequencia_competicao','minha_frequencia');  -- iguais nas 4
--   SELECT has_function_privilege('anon', 'public._dia_de_folga(date)', 'EXECUTE');  -- false
