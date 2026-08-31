-- O parcelamento gera um título por parcela — e o cancelamento derruba todos.
--
-- A migr. 568 deu forma de pagamento e número de parcelas ao orçamento. Falta
-- a metade que vale dinheiro: `converter_orcamento_em_pedido` insere UMA conta
-- a receber, com vencimento `acre_today() + 30`, sempre. Crediário em 6x
-- nasceria como um título único vencendo daqui a 30 dias — o oposto do que o
-- aluno acabou de propor ao cliente, e a fila do Financeiro nunca mostraria a
-- 2ª à 6ª parcela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE MUDA NA CONVERSÃO
--
-- 1. N TÍTULOS. Vencimento da parcela i = hoje + `prazo` (o D+n da forma) +
--    (i−1) × `intervalo_dias`. Pix D+0 continua um título para hoje; cartão de
--    crédito D+30 em 3x vira 30/60/90.
--
-- 2. O CENTAVO FICA NA ÚLTIMA. R$ 100,00 em 3x é 33,33 + 33,33 + 33,34.
--    Dividir e arredondar as três daria 99,99 — um centavo que some da
--    cobrança e que ninguém acha depois.
--
-- 3. CREDIÁRIO PASSA PELO CRÉDITO DO CLIENTE. Quando a forma está marcada com
--    `exige_limite_credito`, quem financia é a própria filial, e valem as duas
--    travas que a migr. 416 já ensina no PDV:
--      · título vencido em aberto trava, sempre — a saída é baixar em
--        Financeiro → Contas a Receber, que é o que a loja real cobra antes de
--        liberar a próxima compra;
--      · `limite_credito` cadastrado trava quando o que já está na rua mais
--        esta proposta passam do teto. Limite NULL (não cadastrado) não trava,
--        mesma decisão da 416 — a base das turmas tem cliente desde o primeiro
--        dia e nascer tudo com teto zero pararia a aula.
--
--    A trava mora AQUI, e não no gatilho do orçamento, porque é aqui que a
--    dívida nasce. Propor crediário a quem está no vermelho tem de ser
--    possível: o cliente pode acertar antes de aprovar. Virar título, não.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE MUDA NO CANCELAMENTO
--
-- `cancelar_pedido_venda` olhava `pedidos_venda.conta_receber_id`, que é UMA
-- coluna. Com seis parcelas ele cancelaria a primeira e deixaria cinco
-- cobrando um pedido que não existe mais — e a trava "este pedido já recebeu
-- do cliente" veria só a primeira, deixando cancelar um pedido cuja 4ª parcela
-- já foi paga. As duas passam a varrer por `contas_receber.pedido_venda_id`
-- (migr. 568), com o `conta_receber_id` no OU para alcançar o que é anterior
-- ao elo novo.
--
-- Os corpos abaixo foram lidos do banco com `pg_get_functiondef` antes de
-- editar — arquivo antigo não serve de base, o corpo vivo já tinha passado
-- pela 260 (guard) e pela 552 (pedido morto).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Conversão: um título por parcela
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_pedido(p_orcamento_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc           public.orcamentos;
  v_pedido_id     uuid;
  v_conta_id      uuid;
  v_primeira      uuid;
  v_cliente_nome  text;
  v_desc          text;
  v_msg           text;
  v_vencimento    date;
  v_vivo          uuid;
  f               public.formas_pagamento;
  v_parcelas      integer;
  v_prazo         integer := 30;
  v_intervalo     integer := 30;
  v_parcela       numeric(12,2);
  v_acum          numeric(12,2) := 0;
  v_valor         numeric(12,2);
  v_total         numeric(12,2);
  v_limite        numeric(15,2);
  v_saldo         numeric(15,2);
  v_vencidos      integer;
  i               integer;
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

  -- ── Condição de pagamento (migr. 568) ────────────────────────────────────
  -- Orçamento sem forma — todos os anteriores a esta migração — segue o
  -- comportamento de sempre: um título, D+30.
  v_total    := round(COALESCE(v_orc.valor_total, 0), 2);
  v_parcelas := GREATEST(1, COALESCE(v_orc.parcelas, 1));

  IF v_orc.forma_pagamento_id IS NOT NULL THEN
    SELECT * INTO f FROM public.formas_pagamento
     WHERE id = v_orc.forma_pagamento_id AND COALESCE(ativo, true);

    IF FOUND THEN
      v_prazo     := GREATEST(0, COALESCE(f.prazo, 0));
      v_intervalo := GREATEST(1, COALESCE(f.intervalo_dias, 30));

      -- Crediário: quem financia é a filial.
      IF COALESCE(f.exige_limite_credito, false) THEN
        IF v_orc.cliente_id IS NULL THEN
          RAISE EXCEPTION 'Venda no crediário precisa de cliente identificado — sem devedor não há crédito.'
            USING ERRCODE = 'P0001';
        END IF;

        v_vencidos := public.cliente_titulos_vencidos(v_orc.cliente_id);
        IF COALESCE(v_vencidos, 0) > 0 THEN
          RAISE EXCEPTION
            'Este cliente tem % título(s) vencido(s) em aberto. Baixe em Financeiro → Contas a Receber antes de liberar novo crediário.',
            v_vencidos USING ERRCODE = 'P0001';
        END IF;

        SELECT limite_credito INTO v_limite FROM public.clientes WHERE id = v_orc.cliente_id;
        IF v_limite IS NOT NULL THEN
          v_saldo := COALESCE(public.cliente_saldo_devedor(v_orc.cliente_id), 0);
          IF v_saldo + v_total > v_limite THEN
            RAISE EXCEPTION
              'Limite de crédito insuficiente: teto R$ %, já em aberto R$ %, esta proposta R$ %.',
              to_char(v_limite, 'FM999G999G990D00'),
              to_char(v_saldo,  'FM999G999G990D00'),
              to_char(v_total,  'FM999G999G990D00')
              USING ERRCODE = 'P0001';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.pedidos_venda (
    orcamento_id, cliente_id, vendedor_id, vendedor_nome,
    itens, valor_total, status, filial
  )
  VALUES (
    v_orc.id, v_orc.cliente_id, v_orc.vendedor_id, v_orc.vendedor_nome,
    v_orc.itens, v_total, 'Aguardando Separação', v_orc.filial
  )
  RETURNING id INTO v_pedido_id;

  SELECT nome INTO v_cliente_nome FROM public.clientes WHERE id = v_orc.cliente_id;
  v_desc := 'Pedido Venda #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
            || COALESCE(' - ' || v_cliente_nome, '');

  -- ── Os títulos ───────────────────────────────────────────────────────────
  v_parcela := round(v_total / v_parcelas, 2);

  FOR i IN 1..v_parcelas LOOP
    IF i < v_parcelas THEN
      v_valor := v_parcela;
      v_acum  := v_acum + v_valor;
    ELSE
      -- A última fecha a conta: a soma das parcelas é exatamente o total.
      v_valor := v_total - v_acum;
    END IF;

    v_vencimento := public.acre_today() + v_prazo + (i - 1) * v_intervalo;

    INSERT INTO public.contas_receber (
      cliente_id, descricao, valor, vencimento, status, filial, pedido_venda_id
    )
    VALUES (
      v_orc.cliente_id,
      v_desc || CASE WHEN v_parcelas > 1 THEN format(' (%s/%s)', i, v_parcelas) ELSE '' END,
      v_valor, v_vencimento, 'Aberto', v_orc.filial, v_pedido_id
    )
    RETURNING id INTO v_conta_id;

    IF i = 1 THEN
      v_primeira := v_conta_id;
    END IF;
  END LOOP;

  UPDATE public.pedidos_venda
     SET conta_receber_id = v_primeira
   WHERE id = v_pedido_id;

  UPDATE public.orcamentos
     SET status = 'Convertido em Pedido',
         pedido_venda_id = v_pedido_id
   WHERE id = v_orc.id;

  v_msg := v_desc
           || COALESCE(' — ' || v_orc.forma_pagamento, '')
           || CASE WHEN v_parcelas > 1
                   THEN format(' em %sx de R$ %s', v_parcelas, to_char(v_parcela, 'FM999G999G990D00'))
                   ELSE '' END;

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
    p_titulo     => CASE WHEN v_parcelas > 1
                         THEN format('Contas a receber geradas (%s parcelas)', v_parcelas)
                         ELSE 'Conta a receber gerada' END,
    p_mensagem   => v_msg,
    p_link_view  => 'financeiro-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id
  );

  RETURN v_pedido_id;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Cancelamento: todas as parcelas, não só a primeira
-- ════════════════════════════════════════════════════════════════════════════

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
  --
  -- MIGR 569: soma TODAS as parcelas do pedido. Olhar só `conta_receber_id`
  -- deixaria cancelar um parcelado cuja 4ª parcela o cliente já pagou. O OU com
  -- `conta_receber_id` alcança os pedidos anteriores ao elo novo.
  SELECT COALESCE(SUM(COALESCE(cr.valor_pago, 0)), 0) INTO v_pago
    FROM public.contas_receber cr
   WHERE COALESCE(cr.ativo, true)
     AND (cr.pedido_venda_id = v_ped.id
          OR (v_ped.conta_receber_id IS NOT NULL AND cr.id = v_ped.conta_receber_id));

  IF v_pago > 0 THEN
    RAISE EXCEPTION
      'Este pedido já recebeu R$ % do cliente. Cancelar agora apagaria a cobrança sem devolver o dinheiro. Estorne o pagamento em Financeiro > Contas a receber, ou registre uma devolução.',
      to_char(v_pago, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
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

  -- ── Cobrança: todas as parcelas ──
  UPDATE public.contas_receber cr
     SET status     = 'Cancelado',
         descricao  = cr.descricao || ' — cancelada com o pedido de venda',
         updated_at = now()
   WHERE COALESCE(cr.ativo, true)
     AND (cr.pedido_venda_id = v_ped.id
          OR (v_ped.conta_receber_id IS NOT NULL AND cr.id = v_ped.conta_receber_id))
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) = 0;
  GET DIAGNOSTICS v_conta = ROW_COUNT;

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
    'contas_canceladas', v_conta,
    'orcamento_liberado', v_orc > 0,
    'motivo', NULLIF(btrim(COALESCE(p_motivo, '')), '')
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
