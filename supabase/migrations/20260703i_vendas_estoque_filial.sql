-- =================================================================
-- Vendas + Estoque: adiciona coluna filial nas tabelas pendentes
-- orcamentos → pedidos_venda
-- requisicoes_estoque → aprovacoes_estoque
--
-- Atualiza as RPCs:
--   criar_requisicao_estoque   — aceita p_filial
--   converter_orcamento_em_pedido — propaga orcamento.filial
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Adiciona coluna filial ────────────────────────────────────
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.pedidos_venda
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.requisicoes_estoque
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.aprovacoes_estoque
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- ─── 2. Propaga dados históricos ──────────────────────────────────
-- pedidos_venda ← orcamentos
UPDATE public.pedidos_venda pv
SET filial = o.filial
FROM public.orcamentos o
WHERE pv.orcamento_id = o.id
  AND pv.filial = 'SuperMax';

-- aprovacoes_estoque ← requisicoes_estoque
UPDATE public.aprovacoes_estoque ae
SET filial = r.filial
FROM public.requisicoes_estoque r
WHERE ae.requisicao_estoque_id = r.id
  AND ae.filial = 'SuperMax';

-- ─── 3. Atualiza RPC criar_requisicao_estoque ─────────────────────
CREATE OR REPLACE FUNCTION public.criar_requisicao_estoque(
  p_produto_id  uuid,
  p_solicitante text,
  p_qtd         integer DEFAULT 1,
  p_destino     text    DEFAULT NULL,
  p_filial      text    DEFAULT 'SuperMax'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req requisicoes_estoque;
BEGIN
  IF p_produto_id IS NULL THEN
    RAISE EXCEPTION 'Produto é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = p_produto_id) THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_solicitante IS NULL OR length(trim(p_solicitante)) = 0 THEN
    RAISE EXCEPTION 'Solicitante é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 THEN
    p_qtd := 1;
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;

  INSERT INTO public.requisicoes_estoque (
    produto_id, solicitante, qtd, destino, status, filial
  ) VALUES (
    p_produto_id, trim(p_solicitante), p_qtd,
    NULLIF(trim(COALESCE(p_destino,'')), ''),
    'Pendente', p_filial
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_requisicao_estoque(uuid, text, integer, text, text)
  TO authenticated;

-- ─── 4. Atualiza RPC converter_orcamento_em_pedido ────────────────
-- Propaga orcamento.filial para pedidos_venda e contas_receber.
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
  v_vencimento := CURRENT_DATE + 30;

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
    p_ref_id     => v_pedido_id::text
  );

  PERFORM public.notificar_setor(
    p_setor      => 'financeiro',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Conta a receber gerada',
    p_mensagem   => v_desc,
    p_link_view  => 'financeiro-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id::text
  );

  RETURN v_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_pedido(uuid) TO authenticated;

COMMIT;
