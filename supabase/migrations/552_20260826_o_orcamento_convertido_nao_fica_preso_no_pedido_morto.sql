-- 552 — O orçamento convertido não fica preso no pedido morto.
--
-- `converter_orcamento_em_pedido` começa assim:
--
--     IF v_orc.pedido_venda_id IS NOT NULL THEN
--       RETURN v_orc.pedido_venda_id;
--     END IF;
--
-- A intenção é idempotência — clicar duas vezes não cria dois pedidos —, e ela
-- está certa. O que falta é a pergunta seguinte: **aquele pedido ainda existe?**
-- Se ele foi cancelado (ou inativado, antes da migr. 551 dar um cancelar de
-- verdade), a função devolve o id de um documento morto, para sempre. O
-- orçamento fica parado em 'Convertido em Pedido', a tela mostra um pedido que
-- não está mais lá, e não há caminho de volta.
--
-- É a mesma família do que a migr. 544 fechou do lado da compra: um elo lido
-- como "ainda vale" porque existe, sem olhar o estado do outro lado. Lá era
-- `ativo` sendo lido como "não cancelado"; aqui é um `IS NOT NULL`.
--
-- A migr. 551 já fecha metade disto pela outra ponta: `cancelar_pedido_venda`
-- limpa `orcamentos.pedido_venda_id` e devolve o orçamento para 'Aprovado
-- Cliente'. Esta migração fecha a metade que sobra — o pedido que morreu por
-- outro caminho (inativado pelo professor, ou por um cancelamento anterior a
-- 551) —, e é o cinto junto com o suspensório: a idempotência passa a exigir
-- que o pedido esteja vivo, não só que o campo esteja preenchido.
--
-- ─── E O ORÇAMENTO TAMBÉM NÃO SE EXCLUI ────────────────────────────────────
--
-- `OrcamentosView` tem as duas ações, e é por isso que a régua ficou visível:
--
--     handleCancelar → dbUpdate({ status: 'Cancelado' })   ← decisão
--     handleDelete   → dbDelete()                          ← ativo = false
--
-- A primeira é a certa e já existe. A segunda pergunta "Inativar este
-- orçamento?" sem olhar nada — inclusive um orçamento já convertido, deixando
-- `pedidos_venda.orcamento_id` apontando para documento morto e o pedido sem
-- origem rastreável.
--
-- `orcamentos` entra na mesma régua de `requisicoes`, `cotacoes`, `pedidos` e
-- (desde a 551) `pedidos_venda`: documento é rastro, cancela-se, não se apaga.
-- A tela perde o botão de inativar; o de cancelar continua onde está.
--
-- Zero orçamentos nas quatro turmas em 26/08 — nada a reparar.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A idempotência passa a exigir pedido VIVO
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente no banco, com o bloco do topo trocado e nada mais.
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_pedido(p_orcamento_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc            public.orcamentos;
  v_pedido_id      uuid;
  v_conta_id       uuid;
  v_cliente_nome   text;
  v_desc           text;
  v_vencimento     date;
  v_vivo           uuid;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 552: devolver o pedido já gerado é idempotência; devolver um pedido
  -- cancelado ou inativado é beco sem saída. Só o vivo conta.
  IF v_orc.pedido_venda_id IS NOT NULL THEN
    SELECT pv.id INTO v_vivo
      FROM public.pedidos_venda pv
     WHERE pv.id = v_orc.pedido_venda_id
       AND COALESCE(pv.ativo, true)
       AND pv.status <> 'Cancelado';

    IF v_vivo IS NOT NULL THEN
      RETURN v_vivo;
    END IF;

    -- O pedido morreu. O orçamento volta a ser conversível, e o INSERT abaixo
    -- gera um novo — com número novo, porque o anterior continua no rastro.
    UPDATE public.orcamentos
       SET pedido_venda_id = NULL
     WHERE id = v_orc.id;
    v_orc.pedido_venda_id := NULL;
    IF v_orc.status = 'Convertido em Pedido' THEN
      v_orc.status := 'Aprovado Cliente';
    END IF;
  END IF;

  IF v_orc.status <> 'Aprovado Cliente' THEN
    RAISE EXCEPTION 'Só é possível converter orçamentos aprovados pelo cliente. Status atual: %.', v_orc.status
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.pedidos_venda (
    orcamento_id, cliente_id, vendedor_id, vendedor_nome,
    itens, valor_total, status, filial
  )
  VALUES (
    v_orc.id, v_orc.cliente_id, v_orc.vendedor_id, v_orc.vendedor_nome,
    v_orc.itens, v_orc.valor_total, 'Aguardando Separação', v_orc.filial
  )
  RETURNING id INTO v_pedido_id;

  SELECT nome INTO v_cliente_nome FROM public.clientes WHERE id = v_orc.cliente_id;
  v_desc       := 'Pedido Venda #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                  || COALESCE(' - ' || v_cliente_nome, '');
  v_vencimento := public.acre_today() + 30;

  INSERT INTO public.contas_receber (cliente_id, descricao, valor, vencimento, status, filial)
  VALUES (v_orc.cliente_id, v_desc, v_orc.valor_total, v_vencimento, 'Aberto', v_orc.filial)
  RETURNING id INTO v_conta_id;

  UPDATE public.pedidos_venda
     SET conta_receber_id = v_conta_id
   WHERE id = v_pedido_id;

  UPDATE public.orcamentos
     SET status = 'Convertido em Pedido',
         pedido_venda_id = v_pedido_id
   WHERE id = v_orc.id;

  PERFORM public.notificar_setor(
    p_setor      => 'logistica',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Novo pedido de venda para separar',
    p_mensagem   => v_desc,
    p_link_view  => 'estoque-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id
  );

  PERFORM public.notificar_setor(
    p_setor      => 'financeiro',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Conta a receber gerada',
    p_mensagem   => v_desc,
    p_link_view  => 'financeiro-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id
  );

  RETURN v_pedido_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Orçamento é documento: cancela-se, não se apaga
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sem_exclusao ON public.orcamentos;
CREATE TRIGGER trg_sem_exclusao
  BEFORE UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.documento_sem_exclusao();

COMMIT;

NOTIFY pgrst, 'reload schema';
