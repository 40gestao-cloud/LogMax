-- =================================================================
-- LogMax — Segurança transacional do PDV (estoque + Pix órfão)
-- =================================================================
-- Resolve dois riscos identificados em auditoria:
--
-- 1) Overselling silencioso: duas vendas concorrentes no mesmo SKU
--    passavam pelo check de estoque do front e pelo RPC sem trava;
--    o trigger fn_atualiza_estoque_produto usa GREATEST(0, ...) e
--    apenas zera o saldo, sem rejeitar a segunda venda. Aqui o
--    criar_venda_pdv ganha SELECT ... FOR UPDATE por SKU e RAISE
--    EXCEPTION quando o saldo não cobre a quantidade pedida — a
--    transação inteira rola back e nenhum venda/contas_receber/
--    movimentação fica para trás.
--
-- 2) Pix órfão: pix_pendentes em 'aguardando' indefinidamente quando
--    o caixa fecha a aba antes da confirmação. Adicionada coluna
--    operador_id (preenchida pelo PDV) pra UI poder oferecer cancelar
--    pendentes do próprio operador ao re-abrir; RPC dedicado faz o
--    cleanup automático (Vercel Cron de hora em hora cancela > 30 min).
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─── Parte 1 — coluna operador_id em pix_pendentes ──────────────────
ALTER TABLE pix_pendentes
  ADD COLUMN IF NOT EXISTS operador_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pix_pendentes_operador_status_idx
  ON pix_pendentes (operador_id, status, created_at DESC)
  WHERE status = 'aguardando';

-- ─── Parte 2 — RPC de limpeza (cancela aguardando > p_idade_min) ────
-- Chamada pelo Vercel Cron via /api/cancelar-pix-pendentes-antigos.
-- Idade default = 30 min: deixa folga pro cliente real terminar a
-- confirmação sem matar o pendente, mas garante que após a sessão do
-- caixa fechar não fica resíduo escutando.
CREATE OR REPLACE FUNCTION public.cancelar_pix_pendentes_antigos(
  p_idade_min integer DEFAULT 30
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
BEGIN
  IF p_idade_min < 1 THEN
    RAISE EXCEPTION 'Idade mínima precisa ser >= 1 minuto';
  END IF;

  UPDATE pix_pendentes
     SET status = 'cancelado'
   WHERE status = 'aguardando'
     AND created_at < now() - (p_idade_min || ' minutes')::interval;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_pix_pendentes_antigos(integer) FROM public;
-- Service role chamará via endpoint /api; authenticated pode chamar
-- manualmente também (admin → "limpar pendentes" futuro).
GRANT EXECUTE ON FUNCTION public.cancelar_pix_pendentes_antigos(integer)
  TO authenticated, service_role;

-- ─── Parte 3 — criar_venda_pdv com lock pessimista de estoque ───────
-- Substitui a versão de 20260517_holding_filial.sql adicionando:
--   • SELECT ... FOR UPDATE em produtos antes de cada item, agrupando
--     o lock por SKU (uma transação só lê o produto uma vez).
--   • Validação `estoque >= qtd` por SKU — RAISE EXCEPTION P0001 com
--     mensagem amigável ("Estoque insuficiente para X: disponível Y").
--
-- O RAISE rolba toda a transação: nem venda, nem itens, nem
-- contas_receber, nem movimentações são gravados. O frontend mostra a
-- mensagem como toast e reabilita o botão.
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
  v_estoque_atual integer;
  v_nome_produto  text;
  v_qtd_pedida    integer;
  v_produto_id    uuid;
  i               integer;
BEGIN
  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas;
  END IF;

  -- ─── Lock + validação de estoque ANTES de qualquer INSERT ─────────
  -- Itera os itens agregados por produto_id (mesmo SKU repetido no
  -- carrinho soma a quantidade). FOR UPDATE serializa contra outras
  -- transações que estejam tentando reservar o mesmo SKU.
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

  -- ─── A partir daqui o estoque está reservado ──────────────────────
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

GRANT EXECUTE ON FUNCTION criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text)
  TO authenticated;

COMMIT;
