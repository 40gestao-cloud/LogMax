-- 315_20260730_vaga_matriz_e_role_alvo.sql
--
-- Processo seletivo para cargos da Matriz (CEO, Conselheiro, Gerente).
--
-- DOIS BURACOS QUE A 311–314 DEIXOU:
--
--  1) Vaga da Matriz não nascia. `vagas.filial` é NOT NULL e o formulário só
--     oferecia as 3 unidades operacionais. No banco nunca houve CHECK proibindo
--     'Matriz' — o bloqueio era só a lista do front —, mas também não havia
--     guard dizendo que vaga de holding é decisão de holding. Esta migração
--     torna as duas coisas explícitas.
--
--  2) Promover a Gerente/CEO/Conselheiro não mexia no acesso, e ninguém era
--     avisado. `efetivar_promocao` troca cargo/salário/filial em `funcionarios`,
--     mas `user_profiles.role` só muda por service_role (trigger da 258, e está
--     certo). O resultado silencioso: pessoa com cargo novo e poder velho.
--     A pendência de acesso existia só para troca de UNIDADE.
--
-- O ELO QUE AMARRA OS DOIS. `/api/users` recusa `filial = 'Matriz'` para quem
-- é colaborador ou gerente (users.ts:252). Então mover alguém para a Matriz sem
-- promover a role junto é uma pendência impossível de fechar — o ajuste seria
-- recusado pela API para sempre. Por isso `role_alvo` e `filial = 'Matriz'`
-- andam juntos por CHECK, e não por convenção.
--
-- CARGO ≠ ROLE, ainda. `vagas.cargo` continua texto livre (o cargo de RH);
-- `role_alvo` é o nível de acesso, declarado de propósito por quem abre a vaga.
-- Inferir um do outro por parecença de texto seria adivinhar privilégio.
--
-- ORDEM DE APLICAÇÃO: ESTA MIGRAÇÃO PRIMEIRO, DEPOIS O DEPLOY.
--
-- `abrir_vaga_interna` ganha `p_role_alvo` e a assinatura antiga é dropada (o
-- PostgREST recusa função sobrecarregada — PGRST203). Como o parâmetro novo tem
-- DEFAULT e o supabase-js chama por nome, o front ANTIGO continua funcionando
-- depois desta migração. O contrário não vale: se o deploy sair antes, a
-- chamada com `p_role_alvo` bate numa função que ainda não existe (PGRST202).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — COLUNAS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vagas
  ADD COLUMN IF NOT EXISTS role_alvo text;

COMMENT ON COLUMN public.vagas.role_alvo IS
  'Nível de acesso (RBAC) que a vaga concede, distinto de `cargo` (que é o cargo de RH). NULL = não mexe no acesso. Migr. 315.';

DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_role_alvo
    CHECK (role_alvo IS NULL OR role_alvo IN ('colaborador', 'gerente', 'ceo', 'conselheiro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- `ceo`/`conselheiro` são papéis de holding: existem na Matriz e só lá. E vaga
-- da Matriz que mexe em acesso não pode entregar role operacional, porque
-- `/api/users` recusaria a filial depois. Um CHECK, os dois sentidos.
DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_role_matriz
    CHECK (
      role_alvo IS NULL
      OR (filial = 'Matriz'  AND role_alvo IN ('ceo', 'conselheiro'))
      OR (filial <> 'Matriz' AND role_alvo IN ('colaborador', 'gerente'))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Mudar acesso é promoção de gente que já está na casa. Contratação externa
-- cria o login do zero em "Criar acesso", que já escolhe role e setor.
DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_role_so_interna
    CHECK (role_alvo IS NULL OR tipo = 'Interna');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- E o inverso: vaga da Matriz SEM `role_alvo` seria uma armadilha. A promoção
-- moveria `funcionarios.filial` para 'Matriz' e a pendência de acesso nasceria
-- impossível de fechar — `/api/users` recusa filial Matriz para colaborador e
-- gerente (users.ts:252), então o login jamais alcançaria o cadastro.
DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_matriz_exige_role
    CHECK (filial <> 'Matriz' OR role_alvo IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.movimentacoes_carreira
  ADD COLUMN IF NOT EXISTS role_anterior text,
  ADD COLUMN IF NOT EXISTS role_nova     text;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — GUARD: VAGA DA MATRIZ É DECISÃO DA HOLDING
--
-- `_assert_recrutamento('Matriz')` sozinho já barra o RH de unidade (o
-- `auth_pode_filial('Matriz')` só passa para admin/CEO/conselheiro), mas deixa
-- passar conselheiro — que não abre vaga em lugar nenhum. `_assert_interfilial`
-- é a régua certa e já é a usada para puxar gente entre unidades.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._assert_vaga_matriz(p_filial text, p_role_alvo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF p_filial = 'Matriz' THEN
    PERFORM public._assert_interfilial();
  END IF;

  -- Conceder acesso é sempre da holding, mesmo numa vaga de unidade: promover
  -- alguém a `gerente` da SuperMax muda o que essa pessoa enxerga da SuperMax
  -- inteira, e isso não é decisão do RH dela.
  IF p_role_alvo IS NOT NULL THEN
    PERFORM public._assert_interfilial();
  END IF;
END;
$function$;

REVOKE ALL  ON FUNCTION public._assert_vaga_matriz(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_vaga_matriz(text, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — ABRIR VAGA
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 Externa: só ganha o guard de Matriz (não tem role_alvo, por CHECK).
CREATE OR REPLACE FUNCTION public.abrir_vaga(
  p_filial        text,
  p_cargo         text,
  p_justificativa text,
  p_departamento  text    DEFAULT NULL,
  p_quantidade    integer DEFAULT 1,
  p_salario_min   numeric DEFAULT NULL,
  p_salario_max   numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id   uuid;
  v_nome text;
BEGIN
  PERFORM public._assert_recrutamento(p_filial);
  PERFORM public._assert_vaga_matriz(p_filial, NULL);

  IF COALESCE(btrim(p_cargo), '') = '' THEN
    RAISE EXCEPTION 'Informe o cargo da vaga.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(p_justificativa), '') = '' THEN
    RAISE EXCEPTION 'Justifique o pedido de headcount.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  IF p_salario_min IS NOT NULL AND p_salario_max IS NOT NULL AND p_salario_min > p_salario_max THEN
    RAISE EXCEPTION 'Salário mínimo não pode ser maior que o máximo.' USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.vagas
    (filial, cargo, departamento, quantidade, salario_min, salario_max,
     justificativa, criado_por, criado_por_nome)
  VALUES
    (p_filial, btrim(p_cargo), p_departamento, p_quantidade,
     p_salario_min, p_salario_max, btrim(p_justificativa), auth.uid(), v_nome)
  RETURNING id INTO v_id;

  PERFORM public.notificar_setor(
    'rh', 'aprovacao', 'Nova vaga aguardando aprovação',
    v_nome || ' pediu ' || p_quantidade || 'x ' || btrim(p_cargo) || ' (' || p_filial || ')',
    'rh-recrutamentoeseleção', 'Média', v_id, NULL, p_filial
  );

  RETURN jsonb_build_object('ok', true, 'vaga_id', v_id);
END;
$function$;

REVOKE ALL  ON FUNCTION public.abrir_vaga(text, text, text, text, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_vaga(text, text, text, text, integer, numeric, numeric) TO authenticated;

-- 3.2 Interna: ganha `p_role_alvo`. A assinatura antiga sai de cena.
DROP FUNCTION IF EXISTS public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric);

CREATE OR REPLACE FUNCTION public.abrir_vaga_interna(
  p_filial        text,
  p_cargo         text,
  p_justificativa text,
  p_departamento  text    DEFAULT NULL,
  p_escopo        text    DEFAULT 'Filial',
  p_quantidade    integer DEFAULT 1,
  p_salario_min   numeric DEFAULT NULL,
  p_salario_max   numeric DEFAULT NULL,
  p_nota_minima   numeric DEFAULT NULL,
  p_role_alvo     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id   uuid;
  v_nome text;
BEGIN
  IF p_escopo NOT IN ('Filial', 'Interfilial') THEN
    RAISE EXCEPTION 'Escopo inválido: %. Use Filial ou Interfilial.', p_escopo
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_recrutamento(p_filial);
  PERFORM public._assert_vaga_matriz(p_filial, p_role_alvo);

  IF p_escopo = 'Interfilial' THEN
    PERFORM public._assert_interfilial();
  END IF;

  IF COALESCE(btrim(p_cargo), '') = '' THEN
    RAISE EXCEPTION 'Informe o cargo da vaga.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(p_justificativa), '') = '' THEN
    RAISE EXCEPTION 'Justifique a abertura do processo interno.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  IF p_salario_min IS NOT NULL AND p_salario_max IS NOT NULL AND p_salario_min > p_salario_max THEN
    RAISE EXCEPTION 'Salário mínimo não pode ser maior que o máximo.' USING ERRCODE = 'P0001';
  END IF;

  IF p_nota_minima IS NOT NULL AND (p_nota_minima < 1 OR p_nota_minima > 5) THEN
    RAISE EXCEPTION 'Nota mínima deve estar entre 1 e 5 (escala da avaliação).'
      USING ERRCODE = 'P0001';
  END IF;

  -- Vaga da Matriz com escopo Filial só enxergaria os poucos já lotados lá, e
  -- o ponto de um processo de holding é justamente buscar nas unidades.
  IF p_filial = 'Matriz' AND p_escopo <> 'Interfilial' THEN
    RAISE EXCEPTION 'Vaga da Matriz precisa de escopo Interfilial — os candidatos vêm das unidades.'
      USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.vagas
    (filial, cargo, departamento, tipo, escopo, quantidade, salario_min, salario_max,
     nota_minima, role_alvo, justificativa, criado_por, criado_por_nome)
  VALUES
    (p_filial, btrim(p_cargo), p_departamento, 'Interna', p_escopo,
     p_quantidade, p_salario_min, p_salario_max,
     p_nota_minima, p_role_alvo, btrim(p_justificativa), auth.uid(), v_nome)
  RETURNING id INTO v_id;

  PERFORM public.notificar_setor(
    'rh', 'aprovacao', 'Processo interno aguardando aprovação',
    v_nome || ' abriu ' || p_quantidade || 'x ' || btrim(p_cargo)
      || ' (' || p_filial || ', ' || p_escopo || ')'
      || COALESCE(' · nota mínima ' || p_nota_minima, '')
      || COALESCE(' · concede acesso ' || p_role_alvo, ''),
    'rh-recrutamentoeseleção', 'Média', v_id, NULL, p_filial
  );

  RETURN jsonb_build_object('ok', true, 'vaga_id', v_id, 'escopo', p_escopo);
END;
$function$;

REVOKE ALL  ON FUNCTION public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric, numeric, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4 — EFETIVAR A PROMOÇÃO REGISTRANDO A PENDÊNCIA DE ROLE
--
-- Muda só o miolo do acesso: `acesso_pendente` passa a significar "há algo a
-- ajustar no login", que agora pode ser a unidade, a role, ou as duas. A tela
-- já filtra por essa flag — nada quebra do lado de lá.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.efetivar_promocao(
  p_candidatura_id uuid,
  p_salario        numeric,
  p_data_efeito    date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c           record;
  v_vaga        record;
  v_f           record;
  v_mov_id      uuid;
  v_nome        text;
  v_tipo        text;
  v_data        date;
  v_promovidos  int;
  v_muda_filial boolean;
  v_role_atual  text;
  v_muda_role   boolean;
  v_pendente    boolean;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_c FROM public.candidaturas
   WHERE id = p_candidatura_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidatura não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_c.funcionario_origem_id IS NULL THEN
    RAISE EXCEPTION 'Esta candidatura é externa — use efetivar_contratacao.' USING ERRCODE = 'P0001';
  END IF;

  IF v_c.etapa <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só é possível promover candidatura na etapa Aprovado (esta está %).', v_c.etapa
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vaga FROM public.vagas WHERE id = v_c.vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga da candidatura não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.status NOT IN ('Aprovada', 'Preenchida') THEN
    RAISE EXCEPTION 'Vaga não está mais disponível (status %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_f FROM public.funcionarios
   WHERE id = v_c.funcionario_origem_id AND COALESCE(ativo, true) FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário da candidatura não encontrado ou inativo.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes WHERE funcionario_id = v_f.id AND ativo) THEN
    RAISE EXCEPTION '% foi desligado durante o processo — não há o que promover.', v_f.nome
      USING ERRCODE = 'P0001';
  END IF;

  v_muda_filial := COALESCE(v_f.filial, '') IS DISTINCT FROM v_vaga.filial;

  IF v_muda_filial THEN
    PERFORM public._assert_interfilial();
  END IF;

  -- Entregar poder é da holding, e conferir isto de novo aqui (e não só na
  -- abertura) fecha o caminho de aprovar a vaga e efetivar por outra boca.
  IF v_vaga.role_alvo IS NOT NULL THEN
    PERFORM public._assert_interfilial();
  END IF;

  SELECT count(*) INTO v_promovidos
    FROM public.candidaturas WHERE vaga_id = v_vaga.id AND etapa = 'Promovido';

  IF v_promovidos >= v_vaga.quantidade THEN
    RAISE EXCEPTION 'Vaga já preencheu as % posições aprovadas.', v_vaga.quantidade
      USING ERRCODE = 'P0001';
  END IF;

  IF p_salario IS NULL OR p_salario <= 0 THEN
    RAISE EXCEPTION 'Informe o novo salário.' USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_min IS NOT NULL AND p_salario < v_vaga.salario_min THEN
    RAISE EXCEPTION 'Salário abaixo da faixa aprovada (mínimo %).', v_vaga.salario_min
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_max IS NOT NULL AND p_salario > v_vaga.salario_max THEN
    RAISE EXCEPTION 'Salário acima da faixa aprovada (máximo %).', v_vaga.salario_max
      USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data_efeito, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  SELECT role INTO v_role_atual
    FROM public.user_profiles WHERE id = v_f.user_profile_id;

  v_muda_role := v_vaga.role_alvo IS NOT NULL
                 AND COALESCE(v_role_atual, '') IS DISTINCT FROM v_vaga.role_alvo;

  v_tipo := CASE
    WHEN v_muda_filial AND COALESCE(v_f.cargo, '') IS DISTINCT FROM v_vaga.cargo
      THEN 'Promoção e Transferência'
    WHEN v_muda_filial THEN 'Transferência'
    ELSE 'Promoção'
  END;

  -- Sem login não há acesso a ajustar — a pendência ficaria pendurada para
  -- sempre, porque não existe usuário para mover.
  v_pendente := v_f.user_profile_id IS NOT NULL AND (v_muda_filial OR v_muda_role);

  INSERT INTO public.movimentacoes_carreira (
    funcionario_id, nome_funcionario, vaga_id, candidatura_id, tipo,
    cargo_anterior, cargo_novo, departamento_anterior, departamento_novo,
    salario_anterior, salario_novo, filial_anterior, filial_nova,
    role_anterior, role_nova,
    data_efeito, user_profile_id, acesso_pendente, decidido_por, decidido_por_nome
  ) VALUES (
    v_f.id, v_f.nome, v_vaga.id, p_candidatura_id, v_tipo,
    v_f.cargo, v_vaga.cargo,
    v_f.departamento, COALESCE(v_vaga.departamento, v_f.departamento),
    v_f.salario, p_salario,
    COALESCE(v_f.filial, v_vaga.filial), v_vaga.filial,
    v_role_atual, v_vaga.role_alvo,
    v_data, v_f.user_profile_id, v_pendente, auth.uid(), v_nome
  )
  RETURNING id INTO v_mov_id;

  UPDATE public.funcionarios
     SET cargo        = v_vaga.cargo,
         departamento = COALESCE(v_vaga.departamento, departamento),
         salario      = p_salario,
         filial       = v_vaga.filial,
         updated_at   = now()
   WHERE id = v_f.id;

  UPDATE public.candidaturas
     SET etapa = 'Promovido', funcionario_id = v_f.id, updated_at = now()
   WHERE id = p_candidatura_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (p_candidatura_id, 'Aprovado', 'Promovido',
          v_tipo || ' em ' || to_char(v_data, 'DD/MM/YYYY')
            || ' — ' || COALESCE(v_f.cargo, 'sem cargo') || ' → ' || v_vaga.cargo
            || COALESCE(' · acesso ' || COALESCE(v_role_atual, 'sem role') || ' → ' || v_vaga.role_alvo, ''),
          auth.uid(), v_nome);

  IF v_promovidos + 1 >= v_vaga.quantidade THEN
    UPDATE public.vagas SET status = 'Preenchida', updated_at = now() WHERE id = v_vaga.id;
  END IF;

  IF v_pendente THEN
    PERFORM public.notificar_setor(
      'rh', 'alerta', 'Acesso pendente após promoção',
      v_f.nome || ' agora é ' || v_vaga.cargo
        || CASE WHEN v_muda_filial THEN ' em ' || v_vaga.filial ELSE '' END
        || ', mas o login continua'
        || CASE WHEN v_muda_filial THEN ' em ' || COALESCE(v_f.filial, '—') ELSE '' END
        || CASE WHEN v_muda_role  THEN ' como ' || COALESCE(v_role_atual, 'sem nível') ELSE '' END
        || '. Ajuste em Usuários para o acesso acompanhar.',
      'rh-recrutamentoeseleção', 'Alta', v_mov_id, NULL, v_vaga.filial
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'movimentacao_id', v_mov_id,
    'funcionario_id', v_f.id,
    'tipo', v_tipo,
    'user_profile_id', v_f.user_profile_id,
    'filial_anterior', v_f.filial,
    'filial_nova', v_vaga.filial,
    'role_anterior', v_role_atual,
    'role_nova', v_vaga.role_alvo,
    'acesso_pendente', v_pendente,
    'vaga_preenchida', (v_promovidos + 1 >= v_vaga.quantidade)
  );
END;
$function$;

REVOKE ALL  ON FUNCTION public.efetivar_promocao(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.efetivar_promocao(uuid, numeric, date) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 5 — FECHAR A PENDÊNCIA CONFERINDO AS DUAS PONTAS
--
-- Mesma filosofia da 312: não aceita "já ajustei" como verdade. Agora relê
-- filial E role, porque fechar a pendência vendo só metade é o mesmo que não
-- conferir nada.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.marcar_acesso_ajustado(p_movimentacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_m            record;
  v_filial_atual text;
  v_role_atual   text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_m FROM public.movimentacoes_carreira
   WHERE id = p_movimentacao_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimentação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_m.filial_nova);

  IF NOT v_m.acesso_pendente THEN
    RETURN jsonb_build_object('ok', true, 'acesso_pendente', false, 'ja_estava', true);
  END IF;

  IF v_m.user_profile_id IS NULL THEN
    UPDATE public.movimentacoes_carreira
       SET acesso_pendente = false, updated_at = now()
     WHERE id = p_movimentacao_id;
    RETURN jsonb_build_object('ok', true, 'acesso_pendente', false, 'sem_login', true);
  END IF;

  SELECT filial, role INTO v_filial_atual, v_role_atual
    FROM public.user_profiles WHERE id = v_m.user_profile_id;

  IF COALESCE(v_filial_atual, '') IS DISTINCT FROM v_m.filial_nova THEN
    RAISE EXCEPTION
      'O login ainda está em % — ajuste a filial em Usuários antes de fechar a pendência.',
      COALESCE(v_filial_atual, 'nenhuma unidade')
      USING ERRCODE = 'P0001';
  END IF;

  IF v_m.role_nova IS NOT NULL AND COALESCE(v_role_atual, '') IS DISTINCT FROM v_m.role_nova THEN
    RAISE EXCEPTION
      'O login ainda tem nível % — ajuste para % em Usuários antes de fechar a pendência.',
      COALESCE(v_role_atual, 'nenhum'), v_m.role_nova
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.movimentacoes_carreira
     SET acesso_pendente = false, updated_at = now()
   WHERE id = p_movimentacao_id;

  RETURN jsonb_build_object('ok', true, 'acesso_pendente', false);
END;
$function$;

REVOKE ALL  ON FUNCTION public.marcar_acesso_ajustado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_acesso_ajustado(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- 1. Vaga da Matriz exige escopo Interfilial e role de holding:
--   SELECT public.abrir_vaga_interna(
--     'Matriz', 'Diretor de Operações', 'Sucessão do conselho',
--     NULL, 'Interfilial', 1, NULL, NULL, NULL, 'conselheiro');
--
--   -- 2. Combinação inválida deve estourar o CHECK (role de holding em unidade):
--   UPDATE vagas SET role_alvo = 'ceo' WHERE filial = 'SuperMax';  -- erro
--
--   -- 3. Depois de efetivar, a pendência deve apontar a role:
--   SELECT nome_funcionario, filial_anterior, filial_nova,
--          role_anterior, role_nova, acesso_pendente
--     FROM movimentacoes_carreira ORDER BY created_at DESC LIMIT 1;
--
--   -- 4. Fechar sem ajustar o acesso deve ser recusado:
--   SELECT public.marcar_acesso_ajustado('<movimentacao_id>');     -- erro
-- =================================================================
