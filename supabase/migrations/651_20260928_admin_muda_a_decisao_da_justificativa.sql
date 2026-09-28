-- 651_20260928_admin_muda_a_decisao_da_justificativa.sql
--
-- O Admin pode mudar uma decisão já tomada (pedido do usuário no mesmo dia da
-- 650): Aceita → Negada e Negada → Aceita.
--
-- Mudar de ideia tem de desfazer o que o aceite fez no ponto, e só isso. Para
-- saber o que era o dia antes, o aceite passa a fotografar o estado anterior
-- da linha de ponto (mesma ideia do status_antes_afastamento da migr. 20260614c):
--   · o aceite CRIOU a linha → ao negar, ela sai;
--   · o aceite ALTEROU a linha → ao negar, volta status, horas, observação e
--     quem tinha lançado;
--   · o aceite não tocou (afastamento, ou o dia já era Justificado) → nada a
--     desfazer.
-- Se alguém lançou o ponto por cima depois do aceite (o dia deixou de ser
-- 'Justificado'), a linha não é mexida: o lançamento mais novo vale.
--
-- Negada → Aceita esbarra no índice único do dia se o aluno já reenviou: aí a
-- mensagem manda decidir a justificativa nova.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

ALTER TABLE public.justificativas_falta
  ADD COLUMN IF NOT EXISTS ponto_tocado        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ponto_criado        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ponto_status_antes  text,
  ADD COLUMN IF NOT EXISTS ponto_horas_antes   numeric,
  ADD COLUMN IF NOT EXISTS ponto_obs_antes     text,
  ADD COLUMN IF NOT EXISTS ponto_reg_por_antes uuid,
  ADD COLUMN IF NOT EXISTS ponto_reg_nome_antes text;

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
