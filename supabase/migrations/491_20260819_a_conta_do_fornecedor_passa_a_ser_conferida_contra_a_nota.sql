-- 491 — Three-way match: pedido × recebimento × nota fiscal.
--
-- Até aqui a `contas_pagar` de compra nascia dentro de `gerar_pedido_de_cotacao`,
-- no instante em que o PEDIDO era emitido, pelo valor da cotação — e ninguém
-- nunca mais voltava naquele número. Faltava o coração do contas a pagar de
-- qualquer ERP:
--
--   • Passivo era reconhecido na emissão do pedido. Pedido é COMPROMISSO; a
--     obrigação nasce com a entrega e a nota. O saldo de "Contas a pagar" que o
--     aluno lia incluía mercadoria que não tinha chegado.
--   • Divergência de preço, frete ou imposto não tinha onde aparecer. Conferir
--     isso é literalmente o trabalho do contas a pagar.
--   • Quantidade a menor não reduzia a conta: PC-SM-2026-0140 devia R$ 252,00
--     por 42 unidades e tinha recebido 5. Fechando assim, pagava-se 42.
--   • `recebimentos` não tinha número de nota, série nem emissão. Nada fiscal.
--     No Brasil mercadoria não entra sem nota — e era o que estava acontecendo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A DIVISÃO DE TRABALHO É A DO MERCADO, E ELA IMPORTA
--
-- A DOCA confere o que dá para conferir com a mercadoria na frente: quantidade,
-- avaria, e o DOCUMENTO que veio junto (número, série, emissão). A doca NÃO vê
-- preço — é o que impede o conferente de "ajustar" a nota para a carga passar.
--
-- O FINANCEIRO faz o match: pedido (o que foi combinado) × recebimento (o que
-- chegou) × nota (o que está sendo cobrado). É quem enxerga valor, e é quem
-- responde pela divergência. Enquanto não conferir, a conta não paga.
--
-- Por isso o valor da nota entra pela RPC `conferir_nota_fiscal`, restrita ao
-- financeiro, e não por um campo na tela do almoxarifado.

BEGIN;

-- ── O documento, na doca ────────────────────────────────────────────────────
ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS nf_numero  text,
  ADD COLUMN IF NOT EXISTS nf_serie   text,
  ADD COLUMN IF NOT EXISTS nf_emissao date;

COMMENT ON COLUMN public.recebimentos.nf_numero IS
  'Número da nota fiscal que acompanhou a carga (migr. 491). Obrigatório para confirmar a entrada: no Brasil mercadoria não entra sem nota.';

-- ── O match, no financeiro ──────────────────────────────────────────────────
ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS nf_valor         numeric(15,2),
  ADD COLUMN IF NOT EXISTS nf_conferida_em  timestamptz,
  ADD COLUMN IF NOT EXISTS nf_conferida_por uuid,
  ADD COLUMN IF NOT EXISTS nf_observacao    text;

COMMENT ON COLUMN public.contas_pagar.nf_valor IS
  'Valor cobrado na nota fiscal, conferido pelo financeiro (migr. 491). É ele que passa a valer em `valor` — o valor do pedido era só a previsão.';
COMMENT ON COLUMN public.contas_pagar.nf_observacao IS
  'Justificativa da divergência entre a nota e o pedido. Obrigatória quando os dois valores não batem.';

-- ── Mercadoria não entra sem nota ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recebimento_exige_nota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 'Pendente' é "chegou, ainda não conferi" — a nota é cobrada na conferência.
  IF COALESCE(NEW.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.ativo, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  NEW.nf_numero := NULLIF(btrim(COALESCE(NEW.nf_numero, '')), '');
  NEW.nf_serie  := NULLIF(btrim(COALESCE(NEW.nf_serie,  '')), '');

  IF NEW.nf_numero IS NULL THEN
    RAISE EXCEPTION 'Informe o número da nota fiscal que veio com a carga. Sem nota a mercadoria não entra no estoque, e o financeiro não tem o que conferir contra o pedido.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.nf_emissao IS NOT NULL AND NEW.nf_emissao > public.acre_today() THEN
    RAISE EXCEPTION 'A nota não pode ter sido emitida no futuro (%).',
      to_char(NEW.nf_emissao, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- 'no' ordena antes de 'sa' (saldo_status) e 'se' (segregação): a nota é
-- pré-requisito, checa primeiro. Ver a nota de ordem alfabética da migr. 489.
DROP TRIGGER IF EXISTS trg_recebimento_nota_fiscal ON public.recebimentos;
CREATE TRIGGER trg_recebimento_nota_fiscal
  BEFORE INSERT OR UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_exige_nota();

-- ── A conferência da nota ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conferir_nota_fiscal(
  p_conta_id   uuid,
  p_nf_valor   numeric,
  p_observacao text DEFAULT NULL
)
 RETURNS public.contas_pagar
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta       public.contas_pagar;
  v_pedido      public.pedidos;
  v_nf_numero   text;
  v_divergencia numeric;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id FOR UPDATE;
  IF v_conta.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(v_conta.filial) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_conta.ativo, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Conta inativa.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.pedido_id IS NULL THEN
    RAISE EXCEPTION 'Esta conta não vem de pedido de compra — não há pedido nem nota para conferir.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Pago' THEN
    RAISE EXCEPTION 'Conta já quitada — conferir a nota agora não mudaria o que saiu do caixa.'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_nf_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor da nota fiscal.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos WHERE id = v_conta.pedido_id;

  -- A perna do recebimento: mercadoria conferida, com nota registrada na doca.
  SELECT MAX(r.nf_numero) INTO v_nf_numero
    FROM public.recebimentos r
   WHERE r.pedido_id = v_conta.pedido_id
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Concluído', 'Parcial');

  IF v_nf_numero IS NULL THEN
    RAISE EXCEPTION 'Ainda não há recebimento conferido com nota para este pedido. O estoque confere a carga e registra a nota antes de o financeiro conferir o valor.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Divergência entre o combinado e o cobrado. Não bloqueia — em compra real
  -- ela acontece (frete, imposto, reajuste, entrega a menor). O que não pode é
  -- passar calada.
  v_divergencia := p_nf_valor - COALESCE(v_pedido.valor_total, 0);
  IF abs(v_divergencia) > 0.005
     AND COALESCE(btrim(COALESCE(p_observacao, '')), '') = '' THEN
    RAISE EXCEPTION 'A nota (R$ %) não bate com o pedido (R$ %). Escreva o motivo da diferença antes de liberar o pagamento.',
      to_char(p_nf_valor, 'FM999G999G990D00'),
      to_char(COALESCE(v_pedido.valor_total, 0), 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.contas_pagar
     SET valor            = p_nf_valor,
         nf_valor         = p_nf_valor,
         nf_conferida_em  = now(),
         nf_conferida_por = auth.uid(),
         nf_observacao    = NULLIF(btrim(COALESCE(p_observacao, '')), '')
   WHERE id = p_conta_id
  RETURNING * INTO v_conta;

  RETURN v_conta;
END;
$function$;

REVOKE ALL ON FUNCTION public.conferir_nota_fiscal(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conferir_nota_fiscal(uuid, numeric, text) TO authenticated, service_role;

-- ── O pagamento passa a exigir as TRÊS pernas ───────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_pagar_exige_recebimento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Confere na PRIMEIRA saída de dinheiro, seja ela parcial ou total. Da
  -- segunda em diante não repete: a conferência já foi feita, e repetir
  -- travaria a quitação de uma conta que começou a ser paga legitimamente.
  IF NEW.status NOT IN ('Pago', 'Parcial')
     OR OLD.status IN ('Pago', 'Parcial')
     OR NEW.pedido_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.recebimentos r
     WHERE r.pedido_id = NEW.pedido_id
       AND COALESCE(r.ativo, true)
       AND r.status = 'Concluído'
  ) THEN
    RAISE EXCEPTION 'Esta conta é de um pedido de compra e a mercadoria ainda não foi conferida no Estoque. Registre o recebimento antes de pagar.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Terceira perna (migr. 491): o valor cobrado tem de ter sido confrontado com
  -- o pedido. Sem isso, paga-se o que foi PEDIDO, não o que foi COBRADO.
  IF NEW.nf_conferida_em IS NULL THEN
    RAISE EXCEPTION 'A nota fiscal ainda não foi conferida contra o pedido. Abra a conta em Contas a pagar, use "Conferir nota" e só depois pague.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- O QUE MUDA PARA QUEM ESTÁ NO MEIO DO CICLO
--
-- Recebimento já confirmado antes desta migração não tem `nf_numero`. Ele NÃO é
-- reprocessado — fica como está. Mas a conta dele não passa na conferência
-- ("não há recebimento conferido com nota"), e a saída é a real: o estoque
-- informa a nota naquele recebimento (a tela abre um campo para isso), e aí o
-- financeiro confere. Nota que chega depois da mercadoria é rotina, não exceção.
--
-- NÃO foi feito backfill de `nf_conferida_em`: liberar as contas em aberto sem
-- ninguém olhar seria justamente pular a etapa que esta migração existe para
-- criar.
--
-- TESTE MANUAL
--   confirmar recebimento sem nº de nota   → recusa
--   conferir nota sem recebimento com nota → recusa
--   nota diferente do pedido sem motivo    → recusa
--   nota diferente do pedido com motivo    → grava, e `valor` vira o da nota
--   pagar sem conferir a nota              → recusa
-- ════════════════════════════════════════════════════════════════════════════
