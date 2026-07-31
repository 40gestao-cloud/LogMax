-- 311 — Recrutamento & Seleção (Fase 1: vagas + aprovação da Matriz + funil externo).
--
-- O ciclo do colaborador tinha rescisão auditável (306/307) mas nascia num
-- INSERT cru em `funcionarios` — sem vaga, sem headcount aprovado, sem
-- candidato e sem alçada sobre o salário de admissão. Esta migração fecha a
-- ENTRADA do mesmo jeito que a 306/307 fecharam a saída.
--
-- TRÊS TABELAS:
--   vagas               — o pedido de headcount. Nasce 'Aguardando Matriz',
--                          só admin/CEO decide (mesma régua da 292/307:
--                          quem lança não aprova).
--   candidaturas        — quem se candidatou a uma vaga aprovada.
--   candidatura_etapas  — histórico append-only de cada mudança de etapa.
--
-- ESCOPO DESTA FASE. `vagas.tipo` só aceita 'Externa' — Processo Seletivo
-- Interno (promoção, inclusive entre filiais) muda `role`/filial de quem já
-- está no sistema, esbarra no trigger de privilégio da 258 e é decisão de
-- Matriz por definição (régua canônica Matriz/Filial). Fica para a Fase 2,
-- que só ALTERa o CHECK — mesmo padrão de `chk_afastamento_status` (292).
--
-- SEM UPLOAD DE CURRÍCULO. Candidato externo não é usuário do sistema; abrir
-- um bucket novo para PII de quem não está no banco reabre o hardening da
-- 257. `link_curriculo` (texto) resolve o didático nesta fase.
--
-- SALÁRIO: a vaga define uma FAIXA (justificativa de headcount); o valor
-- exato só é fixado em `efetivar_contratacao`, validado contra a faixa —
-- mesmo motivo de `cargos.salario_base` em FuncionariosView: decisão de
-- headcount e decisão de valor individual são momentos diferentes.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — TABELAS
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vagas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial             text NOT NULL,
  cargo              text NOT NULL,
  departamento       text,
  tipo               text NOT NULL DEFAULT 'Externa',
  quantidade         integer NOT NULL DEFAULT 1,
  salario_min        numeric(12,2),
  salario_max        numeric(12,2),
  justificativa      text NOT NULL,
  status             text NOT NULL DEFAULT 'Aguardando Matriz',
  criado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome    text,
  decidido_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por_nome  text,
  decidido_em        timestamptz,
  motivo_decisao     text,
  ativo              boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_tipo CHECK (tipo IN ('Externa'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_status
    CHECK (status IN ('Aguardando Matriz', 'Aprovada', 'Negada', 'Preenchida', 'Cancelada'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_quantidade CHECK (quantidade > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_salario_faixa
    CHECK (salario_min IS NULL OR salario_max IS NULL OR salario_min <= salario_max);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_vagas_filial ON public.vagas (filial);
CREATE INDEX IF NOT EXISTS idx_vagas_status ON public.vagas (status) WHERE ativo;

COMMENT ON COLUMN public.vagas.tipo IS
  'Só ''Externa'' na Fase 1. Interno (promoção) chega na Fase 2 ampliando este CHECK.';

CREATE TABLE IF NOT EXISTS public.candidaturas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vaga_id            uuid NOT NULL REFERENCES public.vagas(id) ON DELETE CASCADE,
  filial             text NOT NULL,
  nome               text NOT NULL,
  cpf                text,
  email              text,
  telefone           text,
  link_curriculo     text,
  etapa              text NOT NULL DEFAULT 'Triagem',
  parecer            text,
  funcionario_id     uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  criado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome    text,
  ativo              boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.candidaturas ADD CONSTRAINT chk_candidatura_etapa
    CHECK (etapa IN ('Triagem', 'Entrevista', 'Teste', 'Aprovado', 'Reprovado', 'Contratado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Uma pessoa não se candidata duas vezes à mesma vaga (CPF é o identificador
-- de quem ainda não tem cadastro no sistema). Parcial + ativo, no mesmo
-- padrão de controle_caixa ([[feedback_partial_unique_soft_delete]]).
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidatura_vaga_cpf
  ON public.candidaturas (vaga_id, cpf) WHERE ativo AND cpf IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidaturas_vaga   ON public.candidaturas (vaga_id);
CREATE INDEX IF NOT EXISTS idx_candidaturas_filial  ON public.candidaturas (filial);

CREATE TABLE IF NOT EXISTS public.candidatura_etapas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidatura_id        uuid NOT NULL REFERENCES public.candidaturas(id) ON DELETE CASCADE,
  etapa_anterior        text,
  etapa_nova            text NOT NULL,
  observacao            text,
  registrado_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  registrado_por_nome   text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidatura_etapas_candidatura
  ON public.candidatura_etapas (candidatura_id);

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — RLS
--
-- Mesmo padrão da 190 (funcionarios): RH ou gerente da própria filial operam;
-- Matriz (auth_pode_filial cobre admin/CEO/conselheiro) enxerga tudo. Sem
-- policy de INSERT/UPDATE/DELETE nas 3 tabelas — escrita só pelas RPCs
-- SECURITY DEFINER abaixo, mesmo motivo da 307: decisão de headcount e de
-- contratação não pode ser um POST solto do DevTools.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vagas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidaturas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidatura_etapas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vagas_select ON public.vagas;
CREATE POLICY vagas_select ON public.vagas FOR SELECT TO authenticated
  USING (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  );

DROP POLICY IF EXISTS candidaturas_select ON public.candidaturas;
CREATE POLICY candidaturas_select ON public.candidaturas FOR SELECT TO authenticated
  USING (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  );

DROP POLICY IF EXISTS candidatura_etapas_select ON public.candidatura_etapas;
CREATE POLICY candidatura_etapas_select ON public.candidatura_etapas FOR SELECT TO authenticated
  USING (
    EXISTS (
      -- Qualificado como `candidatura_etapas.candidatura_id` de propósito:
      -- sem isso o nome resolveria pela subquery primeiro, e bastaria
      -- `candidaturas` ganhar uma coluna com esse nome para a policy passar
      -- a comparar a linha errada — em silêncio.
      SELECT 1 FROM public.candidaturas c
       WHERE c.id = candidatura_etapas.candidatura_id
         AND (public.auth_in_setor('rh') OR public.auth_gerente_da(c.filial))
         AND public.auth_pode_filial(c.filial)
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — RPCs
--
-- GATE DE OPERAÇÃO. As RPCs abaixo NÃO usam `_assert_rpc('rh')`: aquele gate
-- passa por `auth_in_setor`, que aceita RH e admin mas rejeita gerente — e
-- gerente opera a filial inteira, inclusive o RH dela (é a régua da 185/187 e
-- é literalmente a policy `afast_rh_all` da 190). Com `_assert_rpc('rh')` o
-- gerente enxergaria as vagas pela RLS de SELECT e tomaria 42501 em cada
-- botão: menu aberto, tela cheia, tudo travado.
--
-- O helper abaixo repete a MESMA expressão das policies de SELECT desta
-- migração, para que ler e escrever tenham exatamente a mesma régua.
--
-- COALESCE em toda a expressão: `auth_gerente_da` devolve NULL quando o perfil
-- não tem role (desligado, perfil órfão), e `IF NOT NULL` não dispara —
-- é o buraco que a 308 fechou em `_assert_rpc` ([[feedback_assert_rpc_null]]).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._assert_recrutamento(p_filial text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Autenticação, vínculo ativo e service_role bypass.
  PERFORM public._assert_rpc();

  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF NOT COALESCE(
       (public.auth_in_setor('rh') OR public.auth_gerente_da(p_filial))
       AND public.auth_pode_filial(p_filial),
       false)
  THEN
    RAISE EXCEPTION 'Recrutamento é do RH ou do gerente da unidade %.', p_filial
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Mesma régua de `_assert_rpc` (migr. 260): guard não nasce com o EXECUTE
-- default do PostgreSQL, que é PUBLIC.
REVOKE ALL ON FUNCTION public._assert_recrutamento(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_recrutamento(text) TO authenticated, service_role;

-- 3.1 Abrir vaga (RH ou gerente da filial pede headcount)
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
  v_id    uuid;
  v_nome  text;
BEGIN
  PERFORM public._assert_recrutamento(p_filial);

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
    (p_filial, btrim(p_cargo), p_departamento, p_quantidade, p_salario_min, p_salario_max,
     btrim(p_justificativa), auth.uid(), v_nome)
  RETURNING id INTO v_id;

  PERFORM public.notificar_setor(
    'rh', 'aprovacao', 'Nova vaga aguardando aprovação',
    v_nome || ' pediu ' || p_quantidade || 'x ' || btrim(p_cargo) || ' (' || p_filial || ')',
    'rh-recrutamentoeseleção', 'Média', v_id, NULL, p_filial
  );

  RETURN jsonb_build_object('ok', true, 'vaga_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.abrir_vaga(text, text, text, text, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_vaga(text, text, text, text, integer, numeric, numeric) TO authenticated;

-- 3.2 Decidir vaga (só Matriz: admin/CEO, nunca quem abriu)
CREATE OR REPLACE FUNCTION public.decidir_vaga(
  p_vaga_id  uuid,
  p_aprovar  boolean,
  p_motivo   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role   text;
  v_vaga   record;
  v_quem   text;
  v_status text;
BEGIN
  PERFORM public._assert_rpc();

  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO decidem vaga. Headcount é decisão da Matriz.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_vaga FROM public.vagas WHERE id = p_vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_vaga.status <> 'Aguardando Matriz' THEN
    RAISE EXCEPTION 'Só uma vaga Aguardando Matriz pode ser decidida (esta está %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.criado_por IS NOT NULL AND v_vaga.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem abre a vaga não aprova a própria vaga.' USING ERRCODE = '42501';
  END IF;

  IF NOT p_aprovar AND COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Explique o motivo da negativa.' USING ERRCODE = 'P0001';
  END IF;

  v_quem   := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');
  v_status := CASE WHEN p_aprovar THEN 'Aprovada' ELSE 'Negada' END;

  UPDATE public.vagas
     SET status = v_status,
         decidido_por = auth.uid(), decidido_por_nome = v_quem,
         decidido_em = now(), motivo_decisao = p_motivo,
         updated_at = now()
   WHERE id = p_vaga_id;

  PERFORM public.notificar_setor(
    'rh', 'aprovacao', 'Vaga ' || lower(v_status),
    v_quem || (CASE WHEN p_aprovar THEN ' aprovou ' ELSE ' negou ' END)
      || v_vaga.quantidade || 'x ' || v_vaga.cargo || COALESCE(': ' || p_motivo, ''),
    'rh-recrutamentoeseleção', 'Média', p_vaga_id, p_motivo, v_vaga.filial
  );

  RETURN jsonb_build_object('ok', true, 'status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.decidir_vaga(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_vaga(uuid, boolean, text) TO authenticated;

-- 3.3 Cancelar vaga (RH da filial desiste do pedido antes de preencher)
CREATE OR REPLACE FUNCTION public.cancelar_vaga(p_vaga_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vaga record;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_vaga FROM public.vagas WHERE id = p_vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Gate depois do SELECT: a filial da vaga é que define quem pode mexer nela.
  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.status NOT IN ('Aguardando Matriz', 'Aprovada') THEN
    RAISE EXCEPTION 'Vaga % não pode mais ser cancelada.', v_vaga.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.vagas
     SET status = 'Cancelada', motivo_decisao = COALESCE(p_motivo, motivo_decisao), updated_at = now()
   WHERE id = p_vaga_id;

  RETURN jsonb_build_object('ok', true, 'status', 'Cancelada');
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_vaga(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_vaga(uuid, text) TO authenticated;

-- 3.4 Registrar candidatura (funil externo — só em vaga Aprovada)
CREATE OR REPLACE FUNCTION public.registrar_candidatura(
  p_vaga_id        uuid,
  p_nome           text,
  p_cpf            text DEFAULT NULL,
  p_email          text DEFAULT NULL,
  p_telefone       text DEFAULT NULL,
  p_link_curriculo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vaga  record;
  v_id    uuid;
  v_nome  text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_vaga FROM public.vagas WHERE id = p_vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.status <> 'Aprovada' THEN
    RAISE EXCEPTION 'Só é possível candidatar em vaga Aprovada (esta está %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do candidato.' USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.candidaturas
    (vaga_id, filial, nome, cpf, email, telefone, link_curriculo, criado_por, criado_por_nome)
  VALUES
    (p_vaga_id, v_vaga.filial, btrim(p_nome), NULLIF(btrim(p_cpf), ''), NULLIF(btrim(p_email), ''),
     NULLIF(btrim(p_telefone), ''), NULLIF(btrim(p_link_curriculo), ''), auth.uid(), v_nome)
  RETURNING id INTO v_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, registrado_por, registrado_por_nome)
  VALUES (v_id, NULL, 'Triagem', auth.uid(), v_nome);

  RETURN jsonb_build_object('ok', true, 'candidatura_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_candidatura(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_candidatura(uuid, text, text, text, text, text) TO authenticated;

-- 3.5 Mover candidatura entre etapas do funil
--
-- 'Contratado' fica de fora do CHECK aceito aqui de propósito: só
-- efetivar_contratacao chega lá, porque é ela que cria o funcionário.
CREATE OR REPLACE FUNCTION public.mover_candidatura(
  p_candidatura_id uuid,
  p_etapa          text,
  p_observacao     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c    record;
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_etapa NOT IN ('Triagem', 'Entrevista', 'Teste', 'Aprovado', 'Reprovado') THEN
    RAISE EXCEPTION 'Etapa inválida: %. Use efetivar_contratacao para contratar.', p_etapa
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_c FROM public.candidaturas WHERE id = p_candidatura_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidatura não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_c.filial);

  IF v_c.etapa = 'Contratado' THEN
    RAISE EXCEPTION 'Candidato já contratado — etapa final.' USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  UPDATE public.candidaturas
     SET etapa = p_etapa, parecer = COALESCE(p_observacao, parecer), updated_at = now()
   WHERE id = p_candidatura_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (p_candidatura_id, v_c.etapa, p_etapa, p_observacao, auth.uid(), v_nome);

  RETURN jsonb_build_object('ok', true, 'etapa', p_etapa);
END;
$function$;

REVOKE ALL ON FUNCTION public.mover_candidatura(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mover_candidatura(uuid, text, text) TO authenticated;

-- 3.6 Efetivar contratação — cria o funcionário e fecha a candidatura/vaga
CREATE OR REPLACE FUNCTION public.efetivar_contratacao(
  p_candidatura_id uuid,
  p_salario        numeric,
  p_data_admissao  date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c            record;
  v_vaga         record;
  v_nome         text;
  v_data         date;
  v_funcionario  uuid;
  v_contratados  integer;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_c FROM public.candidaturas WHERE id = p_candidatura_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidatura não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_c.etapa <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só é possível contratar candidatura na etapa Aprovado (esta está %).', v_c.etapa
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vaga FROM public.vagas WHERE id = v_c.vaga_id AND ativo FOR UPDATE;

  -- Sem este NOT FOUND, `v_vaga.status` viria NULL e `IF NULL NOT IN (...)`
  -- não dispararia — a contratação passaria direto e criaria o funcionário
  -- sem vaga por trás. Mesmo padrão do buraco que a 308 fechou.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga da candidatura não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- Gate pela filial da VAGA, que é a mesma gravada no funcionário abaixo.
  -- Checar `v_c.filial` e inserir com `v_vaga.filial` seria validar uma coisa
  -- e escrever outra.
  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.status NOT IN ('Aprovada', 'Preenchida') THEN
    RAISE EXCEPTION 'Vaga não está mais disponível para contratação (status %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Sem filtro por `ativo`: candidatura contratada e depois inativada continua
  -- ocupando a posição, porque o funcionário dela existe de verdade.
  SELECT count(*) INTO v_contratados
    FROM public.candidaturas WHERE vaga_id = v_vaga.id AND etapa = 'Contratado';

  IF v_contratados >= v_vaga.quantidade THEN
    RAISE EXCEPTION 'Vaga já preencheu as % posições aprovadas.', v_vaga.quantidade
      USING ERRCODE = 'P0001';
  END IF;

  IF p_salario IS NULL OR p_salario <= 0 THEN
    RAISE EXCEPTION 'Informe o salário de admissão.' USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_min IS NOT NULL AND p_salario < v_vaga.salario_min THEN
    RAISE EXCEPTION 'Salário abaixo da faixa aprovada (mínimo %).', v_vaga.salario_min
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_max IS NOT NULL AND p_salario > v_vaga.salario_max THEN
    RAISE EXCEPTION 'Salário acima da faixa aprovada (máximo %).', v_vaga.salario_max
      USING ERRCODE = 'P0001';
  END IF;

  -- Duplicata de cadastro. `funcionarios` não tem UNIQUE em CPF nem em email,
  -- e o candidato externo é digitado à mão — contratar duas vezes a mesma
  -- pessoa criaria dois registros, duas folhas e duas rescisões.
  --
  -- O email tem um segundo motivo, mais sério: o trigger
  -- `trg_funcionarios_autovincular` (migr. 151) roda BEFORE INSERT, e se o
  -- email bater com um `user_profiles` existente ele vincula o perfil E
  -- SOBRESCREVE a filial com a daquele perfil. Sem esta checagem, contratar
  -- alguém que já tem login em outra unidade criaria um funcionário na filial
  -- errada — que o RH que acabou de contratar nem enxergaria pela RLS.
  IF v_c.cpf IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.funcionarios
     WHERE cpf = v_c.cpf AND COALESCE(ativo, true) AND COALESCE(status, 'Ativo') <> 'Desligado'
  ) THEN
    RAISE EXCEPTION 'Já existe funcionário ativo com o CPF %.', v_c.cpf
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.funcionarios
     WHERE lower(email) = lower(v_c.email) AND COALESCE(ativo, true) AND COALESCE(status, 'Ativo') <> 'Desligado'
  ) THEN
    RAISE EXCEPTION 'Já existe funcionário ativo com o e-mail %.', v_c.email
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE lower(email) = lower(v_c.email)
       AND filial IS NOT NULL AND filial <> v_vaga.filial
  ) THEN
    RAISE EXCEPTION
      'O e-mail % já tem login em outra unidade. Contratar aqui moveria o cadastro para lá — corrija o e-mail do candidato ou trate como movimentação interna.',
      v_c.email USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data_admissao, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.funcionarios
    (nome, cpf, email, telefone, cargo, departamento, salario, data_admissao, status, filial)
  VALUES
    (v_c.nome, v_c.cpf, v_c.email, v_c.telefone, v_vaga.cargo, v_vaga.departamento,
     p_salario, v_data, 'Ativo', v_vaga.filial)
  RETURNING id INTO v_funcionario;

  UPDATE public.candidaturas
     SET etapa = 'Contratado', funcionario_id = v_funcionario, updated_at = now()
   WHERE id = p_candidatura_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (p_candidatura_id, 'Aprovado', 'Contratado',
          'Admissão em ' || to_char(v_data, 'DD/MM/YYYY') || ' — R$ ' || p_salario,
          auth.uid(), v_nome);

  IF v_contratados + 1 >= v_vaga.quantidade THEN
    UPDATE public.vagas SET status = 'Preenchida', updated_at = now() WHERE id = v_vaga.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'funcionario_id', v_funcionario,
    'vaga_preenchida', (v_contratados + 1 >= v_vaga.quantidade)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.efetivar_contratacao(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.efetivar_contratacao(uuid, numeric, date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Fila de aprovação da Matriz:
--   SELECT filial, cargo, quantidade, status FROM vagas WHERE status = 'Aguardando Matriz';
--
--   -- Funil de uma vaga aprovada:
--   SELECT nome, etapa FROM candidaturas WHERE vaga_id = '<vaga_id>';
--
--   -- Histórico de uma candidatura:
--   SELECT etapa_anterior, etapa_nova, created_at FROM candidatura_etapas
--    WHERE candidatura_id = '<candidatura_id>' ORDER BY created_at;
--
--   -- Contratação gerou o funcionário:
--   SELECT f.nome, f.cargo, f.salario, c.etapa
--     FROM candidaturas c JOIN funcionarios f ON f.id = c.funcionario_id
--    WHERE c.etapa = 'Contratado';
-- ────────────────────────────────────────────────────────────────────────────
