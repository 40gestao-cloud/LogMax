-- =================================================================
-- 400 — O pedido de venda passa a baixar estoque, e o recebimento a
--       fechar o pedido.
--
-- Auditoria do fluxo de aula "Orçamento vira pedido e sai da loja".
-- Dois buracos, os dois no mesmo trecho: depois que o orçamento vira
-- pedido, o sistema para de acompanhar a mercadoria e o dinheiro.
--
-- (1) SEPARAR NÃO BAIXAVA NADA
--     `converter_orcamento_em_pedido` não toca em estoque (correto: a
--     conversão é um compromisso, não uma saída), e "Separar" era um
--     UPDATE de três campos — `separado_em`, `separado_por`, `status`.
--     Ou seja: a mercadoria saía da loja e o saldo ficava igual. Era o
--     único lugar do sistema onde vender não mexia no estoque, bem ao
--     lado do PDV, onde a baixa é no mesmo clique. Quem prestasse
--     atenção na aula ia perguntar.
--     Agora existe `separar_pedido_venda`: percorre os itens do pedido,
--     lança uma saída por item e marca a separação — tudo numa
--     transação. Saldo insuficiente estoura na trigger de estoque e
--     desfaz a separação inteira, que é o comportamento certo: não se
--     separa o que não tem.
--
-- (2) DUAS PORTAS PARA O MESMO PAGAMENTO, SEM CONVERSA
--     `registrar_pagamento_conta` quitava a conta a receber e não tocava
--     em `pedidos_venda` — o pedido nunca chegava a "Concluído". E o
--     botão "Registrar pagamento" da tela de Pedidos marcava a flag no
--     pedido sem quitar a conta, que ficava Aberta para sempre. Numa
--     turma, metade vai por cada porta e os relatórios discordam.
--     A trigger `trg_conta_receber_fecha_pedido_venda` faz a conta
--     mandar no pedido: quitou a conta, o pedido fica pago. Vale para
--     QUALQUER caminho que quite a conta — RPC, tela ou correção manual
--     —, que é o motivo de ser trigger e não mais uma linha dentro da
--     RPC de pagamento.
--
-- Rastro: `movimentacoes_estoque.pedido_venda_id`, com índice único
-- parcial por (pedido, produto). Mesmo padrão do recebimento
-- (`uq_mov_estoque_por_recebimento`): além de dizer de onde veio a
-- saída, é ele que impede separar duas vezes numa corrida de duplo
-- clique.
--
-- Não mexe em pedido já separado: saída de estoque que não aconteceu
-- não se inventa retroativamente.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. De onde veio a saída ───────────────────────────────────────
ALTER TABLE public.movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS pedido_venda_id uuid REFERENCES public.pedidos_venda(id);

COMMENT ON COLUMN public.movimentacoes_estoque.pedido_venda_id IS
  'Pedido de venda que originou a saida, preenchido por separar_pedido_venda.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_estoque_por_pedido_venda
  ON public.movimentacoes_estoque (pedido_venda_id, produto_id)
  WHERE pedido_venda_id IS NOT NULL;

-- ── 2. Separar passa a ser um ato de estoque ──────────────────────
CREATE OR REPLACE FUNCTION public.separar_pedido_venda(p_pedido_id uuid)
RETURNS pedidos_venda
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ped    public.pedidos_venda;
  v_item   jsonb;
  v_nome   text;
  v_dest   text;
  v_qtd    numeric(15,3);
  v_prod   uuid;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_ped FROM public.pedidos_venda
   WHERE id = p_pedido_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_ped.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(v_ped.filial) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Quem separa: Estoque/Logística, ou o gerente da filial (régua
  -- canônica "gerente opera a filial inteira"). COALESCE porque guard
  -- que testa NULL com NOT deixa passar.
  IF NOT COALESCE(
       public.auth_in_setor('estoque', 'logistica')
       OR public.auth_gerente_da(v_ped.filial), false) THEN
    RAISE EXCEPTION 'Só o Estoque (ou o gerente da filial) separa pedido de venda.'
      USING ERRCODE = '42501';
  END IF;

  IF v_ped.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Pedido cancelado não se separa.' USING ERRCODE = 'P0001';
  END IF;
  IF v_ped.separado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este pedido já foi separado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_ped.itens IS NULL OR jsonb_array_length(v_ped.itens) = 0 THEN
    RAISE EXCEPTION 'Pedido sem itens — nada a separar.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.clientes WHERE id = v_ped.cliente_id;
  v_dest := COALESCE(v_ped.numero, 'Pedido ' || upper(substring(v_ped.id::text, 1, 8)))
            || COALESCE(' — ' || v_nome, '');

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_ped.itens) LOOP
    v_prod := NULLIF(v_item->>'produto_id', '')::uuid;
    v_qtd  := COALESCE((v_item->>'qtd')::numeric, 0);

    -- Item sem produto do catálogo não vira saída — e não pode passar
    -- em silêncio, senão o pedido fecha separado com estoque intocado,
    -- que é exatamente o defeito que esta migração fecha.
    IF v_prod IS NULL THEN
      RAISE EXCEPTION 'Item "%" do pedido não aponta para um produto do catálogo.',
        COALESCE(v_item->>'nome', '(sem nome)') USING ERRCODE = 'P0001';
    END IF;
    IF v_qtd <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida no item "%".',
        COALESCE(v_item->>'nome', '(sem nome)') USING ERRCODE = 'P0001';
    END IF;

    -- Saldo insuficiente estoura na trigger de estoque e derruba a
    -- separação inteira. É o que se quer: pedido meio separado é pior
    -- que pedido não separado.
    INSERT INTO public.movimentacoes_estoque (
      produto_id, tipo, qtd, origem, destino, data, filial, pedido_venda_id
    ) VALUES (
      v_prod, 'Saída', v_qtd, 'Pedido de Venda', v_dest,
      public.acre_today(), v_ped.filial, v_ped.id
    );
  END LOOP;

  UPDATE public.pedidos_venda
     SET separado_em       = now(),
         separado_por      = auth.uid(),
         separado_por_nome = COALESCE(
           (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
           separado_por_nome),
         status            = CASE WHEN pago_em IS NOT NULL THEN 'Concluído' ELSE 'Separado' END
   WHERE id = p_pedido_id
  RETURNING * INTO v_ped;

  RETURN v_ped;
END;
$$;

REVOKE ALL ON FUNCTION public.separar_pedido_venda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.separar_pedido_venda(uuid) TO authenticated;

-- ── 3. A conta manda no pedido ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._conta_receber_fecha_pedido_venda()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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
           (SELECT nome FROM public.user_profiles WHERE id = auth.uid())),
         status        = CASE WHEN separado_em IS NOT NULL THEN 'Concluído' ELSE 'Pago' END
   WHERE conta_receber_id = NEW.id
     AND pago_em IS NULL
     AND COALESCE(status, '') <> 'Cancelado';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_receber_fecha_pedido_venda ON public.contas_receber;
CREATE TRIGGER trg_conta_receber_fecha_pedido_venda
  AFTER UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public._conta_receber_fecha_pedido_venda();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- separar lança uma saída por item e marca o pedido:
--   SELECT separado_em, status FROM pedidos_venda WHERE id = '<pedido>';
--   SELECT produto_id, qtd, origem, destino FROM movimentacoes_estoque
--    WHERE pedido_venda_id = '<pedido>';
--
--   -- receber a conta fecha o pedido sozinho:
--   SELECT p.status, p.pago_em FROM pedidos_venda p
--     JOIN contas_receber c ON c.id = p.conta_receber_id WHERE c.status = 'Pago';
