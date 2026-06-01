-- =================================================================
-- LogMax — Propaga p_filial para contas_receber em criar_venda_pdv
-- =================================================================
-- Última versão estável: 20260530_acre_timezone_fix.sql. Mudança única:
-- os 4 INSERTs em contas_receber agora gravam a coluna `filial` com o
-- valor recebido em p_filial (DEFAULT 'Matriz' aplicado pelo schema
-- quando p_filial vier NULL — ver 20260601_filial_contas.sql).
--
-- O restante do corpo permanece byte-a-byte idêntico para evitar
-- regressão. Execute APÓS 20260601_filial_contas.sql, senão a coluna
-- ainda não existe e o CREATE OR REPLACE falha.
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
  p_itens          jsonb,
  p_filial         text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_venda_id      uuid;
  v_short_id      text;
  v_cliente_nome  text;
  v_today         date := public.acre_today();
  v_item          jsonb;
  v_parcela_valor numeric(15,2);
  v_acumulado     numeric(15,2) := 0;
  v_valor_atual   numeric(15,2);
  v_parcelas      integer := COALESCE(p_parcelas, 1);
  v_desc_base     text;
  v_estoque_atual integer;
  v_nome_produto  text;
  v_qtd_pedida    integer;
  v_produto_id    uuid;
  v_soma_itens    numeric(15,2);
  v_desconto      numeric(15,2) := COALESCE(p_desconto, 0);
  v_filial        text          := COALESCE(p_filial, 'Matriz');
  i               integer;
BEGIN
  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas;
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.' USING ERRCODE = 'P0001';
  END IF;

  -- ─── Validação de coerência de valores ────────────────────────────
  SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0)
    INTO v_soma_itens
    FROM jsonb_array_elements(p_itens) item;

  IF ABS(v_soma_itens - p_total) > 0.01 THEN
    RAISE EXCEPTION
      'Soma dos itens (R$ %) não bate com o total enviado (R$ %).',
      to_char(v_soma_itens, 'FM999G999G990D00'),
      to_char(p_total,      'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  IF ABS((p_total - v_desconto) - p_total_final) > 0.01 THEN
    RAISE EXCEPTION
      'Total final (R$ %) inconsistente com total (R$ %) e desconto (R$ %).',
      to_char(p_total_final, 'FM999G999G990D00'),
      to_char(p_total,       'FM999G999G990D00'),
      to_char(v_desconto,    'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_total_final < 0 OR p_total < 0 OR v_desconto < 0 THEN
    RAISE EXCEPTION 'Valores negativos não permitidos.' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF (v_item->>'qtd')::int < 1 THEN
      RAISE EXCEPTION 'Quantidade inválida no item "%".', v_item->>'nome_produto'
        USING ERRCODE = 'P0001';
    END IF;
    IF ABS(((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::int) - (v_item->>'subtotal')::numeric) > 0.01 THEN
      RAISE EXCEPTION
        'Subtotal incoerente no item "%": esperado R$ %, recebido R$ %.',
        v_item->>'nome_produto',
        to_char((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::int, 'FM999G999G990D00'),
        to_char((v_item->>'subtotal')::numeric, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ─── Lock + validação de estoque ──────────────────────────────────
  FOR v_produto_id, v_qtd_pedida IN
    SELECT (item->>'produto_id')::uuid,
           SUM((item->>'qtd')::int)
      FROM jsonb_array_elements(p_itens) item
     GROUP BY (item->>'produto_id')::uuid
  LOOP
    SELECT estoque, nome
      INTO v_estoque_atual, v_nome_produto
      FROM produtos
     WHERE id = v_produto_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_estoque_atual < v_qtd_pedida THEN
      RAISE EXCEPTION
        'Estoque insuficiente para "%": disponível %, pedido %.',
        v_nome_produto, v_estoque_atual, v_qtd_pedida
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ─── Inserts ───────────────────────────────────────────────────────
  INSERT INTO vendas (cliente_id, total, desconto, total_final, forma_pagamento, status, filial)
  VALUES (p_cliente_id, p_total, v_desconto, p_total_final, p_forma_pagamento, 'Concluída', v_filial)
  RETURNING id INTO v_venda_id;

  v_short_id := UPPER(RIGHT(v_venda_id::text, 6));

  IF p_cliente_id IS NOT NULL THEN
    SELECT nome INTO v_cliente_nome FROM clientes WHERE id = p_cliente_id;
  END IF;

  v_desc_base := 'Venda PDV #' || v_short_id;
  IF v_cliente_nome IS NOT NULL THEN
    v_desc_base := v_desc_base || ' — ' || v_cliente_nome;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO itens_venda (venda_id, produto_id, nome_produto, qtd, preco_unitario, subtotal)
    VALUES (v_venda_id, (v_item->>'produto_id')::uuid, v_item->>'nome_produto',
            (v_item->>'qtd')::int, (v_item->>'preco_unitario')::numeric, (v_item->>'subtotal')::numeric);

    INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data)
    VALUES ((v_item->>'produto_id')::uuid, 'Saída', (v_item->>'qtd')::int,
            'PDV', 'Venda #' || v_short_id, v_today);
  END LOOP;

  IF p_forma_pagamento = 'Cartão Crédito' AND v_parcelas > 1 THEN
    v_parcela_valor := ROUND(p_total_final / v_parcelas, 2);
    FOR i IN 1..v_parcelas LOOP
      IF i = v_parcelas THEN
        v_valor_atual := p_total_final - v_acumulado;
      ELSE
        v_valor_atual := v_parcela_valor;
        v_acumulado := v_acumulado + v_parcela_valor;
      END IF;
      INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial)
      VALUES (p_cliente_id, v_desc_base || ' - Parcela ' || i || '/' || v_parcelas || ' (Cartão Crédito)',
              v_valor_atual, v_today + (30 * i), 'Aberto', v_filial);
    END LOOP;
  ELSIF p_forma_pagamento = 'Fiado' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial)
    VALUES (p_cliente_id, v_desc_base || ' (Fiado)', p_total_final, v_today + 30, 'Aberto', v_filial);
  ELSIF p_forma_pagamento = 'Cartão Crédito' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial)
    VALUES (p_cliente_id, v_desc_base || ' (Cartão Crédito 1x)', p_total_final, v_today + 30, 'Aberto', v_filial);
  ELSE
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial)
    VALUES (p_cliente_id, v_desc_base || ' (' || p_forma_pagamento || ')', p_total_final, v_today, 'Pago', v_filial);
  END IF;

  RETURN v_venda_id;
END;
$$;

GRANT EXECUTE ON FUNCTION criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text)
  TO authenticated;
