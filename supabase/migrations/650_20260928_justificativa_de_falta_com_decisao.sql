-- 650_20260928_justificativa_de_falta_com_decisao.sql
--
-- O aluno envia a justificativa da própria falta pelo Meu Crachá; o gerente da
-- unidade dá o parecer (aceita/nega); a decisão final é do Admin. Só quando o
-- Admin aceita o dia vira 'Justificado' no ponto — e aí sai da conta do placar
-- (_freq_credito_dia devolve NULL) e da folha (recalcular_folha_do_ponto não
-- desconta), sem regra nova em nenhum dos dois.
--
-- Até aqui `justificativas_falta` (migr. 114) era só um recado: não tinha
-- status, nenhuma tela gravava nela (docs/mapa) e ela não mexia no ponto. As 4
-- turmas estavam com a tabela vazia quando esta migração foi escrita.
--
-- Parecer do gerente é parecer: aparece para o Admin, não muda o ponto. Se o
-- Admin decide antes do gerente, vale a decisão do Admin e o parecer fecha.
--
-- Escrita direta fecha: as três RPCs abaixo são a única porta (SECURITY
-- DEFINER). A leitura continua na justfalta_select (própria, gerente/RH da
-- unidade, Matriz).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ── 1. Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE public.justificativas_falta
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'Pendente',
  ADD COLUMN IF NOT EXISTS filial               text,
  ADD COLUMN IF NOT EXISTS parecer_gerente      text,
  ADD COLUMN IF NOT EXISTS parecer_gerente_obs  text,
  ADD COLUMN IF NOT EXISTS parecer_gerente_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parecer_gerente_nome text,
  ADD COLUMN IF NOT EXISTS parecer_gerente_em   timestamptz,
  ADD COLUMN IF NOT EXISTS decisao_obs          text,
  ADD COLUMN IF NOT EXISTS decidido_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decidido_por_nome    text,
  ADD COLUMN IF NOT EXISTS decidido_em          timestamptz,
  ADD COLUMN IF NOT EXISTS ponto_id             uuid REFERENCES public.ponto_eletronico(id) ON DELETE SET NULL;

ALTER TABLE public.justificativas_falta DROP CONSTRAINT IF EXISTS chk_justfalta_status;
ALTER TABLE public.justificativas_falta ADD CONSTRAINT chk_justfalta_status
  CHECK (status IN ('Pendente', 'Aceita', 'Negada'));
ALTER TABLE public.justificativas_falta DROP CONSTRAINT IF EXISTS chk_justfalta_parecer;
ALTER TABLE public.justificativas_falta ADD CONSTRAINT chk_justfalta_parecer
  CHECK (parecer_gerente IS NULL OR parecer_gerente IN ('Aceita', 'Negada'));

-- Um dia, uma justificativa em aberto (ou aceita). Negada libera reenviar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_justfalta_dia_aberta
  ON public.justificativas_falta (funcionario_id, data)
  WHERE COALESCE(ativo, true) AND status <> 'Negada';
CREATE INDEX IF NOT EXISTS idx_justfalta_status ON public.justificativas_falta (status, filial);

-- ── 2. Escrita direta fecha ─────────────────────────────────────────────────
DROP POLICY IF EXISTS justfalta_insert ON public.justificativas_falta;
DROP POLICY IF EXISTS justfalta_update ON public.justificativas_falta;

-- ── 3. Helper: o funcionário (cadastro de RH) de uma conta ──────────────────
-- Vínculo nos dois lados, como minha_frequencia (648) e o Meu Crachá (561).
CREATE OR REPLACE FUNCTION public._funcionario_da_conta(p_user uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT up.funcionario_id FROM public.user_profiles up WHERE up.id = p_user),
    (SELECT f.id FROM public.funcionarios f WHERE f.user_profile_id = p_user LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public._funcionario_da_conta(uuid) FROM public, anon, authenticated;

-- ── 4. Aluno envia ──────────────────────────────────────────────────────────
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
  IF v_ponto.id IS NULL THEN
    -- Sem lançamento, só é falta se era dia de aula.
    IF NOT EXISTS (SELECT 1 FROM public.dias_letivos_periodo(p_data, p_data)) THEN
      RAISE EXCEPTION 'Não houve aula nesse dia — não há falta a justificar.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF v_ponto.status = 'Justificado' THEN
      RAISE EXCEPTION 'Esse dia já está justificado.' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_j FROM public.ponto_jornada WHERE id = true;
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

-- ── 5. Gerente dá o parecer ─────────────────────────────────────────────────
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
      || v_jf.nome_funcionario || ' (' || to_char(v_jf.data, 'DD/MM') || '). A decisão final é sua.',
    'rh-registrodeponto', 'Média', p_id, v_obs, v_jf.filial);
END;
$$;
REVOKE ALL ON FUNCTION public.parecer_justificativa_falta(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.parecer_justificativa_falta(uuid, boolean, text) TO authenticated;

-- ── 6. Admin decide ─────────────────────────────────────────────────────────
-- role = 'admin' literal: auth_is_admin() também deixa passar aluno com papel
-- de CEO/conselheiro, e a decisão final é do professor.
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
  IF v_jf.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta justificativa já foi decidida (%).', v_jf.status USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_aceita AND v_obs IS NULL THEN
    RAISE EXCEPTION 'Para negar, diga o porquê.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  IF p_aceita THEN
    IF v_corte IS NOT NULL AND v_jf.data < v_corte THEN
      RAISE EXCEPTION 'Esse dia é da turma anterior — o ponto dela não se reescreve.' USING ERRCODE = 'P0001';
    END IF;
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
    ELSIF v_ponto.afastamento_id IS NULL AND v_ponto.status <> 'Justificado' THEN
      -- Afastamento já justifica o dia por conta própria: não se mexe nele.
      UPDATE public.ponto_eletronico
         SET status = 'Justificado', horas_trabalhadas = 0, observacao = v_obs_ponto,
             registrado_por = auth.uid(), registrado_por_nome = v_nome
       WHERE id = v_ponto.id;
    END IF;
  END IF;

  UPDATE public.justificativas_falta
     SET status            = CASE WHEN p_aceita THEN 'Aceita' ELSE 'Negada' END,
         decisao_obs       = v_obs,
         decidido_por      = auth.uid(),
         decidido_por_nome = v_nome,
         decidido_em       = now(),
         ponto_id          = CASE WHEN p_aceita THEN v_ponto.id ELSE NULL END
   WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.decidir_justificativa_falta(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decidir_justificativa_falta(uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
