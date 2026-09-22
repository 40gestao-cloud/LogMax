-- 610_20260922_o_calendario_da_turma_vale_a_partir_de_uma_data.sql
--
-- A 376 deu à frequência um denominador honesto: com `ponto_jornada.dias_semana`
-- preenchido, cada ativo × cada dia letivo vira pessoa-dia, e dia sem registro
-- conta zero. Sem isso, o denominador é o que foi LANÇADO — quem esquece de
-- bater ponto não perde nada, e numa competição com prêmio isso é sorteio.
--
-- Só que ligar o calendário hoje reescreve o passado. Na turma ERP o ponto
-- eletrônico só começou em 24/08, e a competição 001 corre desde 27/07: com
-- calendário, as ~4 semanas em que o ponto ainda nem era usado viram falta de
-- todo mundo, e o placar de uma competição que já terminou — e ainda não foi
-- declarada — muda de pódio por causa de uma configuração feita depois.
--
-- Então o calendário passa a ter data de vigência. `calendario_desde` é o dia
-- a partir do qual a régua nova vale; competição que termina antes disso segue
-- medida como sempre foi, pelo que foi lançado.
--
-- Efeito colateral assumido: numa competição que ATRAVESSA a data, os
-- lançamentos anteriores a ela saem da conta — o universo de pessoa-dia começa
-- na vigência. É o preço de não ter duas réguas dentro do mesmo número.
--
-- A migração NÃO preenche `dias_semana` nem `calendario_desde`: cada turma tem
-- seu dia de aula (a ERP é segunda e terça; outra pode ser quarta e quinta) e
-- chutar isso marcaria a turma inteira como faltante — a mesma lição da 350,
-- que não chutou o horário de entrada.
--
-- NOTA SOBRE O CORPO: `_frequencia_competicao` copiada do banco nesta sessão
-- (idêntica nos 4). Mudam duas linhas: o cálculo de `v_cal` e o início da
-- série em `letivos`.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

ALTER TABLE public.ponto_jornada
  ADD COLUMN IF NOT EXISTS calendario_desde date;

COMMENT ON COLUMN public.ponto_jornada.calendario_desde IS
  'A partir de quando dia letivo sem registro conta como ausência. NULL = desde sempre. Competição que termina antes desta data é medida só pelo que foi lançado.';

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
$function$;

COMMIT;
