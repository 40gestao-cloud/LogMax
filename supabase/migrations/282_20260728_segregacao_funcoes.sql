-- 282 — Segregação de funções: a régua vertical
--
-- Fecha as 4 transições em que lançador e decisor eram a mesma pessoa
-- (Etapa 8 da auditoria de veracidade).
--
-- Premissa que define o desenho: cada filial tem UMA pessoa por setor. Não
-- existe "outro analista do mesmo setor" para conferir — segregação horizontal
-- é impossível por construção. A régua adotada é vertical, como em empresa
-- pequena de verdade:
--
--   colaborador lança  → gerente da filial decide
--   gerente lança      → Matriz decide (admin/CEO/conselho)
--   ninguém decide sobre si mesmo
--   acima da alçada    → sobe um nível
--
-- Onde a regra vive: TRIGGER, não policy. A policy diz quem pode escrever na
-- tabela; a transição de status é que precisa de autoridade, e o trigger
-- alcança também quem escreve por fora da tela.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. FOLHA — quem processa não paga
--
-- RH fecha a folha (`processar_folha` gera a conta a pagar); o pagamento é do
-- Financeiro, como o de qualquer outra conta. O caminho canônico passa a ser
-- Contas a Pagar → `registrar_pagamento_conta`, e o trigger
-- `conta_pagar_avancar_folha_e_creditar` leva a folha a 'Paga' e credita o
-- MaxBank sozinho. `pagar_folha` continua existindo como via direta, mas agora
-- exige Financeiro (admin/CEO e gerente passam pelo `auth_in_setor`).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pagar_folha(p_folha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial text;
BEGIN
  -- Era 'rh': quem processava também pagava.
  PERFORM public._assert_rpc('financeiro');

  SELECT filial INTO v_filial FROM public.folha_pagamento WHERE id = p_folha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Folha de outra filial.' USING ERRCODE = '42501';
  END IF;

  RETURN public._folha_creditar_e_avancar(p_folha_id, NULL, 'rpc_financeiro');
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. REQUISIÇÃO DE COMPRA — Compras executa, não aprova
--
-- Estava invertido: o setor `compras` criava a requisição e o setor `compras`
-- aprovava. Agora quem decide é o gerente da filial (ou a Matriz), e nunca
-- quem abriu a requisição.
--
-- A decisão também deixa de ser dois UPDATE soltos do .tsx com rollback
-- best-effort (P6): `decidir_requisicao_compra` faz aprovação + requisição +
-- cascata de cotações numa transação só.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.requisicao_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só a transição de decisão é gate. Demais updates seguem a policy.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem abre a requisição não a aprova. A decisão é do gerente da filial.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.auth_gerente_da(NEW.filial) THEN
    RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) decide requisição de compra.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_requisicao_decisao_guard ON public.requisicoes;
CREATE TRIGGER trg_requisicao_decisao_guard
  BEFORE UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.requisicao_decisao_guard();

CREATE OR REPLACE FUNCTION public.decidir_requisicao_compra(
  p_aprovacao_id uuid,
  p_decisao      text,
  p_observacao   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ap          record;
  v_req         record;
  v_canceladas  integer := 0;
BEGIN
  PERFORM public._assert_rpc();

  IF p_decisao NOT IN ('Aprovado', 'Negado') THEN
    RAISE EXCEPTION 'Decisão inválida: use Aprovado ou Negado.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisao = 'Negado' AND COALESCE(trim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Negar exige justificativa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.aprovacoes_compras
   WHERE id = p_aprovacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aprovação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_ap.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta requisição já foi decidida (%).', v_ap.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = v_ap.requisicao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- Autoridade: gerente da filial da requisição, ou Matriz. Nunca o autor.
  IF NOT public.auth_is_admin() THEN
    IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem abre a requisição não a aprova. A decisão é do gerente da filial.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.auth_gerente_da(v_req.filial) THEN
      RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) decide requisição de compra.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.aprovacoes_compras
     SET status     = p_decisao,
         observacao = COALESCE(p_observacao, ''),
         aprovador  = COALESCE(
           (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
           aprovador)
   WHERE id = p_aprovacao_id;

  UPDATE public.requisicoes
     SET status = p_decisao
   WHERE id = v_req.id;

  -- Cascata do Negado: cotação viva de requisição negada não pode seguir
  -- para o Financeiro. A que já virou pedido fica — ali há compromisso com o
  -- fornecedor, e quem desfaz é o Pedidos.
  IF p_decisao = 'Negado' THEN
    WITH canceladas AS (
      UPDATE public.cotacoes c
         SET status = 'Cancelado'
       WHERE c.requisicao_id = v_req.id
         AND COALESCE(c.ativo, true)
         AND c.status IN ('Aguardando Financeiro', 'Aprovado')
         AND NOT EXISTS (
           SELECT 1 FROM public.pedidos p
            WHERE p.cotacao_id = c.id AND COALESCE(p.ativo, true))
      RETURNING 1
    )
    SELECT count(*) INTO v_canceladas FROM canceladas;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_decisao,
    'requisicao_id', v_req.id,
    'cotacoes_canceladas', v_canceladas
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.decidir_requisicao_compra(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_requisicao_compra(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. COTAÇÃO — a régua sai do React e vira trigger
--
-- A tela já aplicava a coisa certa (alçada por valor + "quem cadastrou não
-- aprova"). O banco não sabia de nada disso: a policy deixava compras,
-- logística, financeiro e o gerente atualizarem qualquer linha. Regra de
-- negócio que mora só no .tsx é regra que alguém passa por fora.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cotacao_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limite numeric;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  -- Matriz: override total. É a saída quando não há outro aprovador na filial.
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = auth.uid()
       AND (p.role IN ('admin', 'ceo', 'conselheiro')
            OR (p.role = 'gerente' AND p.is_conselheiro = true))
  ) THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem cadastra a proposta não a aprova.'
      USING ERRCODE = '42501';
  END IF;

  SELECT valor_limite_financeiro INTO v_limite
    FROM public.alcadas_compra
   WHERE filial = NEW.filial AND COALESCE(ativo, true);

  -- Alçada não configurada = limite infinito = Financeiro decide. Um caminho
  -- só, igual à tela.
  IF v_limite IS NULL OR COALESCE(NEW.valor_total, 0) <= v_limite THEN
    IF NOT public.auth_in_setor('financeiro') THEN
      RAISE EXCEPTION 'Dentro da alçada, quem decide a cotação é o Financeiro.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT public.auth_gerente_da(NEW.filial) THEN
      RAISE EXCEPTION 'Acima da alçada da filial, quem decide é o gerente (ou a Matriz).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cotacao_decisao_guard ON public.cotacoes;
CREATE TRIGGER trg_cotacao_decisao_guard
  BEFORE UPDATE ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.cotacao_decisao_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. FÉRIAS — ninguém aprova as próprias
--
-- `ferias_rh_all` dá ALL para o setor RH na filial inteira, e a própria linha
-- do RH está dentro dessa filial. Régua nova: colaborador → RH ou gerente;
-- titular do RH → gerente (ou Matriz); titular gerente → Matriz.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ferias_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_titular_uid   uuid;
  v_titular_role  text;
  v_titular_setor text;
  v_titular_extras text[];
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT up.id, up.role, up.setor, COALESCE(up.setores_extras, ARRAY[]::text[])
    INTO v_titular_uid, v_titular_role, v_titular_setor, v_titular_extras
    FROM public.funcionarios f
    JOIN public.user_profiles up ON up.id = f.user_profile_id
   WHERE f.id = NEW.funcionario_id;

  IF v_titular_uid IS NOT NULL AND v_titular_uid = auth.uid() THEN
    RAISE EXCEPTION 'Ninguém aprova as próprias férias — a decisão é do nível acima.'
      USING ERRCODE = '42501';
  END IF;

  -- Férias de gerente sobem para a Matriz.
  IF v_titular_role = 'gerente' THEN
    RAISE EXCEPTION 'Férias de gerente são decididas pela Matriz (admin ou CEO).'
      USING ERRCODE = '42501';
  END IF;

  -- Titular do RH: quem decide é o gerente da filial, não o próprio RH.
  IF v_titular_setor = 'rh' OR 'rh' = ANY(v_titular_extras) THEN
    IF NOT public.auth_gerente_da(NEW.filial) THEN
      RAISE EXCEPTION 'Férias de quem é do RH são decididas pelo gerente da filial.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Caso geral: RH da filial ou gerente, como já era.
  IF NOT (public.auth_in_setor('rh') OR public.auth_gerente_da(NEW.filial)) THEN
    RAISE EXCEPTION 'Só o RH ou o gerente da filial decidem férias.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ferias_decisao_guard ON public.ferias;
CREATE TRIGGER trg_ferias_decisao_guard
  BEFORE UPDATE ON public.ferias
  FOR EACH ROW EXECUTE FUNCTION public.ferias_decisao_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Superfícies largas de INSERT (Etapa 8)
--
-- Três policies aceitavam INSERT sem olhar filial. O caminho da tela passa por
-- RPC com guard; o INSERT direto, não.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS compras_insert ON public.requisicoes;
CREATE POLICY compras_insert ON public.requisicoes
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_pode_filial(filial));

DROP POLICY IF EXISTS logist_insert ON public.requisicoes_estoque;
CREATE POLICY logist_insert ON public.requisicoes_estoque
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_pode_filial(filial));

DROP POLICY IF EXISTS compras_insert ON public.aprovacoes_compras;
CREATE POLICY compras_insert ON public.aprovacoes_compras
  FOR INSERT TO authenticated
  WITH CHECK (status = 'Pendente' AND public.auth_pode_filial(filial));

COMMIT;

NOTIFY pgrst, 'reload schema';
