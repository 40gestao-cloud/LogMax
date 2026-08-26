-- 554 — O preço da venda vem do catálogo, não do carrinho.
--
-- `criar_venda_pdv` confere o carrinho com cuidado. Confere que a soma dos itens
-- bate com o total, que `preço × qtd` bate com o subtotal de cada linha, que
-- `total - desconto` bate com o total final, que não há valor negativo, que a
-- quantidade é positiva, que há saldo em estoque. Tudo isso é COERÊNCIA INTERNA:
-- o carrinho não se contradiz.
--
-- O que ela nunca pergunta é quanto o produto custa.
--
-- Teste rodado em 26/08, como a Evilin (colaboradora, setor vendas, SuperMax),
-- dentro de uma transação revertida:
--
--   Grão-de-Bico 500g Camili — preço de cadastro R$ 24,00
--   carrinho: 10 un × R$ 0,01 = R$ 0,10 · total R$ 0,10 · final R$ 0,10
--   → venda gravada, estoque baixou 10, nota fiscal emitida, conta a receber
--     criada. Nenhum erro.
--
-- Todas as validações passaram porque todas olhavam o carrinho contra ele
-- mesmo. R$ 0,01 × 10 = R$ 0,10 é aritmética impecável.
--
-- ─── A PRÓPRIA FUNÇÃO JÁ SABE FAZER ISSO CERTO ─────────────────────────────
--
-- Cinquenta linhas acima, o desconto do cupom é recalculado no servidor e
-- recusado se divergir:
--
--     IF ABS(v_cupom_calc - v_cupom_desc) > 0.01 THEN
--       RAISE EXCEPTION 'Desconto do cupom inconsistente: servidor calculou
--                        R$ %, cliente enviou R$ %.', ...
--
-- O cupom é conferido contra o banco. O preço-base, não. É a mesma pergunta
-- ("o cliente mandou o número certo?") respondida de dois jeitos na mesma
-- função — e o número que não é conferido é o que decide o faturamento inteiro.
--
-- ─── POR QUE A COMPARAÇÃO É COM `produtos.preco`, E SÓ ─────────────────────
--
-- Não existe segunda fonte de preço neste sistema, e isso foi conferido antes
-- de escrever:
--
--   · Promoção não é tabela paralela — a RPC de promoção ESCREVE em
--     `produtos.preco`, e o cron reverte escrevendo de volta (migr. de
--     promoções). No instante da venda, `produtos.preco` é o preço promocional.
--   · Cliente especial não tem preço próprio: `clientes` não tem nenhuma coluna
--     de desconto, tabela de preço ou similar (conferido no
--     `information_schema`).
--   · Variante de grade (MaxLook/TechMax) é uma linha de `produtos` por
--     combinação, cada uma com o seu preço.
--
-- Então o preço do item é `produtos.preco`, ponto. Desconto tem campo próprio,
-- e é lá que ele deve aparecer — inclusive para o DRE saber separar receita
-- bruta de desconto concedido.
--
-- ─── E O DESCONTO DE 100%? ─────────────────────────────────────────────────
--
-- Fica possível, de propósito. O mesmo teste fechou uma venda de R$ 240 em
-- R$ 0,00 via `p_desconto`, e isso NÃO é consertado aqui: a compra tem alçada
-- (`alcadas_compra.valor_limite_financeiro`) e a venda não tem a espelhada, mas
-- qual é o teto de desconto de um vendedor é decisão de quem ensina, não minha.
-- A diferença é que agora o desconto aparece como desconto — num campo
-- auditável, no DRE, na tela — em vez de se disfarçar de preço.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.criar_venda_pdv(
  p_cliente_id uuid, p_total numeric, p_desconto numeric, p_total_final numeric,
  p_forma_pagamento text, p_parcelas integer, p_itens jsonb,
  p_filial text DEFAULT NULL::text, p_cupom_codigo text DEFAULT NULL::text,
  p_cupom_desconto numeric DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_produtos_resumo text;
  v_estoque_atual numeric(15,3);
  v_nome_produto  text;
  v_qtd_pedida    numeric(15,3);
  v_produto_id    uuid;
  v_soma_itens    numeric(15,2);
  v_desconto      numeric(15,2) := COALESCE(p_desconto, 0);
  v_filial        text          := COALESCE(p_filial, 'Matriz');
  v_cupom         marketing_cupons;
  v_cupom_desc    numeric(15,2) := COALESCE(p_cupom_desconto, 0);
  v_cupom_calc    numeric(15,2);
  v_tem_cupom     boolean := p_cupom_codigo IS NOT NULL AND length(trim(p_cupom_codigo)) > 0;
  v_conta_receber_id uuid;
  v_preco_cat     numeric(15,2);   -- MIGR 554
  v_preco_env     numeric(15,2);   -- MIGR 554
  i               integer;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  -- MIGR 554: a porta da frente também confere a unidade. Até aqui, quem
  -- barrava venda em nome de outra filial era o guard do `emitir_nota`, no
  -- ÚLTIMO comando da função — funciona porque a transação aborta inteira, mas
  -- deixava a régua dependendo de a emissão de nota continuar existindo.
  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Você opera o PDV da sua unidade — esta venda está sendo lançada como %.', v_filial
      USING ERRCODE = '42501';
  END IF;

  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas;
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0)
    INTO v_soma_itens
    FROM jsonb_array_elements(p_itens) item;

  IF ABS(v_soma_itens - p_total) > 0.01 THEN
    RAISE EXCEPTION 'Soma dos itens (R$ %) não bate com o total enviado (R$ %).',
      to_char(v_soma_itens, 'FM999G999G990D00'),
      to_char(p_total,      'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  IF ABS((p_total - v_desconto) - p_total_final) > 0.01 THEN
    RAISE EXCEPTION 'Total final (R$ %) inconsistente com total (R$ %) e desconto (R$ %).',
      to_char(p_total_final, 'FM999G999G990D00'),
      to_char(p_total,       'FM999G999G990D00'),
      to_char(v_desconto,    'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_total_final < 0 OR p_total < 0 OR v_desconto < 0 THEN
    RAISE EXCEPTION 'Valores negativos não permitidos.' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF (v_item->>'qtd')::numeric <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida no item "%".', v_item->>'nome_produto'
        USING ERRCODE = 'P0001';
    END IF;
    IF ABS(((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::numeric) - (v_item->>'subtotal')::numeric) > 0.01 THEN
      RAISE EXCEPTION 'Subtotal incoerente no item "%": esperado R$ %, recebido R$ %.',
        v_item->>'nome_produto',
        to_char((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::numeric, 'FM999G999G990D00'),
        to_char((v_item->>'subtotal')::numeric, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;

    -- ── MIGR 554: o preço é do catálogo ──────────────────────────────────
    -- Mesma régua e mesma forma de mensagem do cupom, cinquenta linhas acima:
    -- o servidor diz o que tem, o cliente diz o que mandou, e a divergência é
    -- erro em vez de virar faturamento.
    v_produto_id := NULLIF(v_item->>'produto_id', '')::uuid;
    IF v_produto_id IS NULL THEN
      RAISE EXCEPTION 'Item "%" não aponta para um produto do catálogo.',
        COALESCE(v_item->>'nome_produto', '(sem nome)') USING ERRCODE = 'P0001';
    END IF;

    SELECT preco, nome INTO v_preco_cat, v_nome_produto
      FROM public.produtos WHERE id = v_produto_id;
    IF v_nome_produto IS NULL THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
    END IF;

    v_preco_env := (v_item->>'preco_unitario')::numeric;
    IF ABS(COALESCE(v_preco_cat, 0) - v_preco_env) > 0.01 THEN
      RAISE EXCEPTION
        'Preço de "%" não confere: no catálogo está R$ %, e a venda foi enviada com R$ %. Se o preço mudou, recarregue a tela; se é abatimento, use o campo Desconto — é ele que o DRE lê para separar receita de desconto concedido.',
        v_nome_produto,
        to_char(COALESCE(v_preco_cat, 0), 'FM999G999G990D00'),
        to_char(v_preco_env,              'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF v_tem_cupom THEN
    SELECT * INTO v_cupom
      FROM marketing_cupons
     WHERE UPPER(codigo) = UPPER(trim(p_cupom_codigo))
       AND ativo = true
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cupom "%" não encontrado.', p_cupom_codigo USING ERRCODE = 'P0001';
    END IF;
    IF v_cupom.validade_inicio IS NOT NULL AND v_today < v_cupom.validade_inicio THEN
      RAISE EXCEPTION 'Cupom só passa a valer em %.', to_char(v_cupom.validade_inicio, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
    END IF;
    IF v_today > v_cupom.validade_fim THEN
      RAISE EXCEPTION 'Cupom expirou em %.', to_char(v_cupom.validade_fim, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
    END IF;
    IF v_cupom.filial IS NOT NULL AND v_cupom.filial <> v_filial THEN
      RAISE EXCEPTION 'Cupom válido apenas em %.', v_cupom.filial USING ERRCODE = 'P0001';
    END IF;
    IF p_total < v_cupom.valor_minimo THEN
      RAISE EXCEPTION 'Compra mínima de R$ % para usar este cupom.',
        to_char(v_cupom.valor_minimo, 'FM999G999G990D00') USING ERRCODE = 'P0001';
    END IF;
    IF v_cupom.limite_uso IS NOT NULL AND v_cupom.usos >= v_cupom.limite_uso THEN
      RAISE EXCEPTION 'Cupom atingiu o limite de usos.' USING ERRCODE = 'P0001';
    END IF;

    IF v_cupom.tipo = 'percentual' THEN
      v_cupom_calc := ROUND(p_total * v_cupom.valor / 100.0, 2);
      IF v_cupom.desconto_maximo IS NOT NULL AND v_cupom_calc > v_cupom.desconto_maximo THEN
        v_cupom_calc := v_cupom.desconto_maximo;
      END IF;
    ELSE
      v_cupom_calc := v_cupom.valor;
    END IF;
    IF v_cupom_calc > p_total THEN v_cupom_calc := p_total; END IF;

    IF ABS(v_cupom_calc - v_cupom_desc) > 0.01 THEN
      RAISE EXCEPTION 'Desconto do cupom inconsistente: servidor calculou R$ %, cliente enviou R$ %.',
        to_char(v_cupom_calc, 'FM999G999G990D00'),
        to_char(v_cupom_desc, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
    IF v_desconto + 0.01 < v_cupom_calc THEN
      RAISE EXCEPTION 'Desconto total (R$ %) menor que o cupom (R$ %).',
        to_char(v_desconto,   'FM999G999G990D00'),
        to_char(v_cupom_calc, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR v_produto_id, v_qtd_pedida IN
    SELECT (item->>'produto_id')::uuid, SUM((item->>'qtd')::numeric)
      FROM jsonb_array_elements(p_itens) item
     GROUP BY (item->>'produto_id')::uuid ORDER BY 1
  LOOP
    SELECT estoque, nome INTO v_estoque_atual, v_nome_produto
      FROM produtos WHERE id = v_produto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
    END IF;
    IF v_estoque_atual < v_qtd_pedida THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%": disponível %, pedido %.',
        v_nome_produto, v_estoque_atual, v_qtd_pedida USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO vendas (
    cliente_id, total, desconto, total_final, forma_pagamento, status, filial,
    cupom_id, cupom_codigo, cupom_desconto
  ) VALUES (
    p_cliente_id, p_total, v_desconto, p_total_final, p_forma_pagamento, 'Concluída', v_filial,
    CASE WHEN v_tem_cupom THEN v_cupom.id     ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom.codigo ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom_calc   ELSE 0    END
  ) RETURNING id INTO v_venda_id;

  v_short_id := UPPER(RIGHT(v_venda_id::text, 6));

  IF p_cliente_id IS NOT NULL THEN
    SELECT nome INTO v_cliente_nome FROM clientes WHERE id = p_cliente_id;
  END IF;

  SELECT string_agg(
    CASE WHEN (item->>'qtd')::numeric <> 1
      THEN replace((item->>'qtd'), '.', ',') || 'x ' || (item->>'nome_produto')
      ELSE (item->>'nome_produto')
    END, ', ' ORDER BY ord
  ) INTO v_produtos_resumo
  FROM jsonb_array_elements(p_itens) WITH ORDINALITY AS t(item, ord);

  IF v_produtos_resumo IS NULL THEN v_produtos_resumo := ''; END IF;
  IF length(v_produtos_resumo) > 80 THEN
    v_produtos_resumo := left(v_produtos_resumo, 80) || '...';
  END IF;

  v_desc_base := 'Venda PDV ' || v_produtos_resumo || ' #' || v_short_id;
  IF v_cliente_nome IS NOT NULL THEN
    v_desc_base := v_desc_base || ' — ' || v_cliente_nome;
  END IF;
  IF v_tem_cupom THEN
    v_desc_base := v_desc_base || ' [cupom ' || v_cupom.codigo || ']';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO itens_venda (venda_id, produto_id, nome_produto, qtd, preco_unitario, subtotal)
    VALUES (v_venda_id, (v_item->>'produto_id')::uuid, v_item->>'nome_produto',
            (v_item->>'qtd')::numeric, (v_item->>'preco_unitario')::numeric, (v_item->>'subtotal')::numeric);

    INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES ((v_item->>'produto_id')::uuid, 'Saída', (v_item->>'qtd')::numeric,
            'PDV', 'Venda #' || v_short_id, v_today, v_filial);
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
      INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
      VALUES (p_cliente_id, v_desc_base || ' - Parcela ' || i || '/' || v_parcelas || ' (Cartão Crédito)',
              v_valor_atual, v_today + (30 * i), 'Aberto', v_filial, v_venda_id);
    END LOOP;
    -- Venda parcelada gera N contas — a nota fiscal cobre a venda inteira,
    -- então deixa NULL e usa venda_id como ponto de amarração.
    v_conta_receber_id := NULL;
  ELSIF p_forma_pagamento = 'Fiado' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
    VALUES (p_cliente_id, v_desc_base || ' (Fiado)', p_total_final, v_today + 30, 'Aberto', v_filial, v_venda_id)
    RETURNING id INTO v_conta_receber_id;
  ELSIF p_forma_pagamento = 'Cartão Crédito' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
    VALUES (p_cliente_id, v_desc_base || ' (Cartão Crédito 1x)', p_total_final, v_today + 30, 'Aberto', v_filial, v_venda_id)
    RETURNING id INTO v_conta_receber_id;
  ELSE
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
    VALUES (p_cliente_id, v_desc_base || ' (' || p_forma_pagamento || ')', p_total_final, v_today, 'Pago', v_filial, v_venda_id)
    RETURNING id INTO v_conta_receber_id;
  END IF;

  IF v_tem_cupom THEN
    UPDATE marketing_cupons SET usos = usos + 1 WHERE id = v_cupom.id;
  END IF;

  -- Auto-emite NF Produto pra rastreio de faturamento.
  -- Advisory lock (dentro de emitir_nota) evita corrida na numeração
  -- entre PDV concorrente e emissão manual do mesmo (filial, serie).
  PERFORM public.emitir_nota(
    p_filial          => v_filial,
    p_tipo            => 'NF Produto',
    p_origem          => 'pdv',
    p_cliente_id      => p_cliente_id,
    p_cliente_nome    => v_cliente_nome,
    p_valor_total     => p_total_final,
    p_descricao       => v_desc_base,
    p_venda_id        => v_venda_id,
    p_conta_receber_id => v_conta_receber_id,
    p_data_emissao    => v_today,
    p_serie           => '001'
  );

  RETURN v_venda_id;
END;
$function$;

COMMIT;
