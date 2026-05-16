-- =================================================================
-- LogMax — PDV ↔ Financeiro (integração transacional + parcelamento)
-- =================================================================
-- Objetivo:
--   1. Toda venda PDV gera lançamento automático em contas_receber.
--   2. Operação em bloco (transação): se algum INSERT falhar, ROLLBACK.
--   3. Suporte a parcelamento no Cartão de Crédito (1x–12x).
--
-- Comportamento por forma de pagamento:
--   • Dinheiro / Cartão Débito / PIX  → 1 lançamento Pago (vencimento = hoje)
--   • Cartão Crédito (1x)             → 1 lançamento Aberto (venc. = hoje + 30d)
--   • Cartão Crédito (Nx, N>1)        → N lançamentos Aberto (venc. = +30d, +60d, ...)
--   • Fiado                            → 1 lançamento Aberto (venc. = hoje + 30d)
--
-- Execute no Supabase SQL Editor.
-- =================================================================

CREATE OR REPLACE FUNCTION criar_venda_pdv(
  p_cliente_id     uuid,
  p_total          numeric,
  p_desconto       numeric,
  p_total_final    numeric,
  p_forma_pagamento text,
  p_parcelas       integer,
  p_itens          jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda_id        uuid;
  v_short_id        text;
  v_cliente_nome    text;
  v_today           date := CURRENT_DATE;
  v_item            jsonb;
  v_parcela_valor   numeric(15,2);
  v_acumulado       numeric(15,2) := 0;
  v_valor_atual     numeric(15,2);
  v_parcelas        integer := COALESCE(p_parcelas, 1);
  v_desc_base       text;
  i                 integer;
BEGIN
  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas;
  END IF;

  -- 1. Inserir venda
  INSERT INTO vendas (cliente_id, total, desconto, total_final, forma_pagamento, status)
  VALUES (p_cliente_id, p_total, p_desconto, p_total_final, p_forma_pagamento, 'Concluída')
  RETURNING id INTO v_venda_id;

  v_short_id := UPPER(RIGHT(v_venda_id::text, 6));

  IF p_cliente_id IS NOT NULL THEN
    SELECT nome INTO v_cliente_nome FROM clientes WHERE id = p_cliente_id;
  END IF;

  v_desc_base := 'Venda PDV #' || v_short_id;
  IF v_cliente_nome IS NOT NULL THEN
    v_desc_base := v_desc_base || ' — ' || v_cliente_nome;
  END IF;

  -- 2. Inserir itens + movimentações de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO itens_venda (venda_id, produto_id, nome_produto, qtd, preco_unitario, subtotal)
    VALUES (
      v_venda_id,
      (v_item->>'produto_id')::uuid,
       v_item->>'nome_produto',
      (v_item->>'qtd')::int,
      (v_item->>'preco_unitario')::numeric,
      (v_item->>'subtotal')::numeric
    );

    INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data)
    VALUES (
      (v_item->>'produto_id')::uuid,
      'Saída',
      (v_item->>'qtd')::int,
      'PDV',
      'Venda #' || v_short_id,
      v_today
    );
  END LOOP;

  -- 3. Lançamentos financeiros
  IF p_forma_pagamento = 'Cartão Crédito' AND v_parcelas > 1 THEN
    -- Parcelado: divide igualmente, ajustando arredondamento na última parcela
    v_parcela_valor := ROUND(p_total_final / v_parcelas, 2);
    FOR i IN 1..v_parcelas LOOP
      IF i = v_parcelas THEN
        v_valor_atual := p_total_final - v_acumulado;
      ELSE
        v_valor_atual := v_parcela_valor;
        v_acumulado   := v_acumulado + v_parcela_valor;
      END IF;
      INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
      VALUES (
        p_cliente_id,
        v_desc_base || ' - Parcela ' || i || '/' || v_parcelas || ' (Cartão Crédito)',
        v_valor_atual,
        v_today + (30 * i),
        'Aberto'
      );
    END LOOP;
  ELSIF p_forma_pagamento = 'Fiado' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
    VALUES (
      p_cliente_id,
      v_desc_base || ' (Fiado)',
      p_total_final,
      v_today + 30,
      'Aberto'
    );
  ELSIF p_forma_pagamento = 'Cartão Crédito' THEN
    -- 1x à prazo: aberto, +30d
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
    VALUES (
      p_cliente_id,
      v_desc_base || ' (Cartão Crédito 1x)',
      p_total_final,
      v_today + 30,
      'Aberto'
    );
  ELSE
    -- Dinheiro / Cartão Débito / PIX → recebimento à vista
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
    VALUES (
      p_cliente_id,
      v_desc_base || ' (' || p_forma_pagamento || ')',
      p_total_final,
      v_today,
      'Pago'
    );
  END IF;

  RETURN v_venda_id;
END;
$$;

-- Permite que clientes autenticados (PDV) chamem a função.
GRANT EXECUTE ON FUNCTION criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb) TO authenticated;
