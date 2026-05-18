-- =================================================================
-- LogMax — Holding: coluna `filial` (unidade de negócio)
-- =================================================================
-- A operação passou a ser multi-empresa (SuperMax, MaxLook, TechMax)
-- dentro do mesmo banco. Esta migration adiciona a coluna `filial`
-- (texto livre, frontend valida contra `FILIAIS_HOLDING`) nas tabelas
-- principais e atualiza `criar_venda_pdv` para receber/persistir a
-- filial origem da venda.
--
-- Default 'Matriz' nas linhas existentes — admin reatribui depois.
-- Idempotente (IF NOT EXISTS).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

ALTER TABLE produtos      ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';
ALTER TABLE clientes      ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';
ALTER TABLE fornecedores  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';
ALTER TABLE vendas        ADD COLUMN IF NOT EXISTS filial text;

-- Índices: filtragem por filial é o padrão em listagens e dashboard.
CREATE INDEX IF NOT EXISTS idx_produtos_filial      ON produtos(filial);
CREATE INDEX IF NOT EXISTS idx_clientes_filial      ON clientes(filial);
CREATE INDEX IF NOT EXISTS idx_fornecedores_filial  ON fornecedores(filial);
CREATE INDEX IF NOT EXISTS idx_user_profiles_filial ON user_profiles(filial);
CREATE INDEX IF NOT EXISTS idx_vendas_filial_data   ON vendas(filial, created_at DESC) WHERE filial IS NOT NULL;

-- Atualiza criar_venda_pdv para aceitar e persistir a filial origem.
-- Compatível com o front antigo via DEFAULT NULL (omitir o parâmetro
-- mantém comportamento atual: venda sem filial atribuída).
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
  v_today         date := CURRENT_DATE;
  v_item          jsonb;
  v_parcela_valor numeric(15,2);
  v_acumulado     numeric(15,2) := 0;
  v_valor_atual   numeric(15,2);
  v_parcelas      integer := COALESCE(p_parcelas, 1);
  v_desc_base     text;
  i               integer;
BEGIN
  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas;
  END IF;

  INSERT INTO vendas (cliente_id, total, desconto, total_final, forma_pagamento, status, filial)
  VALUES (p_cliente_id, p_total, p_desconto, p_total_final, p_forma_pagamento, 'Concluída', p_filial)
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
      INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
      VALUES (p_cliente_id, v_desc_base || ' - Parcela ' || i || '/' || v_parcelas || ' (Cartão Crédito)',
              v_valor_atual, v_today + (30 * i), 'Aberto');
    END LOOP;
  ELSIF p_forma_pagamento = 'Fiado' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
    VALUES (p_cliente_id, v_desc_base || ' (Fiado)', p_total_final, v_today + 30, 'Aberto');
  ELSIF p_forma_pagamento = 'Cartão Crédito' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
    VALUES (p_cliente_id, v_desc_base || ' (Cartão Crédito 1x)', p_total_final, v_today + 30, 'Aberto');
  ELSE
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status)
    VALUES (p_cliente_id, v_desc_base || ' (' || p_forma_pagamento || ')', p_total_final, v_today, 'Pago');
  END IF;

  RETURN v_venda_id;
END;
$$;

-- Re-grant (idempotente — não causa erro se já existir).
GRANT EXECUTE ON FUNCTION criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text) TO authenticated;

COMMIT;
