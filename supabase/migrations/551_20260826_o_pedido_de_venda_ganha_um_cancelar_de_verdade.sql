-- 551 — O pedido de venda ganha um cancelar de verdade.
--
-- `PedidosVendaView.handleDelete` é isto:
--
--     <button title="Cancelar" onClick={() => handleDelete(p.id)}>
--     ...
--     if (!await confirm('Cancelar este pedido de venda?')) return;
--     await dbDelete('/api/pedidosvendaview', id);       // ← ativo = false
--     showToast('Pedido inativado.');
--
-- Três palavras para o mesmo clique — "Cancelar", "Cancelar", "inativado" — e a
-- ação é a terceira. Cancelar é decisão de negócio que desfaz efeitos; inativar
-- é tirar a linha da tela. O próprio repositório sabe a diferença: em
-- `OrcamentosView` as duas funções existem lado a lado, `handleCancelar`
-- (status = 'Cancelado') e `handleDelete` (ativo = false). Pedidos de Venda só
-- herdou a segunda.
--
-- ─── O QUE FICAVA PARA TRÁS ────────────────────────────────────────────────
--
--   · `separar_pedido_venda` JÁ DEU BAIXA no estoque quando `separado_em` está
--     preenchido. Inativar não estorna: a mercadoria fica fora do estoque sem
--     documento que a explique. É o furo da migr. 546 (recebimento) espelhado.
--   · `pedidos_venda` não tem `documento_sem_exclusao` — `requisicoes`,
--     `cotacoes` e `pedidos` têm. Qualquer um inativa.
--   · `_conta_receber_fecha_pedido_venda` acha o pedido por `conta_receber_id`
--     e não olha `ativo`: pagar a conta continua escrevendo `pago_em` e status
--     num pedido excluído.
--   · A conta a receber segue ativa e cobrável, sem pedido atrás.
--   · O orçamento de origem fica preso em 'Convertido em Pedido' apontando
--     para o morto (a outra ponta disso é a migr. 552).
--
-- ─── E O STATUS, QUE NUNCA TEVE RÉGUA ──────────────────────────────────────
--
-- A compra tem `fn_pedido_transicao_valida`. A venda não tinha nada: os cinco
-- status são escritos direto pela tela, em qualquer ordem. Um pedido ia de
-- 'Aguardando Separação' para 'Concluído' sem nunca ter sido separado — a
-- mercadoria saía da loja no papel e não no estoque.
--
-- Mas a régua certa aqui NÃO é um grafo de transições, e sim a da migr. 489:
-- **quem grava o status é o banco, a partir dos fatos**. Porque o status do
-- pedido de venda já é derivado — duas datas independentes decidem tudo:
--
--     separado_em  pago_em   →  status
--     -----------  --------     ------
--     NULL         NULL         Aguardando Separação
--     preenchido   NULL         Separado
--     NULL         preenchido   Pago
--     preenchido   preenchido   Concluído
--
-- É exatamente o que `separar_pedido_venda` e `_conta_receber_fecha_pedido_venda`
-- já calculam, cada uma metade, em dois lugares. Aqui vira uma conta só, feita
-- por quem manda: o gatilho. A tela pode mandar o status que quiser — ele é
-- recalculado. 'Cancelado' é a única exceção, porque não é derivado de marco
-- nenhum: é decisão, e vem pela RPC.
--
-- ─── SEM CONSERTO DE DADOS ─────────────────────────────────────────────────
--
-- Zero pedidos de venda nas quatro turmas (conferido em 26/08 — o fluxo de
-- venda nunca foi exercitado). É o momento barato: régua a escrever, nada
-- torto para reparar.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O status sai dos marcos, não da tela
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_venda_status_pelos_marcos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Cancelado não é derivado de marco nenhum: é decisão, e só a RPC a toma.
  -- Uma vez cancelado, fica — reabrir pedido de venda não existe no fluxo.
  IF COALESCE(NEW.status, '') = 'Cancelado'
     OR (TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'Cancelado') THEN
    NEW.status := 'Cancelado';
    RETURN NEW;
  END IF;

  NEW.status := CASE
    WHEN NEW.separado_em IS NOT NULL AND NEW.pago_em IS NOT NULL THEN 'Concluído'
    WHEN NEW.separado_em IS NOT NULL                             THEN 'Separado'
    WHEN NEW.pago_em     IS NOT NULL                             THEN 'Pago'
    ELSE 'Aguardando Separação'
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pedido_venda_status_marcos ON public.pedidos_venda;
CREATE TRIGGER trg_pedido_venda_status_marcos
  BEFORE INSERT OR UPDATE ON public.pedidos_venda
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_venda_status_pelos_marcos();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O documento não se exclui — é o rastro do que a turma fez
-- ────────────────────────────────────────────────────────────────────────────
-- Mesma função que já guarda requisição, cotação e pedido de compra. A mensagem
-- dela ("cancele-o ou peça à direção para reabri-lo") passa a ter para onde
-- apontar agora que o cancelar existe.
DROP TRIGGER IF EXISTS trg_sem_exclusao ON public.pedidos_venda;
CREATE TRIGGER trg_sem_exclusao
  BEFORE UPDATE ON public.pedidos_venda
  FOR EACH ROW EXECUTE FUNCTION public.documento_sem_exclusao();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Pedido excluído para de receber baixa de pagamento
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente com `COALESCE(ativo, true)` acrescentado. Depois da
-- peça 2 isto só alcança o que o professor inativou, mas é o mesmo defeito de
-- ler o elo sem olhar se o outro lado está vivo.
CREATE OR REPLACE FUNCTION public._conta_receber_fecha_pedido_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Pago', 'Recebido') THEN
    RETURN NEW;
  END IF;

  UPDATE public.pedidos_venda
     SET pago_em       = COALESCE(pago_em, now()),
         pago_por      = COALESCE(pago_por, auth.uid()),
         pago_por_nome = COALESCE(
           pago_por_nome,
           (SELECT nome FROM public.user_profiles WHERE id = auth.uid()))
   WHERE conta_receber_id = NEW.id
     AND pago_em IS NULL
     AND COALESCE(ativo, true)                      -- MIGR 551
     AND COALESCE(status, '') <> 'Cancelado';
  -- `status` saiu do UPDATE: quem o grava agora é
  -- `fn_pedido_venda_status_pelos_marcos`, a partir de `pago_em` que acabou de
  -- ser preenchido. Duas réguas para o mesmo campo divergem no primeiro ajuste.

  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. O cancelar de verdade
-- ────────────────────────────────────────────────────────────────────────────
-- Espelho de `cancelar_pedido_compra`: recusa quando já entrou dinheiro,
-- devolve o estoque que saiu, cancela a cobrança e solta o documento de origem
-- para poder ser refeito.
CREATE OR REPLACE FUNCTION public.cancelar_pedido_venda(p_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ped      public.pedidos_venda;
  v_item     jsonb;
  v_prod     uuid;
  v_qtd      numeric(15,3);
  v_origem   text;
  v_pago     numeric(15,2) := 0;
  v_estorno  integer := 0;
  v_conta    integer := 0;
  v_orc      integer := 0;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_ped FROM public.pedidos_venda
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_ped.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_ped.filial), false) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;
  -- Mesma régua de `separar_pedido_venda`: quem opera a venda, ou o gerente da
  -- filial. COALESCE porque guard que testa NULL com NOT deixa passar.
  IF NOT COALESCE(
       public.auth_is_admin()
       OR public.auth_in_setor('vendas', 'financeiro')
       OR public.auth_gerente_da(v_ped.filial), false) THEN
    RAISE EXCEPTION 'Só Vendas, o Financeiro ou o gerente da filial cancela pedido de venda.'
      USING ERRCODE = '42501';
  END IF;
  IF v_ped.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Este pedido já está cancelado.' USING ERRCODE = 'P0001';
  END IF;

  -- Dinheiro que já entrou não se desfaz por aqui (mesma régua da migr. 427 no
  -- lado da compra). Devolver ao cliente é devolução, não cancelamento.
  IF v_ped.conta_receber_id IS NOT NULL THEN
    SELECT COALESCE(valor_pago, 0) INTO v_pago
      FROM public.contas_receber WHERE id = v_ped.conta_receber_id;
    IF v_pago > 0 THEN
      RAISE EXCEPTION
        'Este pedido já recebeu R$ % do cliente. Cancelar agora apagaria a cobrança sem devolver o dinheiro. Estorne o pagamento em Financeiro > Contas a receber, ou registre uma devolução.',
        to_char(v_pago, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Estoque de volta ──
  -- Só se a separação chegou a acontecer. Guard de idempotência pela origem,
  -- igual ao de `fn_venda_cancelada_desfaz`: rodar duas vezes não duplica.
  IF v_ped.separado_em IS NOT NULL THEN
    v_origem := 'Estorno — ' || COALESCE(v_ped.numero, 'Pedido ' || upper(substring(v_ped.id::text, 1, 8)))
                || ' cancelado';

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_ped.itens, '[]'::jsonb)) LOOP
      v_prod := NULLIF(v_item->>'produto_id', '')::uuid;
      v_qtd  := COALESCE((v_item->>'qtd')::numeric, 0);
      CONTINUE WHEN v_prod IS NULL OR v_qtd <= 0;

      IF EXISTS (
        SELECT 1 FROM public.movimentacoes_estoque me
         WHERE me.produto_id = v_prod
           AND me.pedido_venda_id = v_ped.id
           AND me.tipo = 'Entrada'
           AND COALESCE(me.ativo, true)
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.movimentacoes_estoque (
        produto_id, tipo, qtd, origem, destino, data, filial, pedido_venda_id
      ) VALUES (
        v_prod, 'Entrada', v_qtd, v_origem, 'Almoxarifado',
        public.acre_today(), v_ped.filial, v_ped.id
      );
      v_estorno := v_estorno + 1;
    END LOOP;
  END IF;

  -- ── Cobrança ──
  IF v_ped.conta_receber_id IS NOT NULL THEN
    UPDATE public.contas_receber
       SET status     = 'Cancelado',
           descricao  = descricao || ' — cancelada com o pedido de venda',
           updated_at = now()
     WHERE id = v_ped.conta_receber_id
       AND COALESCE(ativo, true)
       AND status <> 'Cancelado'
       AND COALESCE(valor_pago, 0) = 0;
    GET DIAGNOSTICS v_conta = ROW_COUNT;
  END IF;

  -- ── Pedido ──
  UPDATE public.pedidos_venda SET status = 'Cancelado' WHERE id = v_ped.id;

  -- ── Orçamento de origem volta a poder virar pedido ──
  -- Sem isto ele fica preso em 'Convertido em Pedido' apontando para um pedido
  -- morto, e `converter_orcamento_em_pedido` devolve o id do morto para sempre.
  IF v_ped.orcamento_id IS NOT NULL THEN
    UPDATE public.orcamentos
       SET pedido_venda_id = NULL,
           status          = 'Aprovado Cliente'
     WHERE id = v_ped.orcamento_id
       AND COALESCE(ativo, true)
       AND status = 'Convertido em Pedido';
    GET DIAGNOSTICS v_orc = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'estoque_devolvido', v_estorno,
    'conta_cancelada',   v_conta > 0,
    'orcamento_liberado', v_orc > 0,
    'motivo', NULLIF(btrim(COALESCE(p_motivo, '')), '')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_pedido_venda(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_venda(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
