-- 648_20260928_minha_frequencia.sql
--
-- O aluno passa a ver a própria frequência no Meu Crachá (só leitura).
--
-- Por que RPC, e não a tela lendo `ponto_eletronico` (que a RLS já deixa o
-- aluno ler): a frequência que vale é a do PLACAR (_frequencia_competicao,
-- peso 20%), e ela não é "o que foi lançado". Dia letivo sem lançamento é
-- ausência (crédito 0), atraso vale meio dia, justificado sai da conta, e
-- lançamento em dia sem aula não entra. Refazer isso no navegador duplicaria
-- regra de negócio — o dia em que uma das duas mudasse, o aluno veria "2
-- faltas" e o placar contaria 3. Aqui as peças são AS MESMAS do placar:
-- dias_letivos_periodo, _freq_credito_dia, a jornada, calendario_desde e a
-- admissão.
--
-- Só devolve o próprio funcionário de quem chama: não há parâmetro de pessoa.
-- O vínculo é procurado nos dois lados (user_profiles.funcionario_id e
-- funcionarios.user_profile_id), como o Meu Crachá já faz (migr. 561).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

CREATE OR REPLACE FUNCTION public.minha_frequencia(p_inicio date, p_fim date)
RETURNS TABLE(
  dia       date,
  conta     boolean,   -- entra na frequência do placar?
  status    text,      -- o que está no ponto (Normal/Falta/Justificado) ou NULL
  entrada   text,
  saida     text,
  situacao  text,      -- Presente · Atraso · Falta · Sem registro · Justificada
  credito   numeric,   -- 1 · 0.5 · 0 · NULL (justificado: fora da conta)
  motivo    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
         -- aparece, mas não entra). Sem calendário, conta o que foi lançado.
         CASE WHEN v_cal THEN EXISTS (SELECT 1 FROM letivos l WHERE l.dia = d.dia) ELSE true END,
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
$$;

REVOKE ALL ON FUNCTION public.minha_frequencia(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.minha_frequencia(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
