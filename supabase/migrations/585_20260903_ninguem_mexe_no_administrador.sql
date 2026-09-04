-- ════════════════════════════════════════════════════════════════════════════
-- 585 — Ninguém mexe no Administrador
--
-- Auditoria pedida em 03/09, exercitada com JWT de CEO e de conselheiro em
-- transação revertida (a régua de [[feedback_testar_guard_precisa_de_jwt]]).
--
-- O que JÁ estava fechado, e continua:
--   • RLS de `user_profiles`: UPDATE só na própria linha ou sendo role='admin'.
--     Conselheiro e CEO tentando rebaixar, renomear ou apagar o professor →
--     0 linhas.
--   • Gatilho anti-privesc: role, setor, setores_extras, filial,
--     is_conselheiro, pode_acessar_usuarios, criado_por, ativo, desligado_em e
--     funcionario_id continuam bloqueados na própria linha.
--   • `/api/users`: create/update/delete/reset-password são só do admin, e
--     'ajustar-acesso-carreira' recusa alvo admin.
--   • `senhas_visiveis`: leitura por `role = 'admin'` literal — ninguém lê a
--     senha do professor.
--
-- O que estava ABERTO (as duas sondas passaram):
--
--   1. DESLIGAR O PROFESSOR (grave). `demitir_funcionario` e
--      `decidir_desligamento` são de admin OU CEO, e só impedem desligar a si
--      mesmo. Basta o funcionário estar vinculado ao perfil do admin para
--      `_aplicar_desligado_em` carimbar `desligado_em` NO PERFIL DO PROFESSOR —
--      e a partir daí `_assert_rpc()` recusa todas as RPCs dele com "Seu
--      vínculo com a organização foi encerrado". O aluno não vira admin, mas
--      derruba o admin, que é o mesmo estrago pelo avesso.
--      Pior: a policy de `funcionarios` deixa RH/CEO/conselheiro CRIAR o
--      vínculo — dá para fabricar o funcionário do professor e então desligá-lo.
--
--   2. TROCAR A FOTO DO PROFESSOR. `atualizar_foto_usuario` aceita
--      `v_role IN ('admin','ceo')` para qualquer alvo. Cosmético, mas é o
--      perfil do professor sendo escrito por um aluno.
--
-- A correção tem duas camadas de propósito: mensagem clara em cada porta, e
-- uma rede no gatilho da tabela — porque SECURITY DEFINER ignora RLS mas NÃO
-- ignora trigger ([[feedback_secdef_ignora_rls_nao_trigger]]), então qualquer
-- caminho novo já nasce fechado.
--
-- Nota de vocabulário: `auth_is_admin()` inclui CEO e conselheiro (é "escopo
-- global", não "é o professor"). Toda regra aqui usa `auth_user_role() =
-- 'admin'`, que é o professor e mais ninguém.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. A rede: o perfil do admin só se altera por ele mesmo ─────────────────
CREATE OR REPLACE FUNCTION public.user_profiles_bloquear_privesc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- MIGR 585. Vale para QUALQUER coluna e QUALQUER caminho — inclusive RPC
  -- SECURITY DEFINER, que passa por cima da RLS mas não por cima daqui. O
  -- administrador é o professor: quem altera o perfil dele é ele, ou o
  -- servidor (o endpoint /api/users, que já é admin-only).
  IF COALESCE(OLD.role, '') = 'admin'
     AND NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'O perfil do administrador não é alterável por outro usuário.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Alteração de role bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.setor IS DISTINCT FROM OLD.setor THEN
    RAISE EXCEPTION 'Alteração de setor bloqueada — use /api/users (admin/CEO/gerente).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.setores_extras IS DISTINCT FROM OLD.setores_extras THEN
    RAISE EXCEPTION 'Alteração de setores_extras bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.filial IS DISTINCT FROM OLD.filial THEN
    RAISE EXCEPTION 'Alteração de filial bloqueada — use /api/users.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_conselheiro IS DISTINCT FROM OLD.is_conselheiro THEN
    RAISE EXCEPTION 'Alteração de is_conselheiro bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.pode_acessar_usuarios IS DISTINCT FROM OLD.pode_acessar_usuarios THEN
    RAISE EXCEPTION 'Alteração de pode_acessar_usuarios bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.criado_por IS DISTINCT FROM OLD.criado_por THEN
    RAISE EXCEPTION 'Alteração de criado_por bloqueada.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.desligado_em IS DISTINCT FROM OLD.desligado_em
     AND COALESCE(current_setting('app.desligamento_rh', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Alteração de desligado_em bloqueada — desligamento e readmissão passam pelo RH.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'Alteração de ativo bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.funcionario_id IS DISTINCT FROM OLD.funcionario_id
     AND NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Alteração de funcionario_id bloqueada — o vínculo é feito pelo professor em Usuários.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. Desligamento: o administrador não é desligado por aluno ──────────────
CREATE OR REPLACE FUNCTION public._aplicar_desligado_em(p_profile_id uuid, p_quando timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alvo_role text;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT COALESCE(public.auth_is_service_role(), false)
     AND COALESCE(public.auth_user_role(), '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO mexem em desligamento.' USING ERRCODE = '42501';
  END IF;

  -- MIGR 585. O CEO é aluno. Desligar o funcionário vinculado ao professor
  -- carimbava `desligado_em` no perfil dele, e `_assert_rpc()` passava a
  -- recusar tudo o que ele faz — derrubar o administrador é o mesmo estrago
  -- que virar administrador, pelo avesso.
  SELECT role INTO v_alvo_role FROM public.user_profiles WHERE id = p_profile_id;
  IF COALESCE(v_alvo_role, '') = 'admin'
     AND NOT COALESCE(public.auth_is_service_role(), false)
     AND NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Este cadastro é do administrador do sistema — só o próprio administrador mexe no vínculo dele.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.desligamento_rh', 'true', true);
  UPDATE public.user_profiles SET desligado_em = p_quando WHERE id = p_profile_id;
  PERFORM set_config('app.desligamento_rh', 'false', true);
END;
$function$;

-- ── 3. O vínculo não se fabrica ─────────────────────────────────────────────
-- Apontar um funcionário para o perfil do administrador é o primeiro passo do
-- ataque acima (a policy de `funcionarios` deixa RH e Matriz escreverem em
-- qualquer unidade). Também é o que faria o professor aparecer na folha, no
-- ponto e no crachá de uma filial.
CREATE OR REPLACE FUNCTION public.funcionarios_vinculo_admin_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alvo_role text;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.user_profile_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.user_profile_id IS NOT DISTINCT FROM OLD.user_profile_id) THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_alvo_role FROM public.user_profiles WHERE id = NEW.user_profile_id;
  IF COALESCE(v_alvo_role, '') = 'admin'
     AND NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Só o próprio administrador liga um cadastro de funcionário à conta dele.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_funcionarios_vinculo_admin ON public.funcionarios;
CREATE TRIGGER trg_funcionarios_vinculo_admin
  BEFORE INSERT OR UPDATE ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.funcionarios_vinculo_admin_guard();

-- ── 4. Foto do professor é do professor ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atualizar_foto_usuario(p_user_id uuid, p_foto_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_alvo_filial text;
  v_alvo_role   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM user_profiles WHERE id = auth.uid();
  SELECT filial, role INTO v_alvo_filial, v_alvo_role FROM user_profiles WHERE id = p_user_id;

  -- MIGR 585: nem a foto. O perfil do administrador é escrito por ele.
  IF COALESCE(v_alvo_role, '') = 'admin' AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'O perfil do administrador não é alterável por outro usuário.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
       p_user_id = auth.uid()
       OR v_role IN ('admin', 'ceo')
       OR (v_role = 'gerente' AND COALESCE(public.auth_pode_filial(v_alvo_filial), false))
     ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar a foto deste usuário.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE user_profiles SET foto_url = p_foto_url WHERE id = p_user_id;
END;
$function$;

-- ── 5. O conselho não nomeia o professor ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.nomear_mandato(p_user_profile_id uuid, p_cargo text, p_filial text, p_data_inicio date, p_data_fim date, p_ato text DEFAULT NULL::text, p_aplicar_acesso boolean DEFAULT false, p_origem_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_perfil  user_profiles;
  v_func_id uuid;
  v_id      uuid;
  v_ator    text;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Conselho nomeia.' USING ERRCODE = '42501';
  END IF;

  -- Ninguém se nomeia. Mesmo conflito de interesse que a 386 escreveu para
  -- orçamento e prestação de contas, e vale inclusive para conselheiro.
  IF p_user_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Ninguém se nomeia. Outro conselheiro tem de assinar o ato.'
      USING ERRCODE = '42501';
  END IF;

  IF p_data_fim IS NULL OR p_data_inicio IS NULL OR p_data_fim <= p_data_inicio THEN
    RAISE EXCEPTION 'Mandato precisa de prazo: fim depois do início.' USING ERRCODE = 'P0001';
  END IF;

  IF p_filial NOT IN ('SuperMax','MaxLook','TechMax','Matriz') THEN
    RAISE EXCEPTION 'Unidade inválida.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_perfil FROM user_profiles WHERE id = p_user_profile_id;
  IF v_perfil.id IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 585: o administrador não ocupa posto do organograma da turma. Sem
  -- isto, o conselho abriria mandato em nome do professor — e o encerramento
  -- desse mandato é um caminho a mais para mexer no acesso dele.
  IF COALESCE(v_perfil.role, '') = 'admin'
     AND NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'O administrador do sistema não é nomeado para cargos da operação.'
      USING ERRCODE = '42501';
  END IF;

  IF v_perfil.desligado_em IS NOT NULL OR NOT COALESCE(v_perfil.ativo, true) THEN
    RAISE EXCEPTION 'Não se nomeia quem está desligado.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM mandatos
              WHERE user_profile_id = p_user_profile_id AND status = 'vigente' AND ativo = true) THEN
    RAISE EXCEPTION 'Esta pessoa já tem mandato vigente. Encerre o atual antes.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM mandatos
              WHERE lower(cargo) = lower(p_cargo) AND filial = p_filial
                AND status = 'vigente' AND ativo = true) THEN
    RAISE EXCEPTION 'Já há titular vigente para % em %.', p_cargo, p_filial USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_ator FROM user_profiles WHERE id = auth.uid();
  SELECT id INTO v_func_id FROM funcionarios
   WHERE user_profile_id = p_user_profile_id AND COALESCE(ativo, true) LIMIT 1;

  INSERT INTO mandatos
    (user_profile_id, funcionario_id, nome_snapshot, cargo, filial,
     data_inicio, data_fim, ato, origem_mandato_id, aplicou_acesso,
     nomeado_por, nomeado_por_nome)
  VALUES
    (p_user_profile_id, v_func_id, v_perfil.nome, p_cargo, p_filial,
     p_data_inicio, p_data_fim, NULLIF(btrim(COALESCE(p_ato,'')), ''),
     p_origem_id, COALESCE(p_aplicar_acesso, false), auth.uid(), v_ator)
  RETURNING id INTO v_id;

  -- Acesso: só entre colaborador e gerente. Mandato não promove ninguém a
  -- admin/CEO/conselheiro — esse caminho fica fechado por design (migr. 258).
  IF COALESCE(p_aplicar_acesso, false) AND v_perfil.role IN ('colaborador','gerente') THEN
    UPDATE user_profiles
       SET role = 'gerente', filial = p_filial
     WHERE id = p_user_profile_id;
  END IF;

  INSERT INTO movimentacoes_carreira
    (funcionario_id, nome_funcionario, tipo, cargo_novo, filial_nova, filial,
     role_anterior, role_nova, data_efeito, user_profile_id,
     decidido_por, decidido_por_nome)
  VALUES
    (v_func_id, v_perfil.nome, 'Nomeação', p_cargo, p_filial, p_filial,
     v_perfil.role,
     CASE WHEN COALESCE(p_aplicar_acesso, false) AND v_perfil.role IN ('colaborador','gerente')
          THEN 'gerente' ELSE v_perfil.role END,
     p_data_inicio, p_user_profile_id, auth.uid(), v_ator);

  RETURN jsonb_build_object('sucesso', true, 'mandato_id', v_id);
END;
$function$;

NOTIFY pgrst, 'reload schema';
