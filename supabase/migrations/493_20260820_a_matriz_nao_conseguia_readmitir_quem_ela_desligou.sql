-- 493 — A Matriz não conseguia readmitir quem ela mesma desligou.
--
-- Relato do professor: "Admin deve poder readmitir alunos desligados, você
-- removeu minha permissão". A permissão nunca saiu da régua — nem da tela nem
-- da RPC. `readmitir_funcionario` continua com `NOT IN ('admin','ceo') → 42501`
-- e o botão de readmissão em `DesligamentosView` continua atrás de
-- `podeDecidir` (admin ou CEO). O que quebrou foi o caminho, não o direito.
--
-- Quem quebrou foi a migr. 430. Ela pôs `desligado_em` na lista de colunas de
-- privilégio do gatilho `user_profiles_bloquear_privesc` — e estava certa: sem
-- isso, o aluno desligado desfazia o próprio desligamento pelo F12 com um
-- `.update({ desligado_em: null })`. Só que o gatilho tem uma única saída,
-- `auth_is_service_role()`, e SECURITY DEFINER **não** desliga gatilho. Então a
-- porta legítima foi fechada junto com a clandestina:
--
--   admin → readmitir_funcionario()  (passa no guard de papel)
--         → UPDATE user_profiles SET desligado_em = NULL
--         → trg_user_profiles_bloquear_privesc
--         → 42501 'Alteração de desligado_em bloqueada'
--
-- Sonda que confirma (claims de authenticated; a própria exceção dá o rollback):
--
--   DO $x$ DECLARE v uuid; BEGIN
--     PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
--     SELECT id INTO v FROM user_profiles LIMIT 1;
--     UPDATE user_profiles SET desligado_em = now() WHERE id = v;
--   END $x$;   -- → 'Alteração de desligado_em bloqueada'
--
-- E não é só a readmissão: `demitir_funcionario` e `decidir_desligamento`
-- escrevem `desligado_em = now()` pela mesma porta. Desde a 430 o desligamento
-- inteiro só funcionava por service_role — ou seja, o módulo de Desligamentos
-- estava travado nas duas direções, e ninguém reparou na ida porque a volta é
-- que dói.
--
-- A CORREÇÃO mantém a trava da 430 de pé e abre uma fresta nomeada, no mesmo
-- padrão das migrs. 450/467/475: uma flag de transação (`is_local = true`, some
-- no fim da transação, inalcançável pelo PostgREST) que só as três RPCs de RH
-- levantam. Quem chega pelo F12 não tem como acender a flag: `set_config` não
-- é RPC exposta, e o único helper que a acende — `_aplicar_desligado_em` — sai
-- daqui sem GRANT para `authenticated` e ainda recheca papel por dentro.
--
-- Continua bloqueado, exatamente como a 430 quis: UPDATE cru em `desligado_em`
-- vindo do navegador, por qualquer papel, inclusive admin. A coluna só muda
-- pela porta do RH.

BEGIN;

-- ── 1. Helper: a única mão que escreve `desligado_em` ───────────────────────
--
-- Sem GRANT para authenticated/anon de propósito: só as RPCs SECURITY DEFINER
-- de RH (mesmo dono) alcançam. O guard de papel é redundante hoje e barato —
-- é o que sobra de pé se um dia alguém der GRANT sem ler este comentário.
CREATE OR REPLACE FUNCTION public._aplicar_desligado_em(
  p_profile_id uuid,
  p_quando     timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.auth_is_service_role()
     AND COALESCE(public.auth_user_role(), '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO mexem em desligamento.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.desligamento_rh', 'true', true);
  UPDATE public.user_profiles SET desligado_em = p_quando WHERE id = p_profile_id;
  PERFORM set_config('app.desligamento_rh', 'false', true);
END;
$function$;

REVOKE ALL ON FUNCTION public._aplicar_desligado_em(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 2. O gatilho da 430 aprende a reconhecer a porta do RH ──────────────────
--
-- Cópia da versão vigente (migr. 430) com uma condição nova: a exceção vale só
-- para `desligado_em`. role, setor, setores_extras, filial, is_conselheiro,
-- pode_acessar_usuarios, criado_por e ativo seguem sem fresta nenhuma.
CREATE OR REPLACE FUNCTION public.user_profiles_bloquear_privesc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role (endpoint /api/users) passa livre.
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Compara campos sensíveis; se algum mudou, rejeita.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Alteração de role bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501'; -- insufficient_privilege
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

  -- Novo na 430. `desligado_em` governa 382 policies via auth_desligado() e
  -- zera auth_user_role(); deixá-la fora desta lista era permitir que o
  -- desligado revertesse o próprio desligamento pelo console.
  --
  -- Novo na 493: `_aplicar_desligado_em` (RH: demitir / decidir / readmitir)
  -- acende uma flag de transação antes do UPDATE. É a porta legítima — sem
  -- ela a Matriz não conseguia desligar nem readmitir ninguém desde a 430.
  IF NEW.desligado_em IS DISTINCT FROM OLD.desligado_em
     AND COALESCE(current_setting('app.desligamento_rh', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Alteração de desligado_em bloqueada — desligamento e readmissão passam pelo RH.'
      USING ERRCODE = '42501';
  END IF;

  -- Soft delete do cadastro: mesma história, escala menor.
  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'Alteração de ativo bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 3. As três RPCs de RH passam a escrever pelo helper ─────────────────────
--
-- Corpos copiados do banco (não do repo — migr. 321 é a versão vigente de
-- demitir/decidir, migr. 318 a de readmitir). A única mudança em cada uma é a
-- troca do UPDATE cru pelo PERFORM.

CREATE OR REPLACE FUNCTION public.demitir_funcionario(
  p_funcionario_id uuid,
  p_tipo           text,
  p_motivo         text,
  p_data           date DEFAULT NULL::date,
  p_aviso_previo   text DEFAULT 'Indenizado'::text,
  p_observacao     text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_nome        text;
  v_filial      text;
  v_profile_id  uuid;
  v_data        date;
  v_calc        jsonb;
  v_demissao_id uuid;
  v_rescisao_id uuid;
  v_quem        text;
BEGIN
  PERFORM public._assert_rpc();

  -- auth_is_admin() não serve: inclui conselheiro. Desligar é admin ou CEO.
  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO podem desligar um colaborador.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Escreva o motivo do desligamento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome, COALESCE(filial, 'Matriz'), user_profile_id
    INTO v_nome, v_filial, v_profile_id
    FROM public.funcionarios
   WHERE id = p_funcionario_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile_id IS NOT NULL AND v_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode desligar a si mesmo.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes
              WHERE funcionario_id = p_funcionario_id AND ativo) THEN
    RAISE EXCEPTION '% já está desligado. Readmita antes de registrar novo desligamento.', v_nome
      USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');

  v_calc := public.calcular_rescisao(p_funcionario_id, p_tipo, v_data, p_aviso_previo);

  INSERT INTO public.demissoes
    (funcionario_id, nome_funcionario, filial, tipo, motivo, data_desligamento,
     aviso_previo, observacao, decidido_por, decidido_por_nome)
  VALUES
    (p_funcionario_id, v_nome, v_filial, p_tipo, btrim(p_motivo), v_data,
     p_aviso_previo, p_observacao, auth.uid(), v_quem)
  RETURNING id INTO v_demissao_id;

  v_rescisao_id := public.rescisao_gravar(
    v_demissao_id, p_funcionario_id, v_profile_id, v_filial, v_calc);

  UPDATE public.funcionarios
     SET status = 'Desligado', updated_at = now()
   WHERE id = p_funcionario_id;

  -- O corte de acesso, agora pela porta nomeada (migr. 493).
  PERFORM public._aplicar_desligado_em(v_profile_id, now());

  RETURN jsonb_build_object(
    'ok', true,
    'demissao_id', v_demissao_id,
    'rescisao_id', v_rescisao_id,
    'funcionario', v_nome,
    'acesso_cortado', v_profile_id IS NOT NULL,
    'rescisao', v_calc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.demitir_funcionario(uuid, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demitir_funcionario(uuid, text, text, date, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.decidir_desligamento(
  p_demissao_id uuid,
  p_aprovar     boolean,
  p_observacao  text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_quem        text;
  v_d           record;
  v_profile_id  uuid;
  v_calc        jsonb;
  v_rescisao_id uuid;
BEGIN
  PERFORM public._assert_rpc();

  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO decidem um desligamento.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_d FROM public.demissoes
   WHERE id = p_demissao_id AND ativo
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_d.status <> 'Solicitado' THEN
    RAISE EXCEPTION 'Esta solicitação já foi decidida (%).', v_d.status USING ERRCODE = 'P0001';
  END IF;

  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');

  IF NOT COALESCE(p_aprovar, false) THEN
    UPDATE public.demissoes
       SET status = 'Recusado',
           ativo  = false,
           decidido_por = auth.uid(),
           decidido_por_nome = v_quem,
           observacao = COALESCE(observacao || ' · ', '')
                        || 'Recusado pela Matriz em '
                        || to_char((now() AT TIME ZONE 'America/Rio_Branco')::date, 'DD/MM/YYYY')
                        || COALESCE(': ' || btrim(p_observacao), ''),
           updated_at = now()
     WHERE id = p_demissao_id;

    RETURN jsonb_build_object('ok', true, 'status', 'Recusado', 'funcionario', v_d.nome_funcionario);
  END IF;

  SELECT user_profile_id INTO v_profile_id
    FROM public.funcionarios WHERE id = v_d.funcionario_id FOR UPDATE;

  IF v_profile_id IS NOT NULL AND v_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode aprovar o próprio desligamento.' USING ERRCODE = 'P0001';
  END IF;

  -- Recalcula na aprovação: o valor que vale é o do momento da decisão.
  v_calc := public.calcular_rescisao(
    v_d.funcionario_id, v_d.tipo, v_d.data_desligamento, v_d.aviso_previo);

  v_rescisao_id := public.rescisao_gravar(
    v_d.id, v_d.funcionario_id, v_profile_id, v_d.filial, v_calc);

  UPDATE public.demissoes
     SET status = 'Aprovado',
         decidido_por = auth.uid(),
         decidido_por_nome = v_quem,
         observacao = CASE
           WHEN COALESCE(btrim(p_observacao), '') = '' THEN observacao
           ELSE COALESCE(observacao || ' · ', '') || btrim(p_observacao)
         END,
         updated_at = now()
   WHERE id = p_demissao_id;

  UPDATE public.funcionarios
     SET status = 'Desligado', updated_at = now()
   WHERE id = v_d.funcionario_id;

  PERFORM public._aplicar_desligado_em(v_profile_id, now());

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'Aprovado',
    'funcionario', v_d.nome_funcionario,
    'rescisao_id', v_rescisao_id,
    'acesso_cortado', v_profile_id IS NOT NULL,
    'rescisao', v_calc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.decidir_desligamento(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_desligamento(uuid, boolean, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.readmitir_funcionario(
  p_funcionario_id uuid,
  p_motivo         text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role       text;
  v_nome       text;
  v_profile_id uuid;
  v_demissao   record;
  v_paga       boolean;
BEGIN
  PERFORM public._assert_rpc();

  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO podem readmitir.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, user_profile_id INTO v_nome, v_profile_id
    FROM public.funcionarios WHERE id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_demissao
    FROM public.demissoes
   WHERE funcionario_id = p_funcionario_id AND ativo AND status = 'Aprovado'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '% não está desligado.', v_nome USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rescisoes
     WHERE demissao_id = v_demissao.id AND ativo AND status = 'Paga'
  ) INTO v_paga;

  UPDATE public.demissoes
     SET ativo = false,
         observacao = COALESCE(observacao || ' · ', '')
                      || 'Readmitido em '
                      || to_char((now() AT TIME ZONE 'America/Rio_Branco')::date, 'DD/MM/YYYY')
                      || COALESCE(': ' || btrim(p_motivo), ''),
         updated_at = now()
   WHERE id = v_demissao.id;

  UPDATE public.rescisoes
     SET ativo = false, updated_at = now()
   WHERE demissao_id = v_demissao.id AND ativo;

  UPDATE public.funcionarios
     SET status = 'Ativo', updated_at = now()
   WHERE id = p_funcionario_id;

  -- A devolução do acesso, pela porta nomeada (migr. 493).
  PERFORM public._aplicar_desligado_em(v_profile_id, NULL);

  RETURN jsonb_build_object(
    'ok', true,
    'funcionario', v_nome,
    'acesso_devolvido', v_profile_id IS NOT NULL,
    'rescisao_paga', v_paga
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.readmitir_funcionario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.readmitir_funcionario(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA (rodar depois de aplicar)
--
-- 1. A porta clandestina continua fechada — deve dar 42501:
--    DO $x$ DECLARE v uuid; BEGIN
--      PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
--      SELECT id INTO v FROM user_profiles LIMIT 1;
--      UPDATE user_profiles SET desligado_em = now() WHERE id = v;
--    END $x$;
--
-- 2. A porta do RH abriu — deve passar (e some no ROLLBACK):
--    BEGIN;
--      SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
--      SELECT _aplicar_desligado_em(
--        (SELECT id FROM user_profiles WHERE role='admin' LIMIT 1), NULL);
--    ROLLBACK;
--
-- 3. A flag não vaza da transação:
--    SELECT current_setting('app.desligamento_rh', true);  -- NULL ou 'false'
-- ════════════════════════════════════════════════════════════════════════════
