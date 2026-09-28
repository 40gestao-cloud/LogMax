-- 652_20260928_justificativa_furos_da_revisao.sql
--
-- Revisão das 649-651 pedida pelo usuário ("analise se ficou furos"). Quatro
-- correções, todas nas justificativas de falta:
--
--   1. enviar_justificativa_falta aceitava dia sem ponto só por ser dia letivo
--      da semana — inclusive antes do calendário da turma começar e antes da
--      admissão, dias que minha_frequencia e o placar não contam.
--   2. decidir_justificativa_falta aceitava por cima de presença lançada DEPOIS
--      do envio: o dia em que o aluno veio virava 'Justificado' e saía da conta.
--   3. O aviso do parecer dizia "a decisão final é sua" para o setor 'all',
--      onde também estão CEO e conselheiro — alunos, que não decidem.
--   4. justfalta_delete era auth_is_admin(), que inclui CEO/conselheiro: um
--      aluno podia apagar a justificativa (e com ela a trilha) de um colega.
--      Passa a ser o professor (role 'admin' literal).
--
-- As três funções vêm do texto aplicado (650/651) com os remendos acima.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

DROP POLICY IF EXISTS justfalta_delete ON public.justificativas_falta;
CREATE POLICY justfalta_delete ON public.justificativas_falta FOR DELETE TO authenticated
  USING (COALESCE(( SELECT auth_user_role() AS auth_user_role) = 'admin'::text, false));

CREATE OR REPLACE FUNCTION public.enviar_justificativa_falta(p_data date, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_func   uuid;
  v_perfil public.user_profiles;
  v_ponto  public.ponto_eletronico;
  v_j      public.ponto_jornada;
  v_target time;
  v_corte  date := public.ponto_corte_turma();
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_id     uuid;
  v_adm    date;
BEGIN
  PERFORM public._assert_rpc();

  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Escolha o dia da falta.' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Escreva o motivo com pelo menos 10 caracteres.' USING ERRCODE = 'P0001';
  END IF;
  IF p_data > public.acre_today() THEN
    RAISE EXCEPTION 'Só dá para justificar um dia que já chegou.' USING ERRCODE = 'P0001';
  END IF;
  IF v_corte IS NOT NULL AND p_data < v_corte THEN
    RAISE EXCEPTION 'Esse dia é da turma anterior — o ponto dela não se reescreve.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_perfil FROM public.user_profiles WHERE id = auth.uid();
  v_func := public._funcionario_da_conta(auth.uid());
  IF v_func IS NULL THEN
    RAISE EXCEPTION 'Sua conta não tem cadastro de funcionário — peça ao RH para vincular.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ponto FROM public.ponto_eletronico WHERE funcionario_id = v_func AND data = p_data;
  SELECT * INTO v_j FROM public.ponto_jornada WHERE id = true;
  IF v_ponto.id IS NULL THEN
    -- (652) Sem lançamento, só é falta se era dia de aula DEPOIS do calendário
    -- da turma e da admissão — a mesma régua de minha_frequencia (648) e do
    -- placar. Antes daqui, um dia letivo de agosto sem ponto passava.
    SELECT f.data_admissao INTO v_adm FROM public.funcionarios f WHERE f.id = v_func;
    IF NOT EXISTS (SELECT 1 FROM public.dias_letivos_periodo(p_data, p_data))
       OR (v_j.calendario_desde IS NOT NULL AND p_data < v_j.calendario_desde)
       OR (v_adm IS NOT NULL AND p_data < v_adm) THEN
      RAISE EXCEPTION 'Não houve aula que contasse nesse dia — não há falta a justificar.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF v_ponto.status = 'Justificado' THEN
      RAISE EXCEPTION 'Esse dia já está justificado.' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_j.configurado, false) THEN
      v_target := (v_j.entrada || ':00')::time;
    END IF;
    IF public._freq_credito_dia(v_ponto.status, v_ponto.entrada, v_target, v_j.tolerancia_min) <> 0 THEN
      RAISE EXCEPTION 'Nesse dia há presença registrada — não há falta a justificar.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.justificativas_falta
              WHERE funcionario_id = auth.uid() AND data = p_data
                AND COALESCE(ativo, true) AND status <> 'Negada') THEN
    RAISE EXCEPTION 'Você já enviou justificativa para esse dia.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.justificativas_falta
    (funcionario_id, nome_funcionario, data, motivo, criado_por, nome_criador, role_criador, filial, status)
  VALUES
    (auth.uid(), COALESCE(v_perfil.nome, 'Aluno'), p_data, v_motivo, auth.uid(), COALESCE(v_perfil.nome, 'Aluno'),
     CASE WHEN v_perfil.role IN ('colaborador', 'gerente', 'ceo', 'admin') THEN v_perfil.role ELSE 'colaborador' END,
     COALESCE(v_perfil.filial, 'Matriz'), 'Pendente')
  RETURNING id INTO v_id;

  PERFORM public.notificar_setor(
    'gerencia', 'justificativa_falta', 'Justificativa de falta',
    COALESCE(v_perfil.nome, 'Um aluno') || ' justificou a falta de ' || to_char(p_data, 'DD/MM') || ' — dê seu parecer.',
    'rh-registrodeponto', 'Média', v_id, v_motivo, COALESCE(v_perfil.filial, 'Matriz'));

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.enviar_justificativa_falta(date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.enviar_justificativa_falta(date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.parecer_justificativa_falta(p_id uuid, p_aceita boolean, p_obs text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_jf   public.justificativas_falta;
  v_obs  text := NULLIF(btrim(COALESCE(p_obs, '')), '');
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT COALESCE(public.auth_user_role() = 'gerente', false) THEN
    RAISE EXCEPTION 'Só o gerente da unidade dá o parecer.' USING ERRCODE = '42501';
  END IF;
  IF p_aceita IS NULL THEN
    RAISE EXCEPTION 'Escolha aceitar ou negar.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_jf FROM public.justificativas_falta WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_jf.id IS NULL THEN
    RAISE EXCEPTION 'Justificativa não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.auth_user_filial() = v_jf.filial, false) THEN
    RAISE EXCEPTION 'Essa justificativa é de outra unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_jf.funcionario_id = auth.uid() THEN
    RAISE EXCEPTION 'A própria justificativa quem decide é o Admin.' USING ERRCODE = '42501';
  END IF;
  IF v_jf.status <> 'Pendente' THEN
    RAISE EXCEPTION 'O Admin já decidiu esta justificativa (%).', v_jf.status USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_aceita AND v_obs IS NULL THEN
    RAISE EXCEPTION 'Para negar, diga o porquê.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.justificativas_falta
     SET parecer_gerente      = CASE WHEN p_aceita THEN 'Aceita' ELSE 'Negada' END,
         parecer_gerente_obs  = v_obs,
         parecer_gerente_por  = auth.uid(),
         parecer_gerente_nome = v_nome,
         parecer_gerente_em   = now()
   WHERE id = p_id;

  PERFORM public.notificar_setor(
    'all', 'justificativa_falta', 'Justificativa aguarda o Admin',
    'Gerente ' || CASE WHEN p_aceita THEN 'aceitou' ELSE 'negou' END || ' a justificativa de '
      || v_jf.nome_funcionario || ' (' || to_char(v_jf.data, 'DD/MM') || '). Aguarda a decisão do Admin.',
    'rh-registrodeponto', 'Média', p_id, v_obs, v_jf.filial);
END;
$$;
REVOKE ALL ON FUNCTION public.parecer_justificativa_falta(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.parecer_justificativa_falta(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decidir_justificativa_falta(p_id uuid, p_aceita boolean, p_obs text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_jf    public.justificativas_falta;
  v_obs   text := NULLIF(btrim(COALESCE(p_obs, '')), '');
  v_nome  text;
  v_func  uuid;
  v_ponto public.ponto_eletronico;
  v_corte date := public.ponto_corte_turma();
  v_obs_ponto text;
  v_novo  text := CASE WHEN p_aceita THEN 'Aceita' ELSE 'Negada' END;
  v_tocado boolean := false;
  v_criado boolean := false;
  v_st_antes text;
  v_hr_antes numeric;
  v_ob_antes text;
  v_rp_antes uuid;
  v_rn_antes text;
  v_j      public.ponto_jornada;
  v_target time;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'A decisão final é do Admin.' USING ERRCODE = '42501';
  END IF;
  IF p_aceita IS NULL THEN
    RAISE EXCEPTION 'Escolha aceitar ou negar.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_jf FROM public.justificativas_falta WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_jf.id IS NULL THEN
    RAISE EXCEPTION 'Justificativa não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_jf.status = v_novo THEN
    RAISE EXCEPTION 'Esta justificativa já está %.', v_novo USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_aceita AND v_obs IS NULL THEN
    RAISE EXCEPTION 'Para negar, diga o porquê.' USING ERRCODE = 'P0001';
  END IF;
  -- Só barra quando a decisão mexe no ponto (aceitar, ou desfazer um aceite).
  IF (p_aceita OR v_jf.status = 'Aceita') AND v_corte IS NOT NULL AND v_jf.data < v_corte THEN
    RAISE EXCEPTION 'Esse dia é da turma anterior — o ponto dela não se reescreve.' USING ERRCODE = 'P0001';
  END IF;
  IF p_aceita AND v_jf.status = 'Negada' AND EXISTS (
       SELECT 1 FROM public.justificativas_falta o
        WHERE o.funcionario_id = v_jf.funcionario_id AND o.data = v_jf.data AND o.id <> v_jf.id
          AND COALESCE(o.ativo, true) AND o.status <> 'Negada') THEN
    RAISE EXCEPTION 'O aluno já reenviou a justificativa deste dia — decida a nova.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  IF p_aceita THEN
    v_func := public._funcionario_da_conta(v_jf.funcionario_id);
    IF v_func IS NULL THEN
      RAISE EXCEPTION 'A conta de % não tem cadastro de funcionário — vincule antes de aceitar.', v_jf.nome_funcionario
        USING ERRCODE = 'P0001';
    END IF;

    v_obs_ponto := 'Justificativa aceita: ' || v_jf.motivo;

    SELECT * INTO v_ponto FROM public.ponto_eletronico
     WHERE funcionario_id = v_func AND data = v_jf.data FOR UPDATE;

    -- (652) Entre o envio e a decisão o gerente pode ter lançado presença.
    -- Aceitar trocaria "Presente" por "Justificado" e tiraria da conta um dia
    -- em que o aluno veio.
    IF v_ponto.id IS NOT NULL AND v_ponto.afastamento_id IS NULL AND v_ponto.status <> 'Justificado' THEN
      SELECT * INTO v_j FROM public.ponto_jornada WHERE id = true;
      IF COALESCE(v_j.configurado, false) THEN
        v_target := (v_j.entrada || ':00')::time;
      END IF;
      IF COALESCE(public._freq_credito_dia(v_ponto.status, v_ponto.entrada, v_target, v_j.tolerancia_min), 0) <> 0 THEN
        RAISE EXCEPTION 'O ponto de % já tem presença lançada — não há falta a justificar. Negue, ou corrija o ponto antes.',
          to_char(v_jf.data, 'DD/MM') USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF v_ponto.id IS NULL THEN
      INSERT INTO public.ponto_eletronico
        (funcionario_id, data, status, horas_trabalhadas, origem, observacao, registrado_por, registrado_por_nome)
      VALUES (v_func, v_jf.data, 'Justificado', 0, 'justificativa', v_obs_ponto, auth.uid(), v_nome)
      RETURNING * INTO v_ponto;
      v_tocado := true;
      v_criado := true;
    ELSIF v_ponto.afastamento_id IS NULL AND v_ponto.status <> 'Justificado' THEN
      -- Afastamento já justifica o dia por conta própria: não se mexe nele.
      v_st_antes := v_ponto.status;
      v_hr_antes := v_ponto.horas_trabalhadas;
      v_ob_antes := v_ponto.observacao;
      v_rp_antes := v_ponto.registrado_por;
      v_rn_antes := v_ponto.registrado_por_nome;
      UPDATE public.ponto_eletronico
         SET status = 'Justificado', horas_trabalhadas = 0, observacao = v_obs_ponto,
             registrado_por = auth.uid(), registrado_por_nome = v_nome
       WHERE id = v_ponto.id;
      v_tocado := true;
    END IF;

  ELSIF v_jf.status = 'Aceita' AND v_jf.ponto_tocado AND v_jf.ponto_id IS NOT NULL THEN
    -- Aceita → Negada: desfaz o que o aceite fez, se ninguém lançou por cima.
    SELECT * INTO v_ponto FROM public.ponto_eletronico WHERE id = v_jf.ponto_id FOR UPDATE;
    IF v_ponto.id IS NOT NULL AND v_ponto.status = 'Justificado' AND v_ponto.afastamento_id IS NULL THEN
      IF v_jf.ponto_criado THEN
        DELETE FROM public.ponto_eletronico WHERE id = v_ponto.id;
      ELSE
        UPDATE public.ponto_eletronico
           SET status = COALESCE(v_jf.ponto_status_antes, 'Falta'),
               horas_trabalhadas = COALESCE(v_jf.ponto_horas_antes, 0),
               observacao = v_jf.ponto_obs_antes,
               registrado_por = v_jf.ponto_reg_por_antes,
               registrado_por_nome = v_jf.ponto_reg_nome_antes
         WHERE id = v_ponto.id;
      END IF;
    END IF;
    v_ponto := NULL;
  END IF;

  UPDATE public.justificativas_falta
     SET status             = v_novo,
         decisao_obs        = v_obs,
         decidido_por       = auth.uid(),
         decidido_por_nome  = v_nome,
         decidido_em        = now(),
         ponto_id           = CASE WHEN p_aceita THEN v_ponto.id ELSE NULL END,
         ponto_tocado       = v_tocado,
         ponto_criado       = v_criado,
         ponto_status_antes = v_st_antes,
         ponto_horas_antes  = v_hr_antes,
         ponto_obs_antes    = v_ob_antes,
         ponto_reg_por_antes  = v_rp_antes,
         ponto_reg_nome_antes = v_rn_antes
   WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.decidir_justificativa_falta(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decidir_justificativa_falta(uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
