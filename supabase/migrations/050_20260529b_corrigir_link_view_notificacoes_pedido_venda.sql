-- ─────────────────────────────────────────────────────────────────────────────
-- LogMax — Fix: link_view por destinatário em converter_orcamento_em_pedido
-- Data: 2026-05-29
--
-- Patch sobre 20260529_orcamentos_e_pedidos_venda.sql: aquela versão usava
-- `vendas-pedidosdevenda` em AMBAS as notificações (logística e financeiro).
-- Logística e Financeiro não veem o módulo "Vendas" no menu lateral
-- (SETOR_MODULES), então o link do sino navegava para uma rota fora do
-- contexto deles — funcional (a view renderiza), mas confunde a UX.
--
-- Agora cada notificação aponta pra rota visível no menu do destinatário:
--   logística  → 'estoque-pedidosdevenda'
--   financeiro → 'financeiro-pedidosdevenda'
--
-- A função é CREATE OR REPLACE — segura para re-execução.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_pedido(
  p_orcamento_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc            public.orcamentos;
  v_pedido_id      uuid;
  v_conta_id       uuid;
  v_cliente_nome   text;
  v_desc           text;
  v_vencimento     date;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_orc.pedido_venda_id IS NOT NULL THEN
    RETURN v_orc.pedido_venda_id;
  END IF;

  IF v_orc.status <> 'Aprovado Cliente' THEN
    RAISE EXCEPTION 'Só é possível converter orçamentos aprovados pelo cliente. Status atual: %.', v_orc.status
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.pedidos_venda (
    orcamento_id, cliente_id, vendedor_id, vendedor_nome,
    itens, valor_total, status
  )
  VALUES (
    v_orc.id, v_orc.cliente_id, v_orc.vendedor_id, v_orc.vendedor_nome,
    v_orc.itens, v_orc.valor_total, 'Aguardando Separação'
  )
  RETURNING id INTO v_pedido_id;

  SELECT nome INTO v_cliente_nome FROM public.clientes WHERE id = v_orc.cliente_id;
  v_desc       := 'Pedido Venda #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                  || COALESCE(' - ' || v_cliente_nome, '');
  v_vencimento := CURRENT_DATE + 30;

  INSERT INTO public.contas_receber (cliente_id, descricao, valor, vencimento, status)
  VALUES (v_orc.cliente_id, v_desc, v_orc.valor_total, v_vencimento, 'Aberto')
  RETURNING id INTO v_conta_id;

  UPDATE public.pedidos_venda
     SET conta_receber_id = v_conta_id
   WHERE id = v_pedido_id;

  UPDATE public.orcamentos
     SET status = 'Convertido em Pedido',
         pedido_venda_id = v_pedido_id
   WHERE id = v_orc.id;

  -- Logística vê o pedido em Estoque → Pedidos de Venda (gated por
  -- requireSetor=['logistica'] no SidebarNav).
  PERFORM public.notificar_setor(
    p_setor      => 'logistica',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Novo pedido de venda para separar',
    p_mensagem   => 'Pedido #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                    || COALESCE(' - ' || v_cliente_nome, ''),
    p_link_view  => 'estoque-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id,
    p_motivo     => NULL
  );

  -- Financeiro vê em Financeiro → Pedidos de Venda.
  PERFORM public.notificar_setor(
    p_setor      => 'financeiro',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Pedido de venda aguardando pagamento',
    p_mensagem   => 'Pedido #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                    || COALESCE(' - ' || v_cliente_nome, '')
                    || ' (Conta a Receber #' || UPPER(SUBSTRING(v_conta_id::text, 1, 6)) || ')',
    p_link_view  => 'financeiro-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id,
    p_motivo     => NULL
  );

  RETURN v_pedido_id;
END;
$$;
