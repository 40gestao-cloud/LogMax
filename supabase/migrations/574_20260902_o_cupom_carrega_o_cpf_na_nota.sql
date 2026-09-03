-- O cupom carrega o CPF na nota.
--
-- O aluno treina no MaxPOS e opera no LogMax. No MaxPOS o fechamento da venda
-- tem três extras — CPF/CNPJ na nota, cliente vinculado e Vale-Alimentação —
-- e no LogMax só existia o cliente, e mesmo assim apenas dentro do Fiado. Quem
-- aprendeu a pedir o CPF chegava aqui e não achava onde digitar.
--
-- Dos três, dois são só tela: "vincular cliente" já tem coluna (`vendas.
-- cliente_id`, hoje preenchida só pelo Fiado) e o Vale entra como mais uma
-- forma de pagamento — `p_forma_pagamento` é texto livre e cai no ELSE que
-- lança a conta a receber como paga no dia, que é exatamente o comportamento
-- de um voucher: não é dinheiro na gaveta (`p_valor_dinheiro` continua zero) e
-- não é crédito a prazo.
--
-- O CPF na nota é o que não tinha onde morar: `vendas` não guardava documento
-- nenhum. Esta migração abre a coluna e passa a recebê-la pela RPC.
--
-- Duas decisões que valem registro:
--
--   1. A coluna guarda SÓ DÍGITOS. A máscara é da tela; o banco que normaliza
--      evita que a mesma pessoa apareça como "123.456.789-00" e "12345678900"
--      em dois relatórios. O CHECK aceita 11 (CPF) ou 14 (CNPJ) — o sistema é
--      didático, então conferimos o tamanho, não o dígito verificador.
--   2. A RPC ganha parâmetro NOVO com DEFAULT, o que criaria uma sobrecarga:
--      duas `criar_venda_pdv` visíveis para o PostgREST derrubam a chamada com
--      PGRST203 (ambíguo). Por isso a versão de 11 argumentos é derrubada logo
--      depois de a de 12 existir, e o `NOTIFY pgrst` no fim recarrega o cache
--      do schema — sem ele o PDV chama a assinatura que o cache ainda conhece.
--
-- O PDV dos nichos (MaxLook/TechMax) chama a mesma RPC sem o parâmetro novo:
-- como a chamada do PostgREST é por nome e o argumento tem DEFAULT, ela segue
-- funcionando e grava NULL — que é o que "não informou CPF" significa.

BEGIN;

ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS cpf_cnpj_nota text;

COMMENT ON COLUMN public.vendas.cpf_cnpj_nota IS
  'CPF (11) ou CNPJ (14) informado pelo cliente no fechamento, só dígitos. NULL = não informou.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.vendas'::regclass
       AND conname  = 'vendas_cpf_cnpj_nota_formato'
  ) THEN
    ALTER TABLE public.vendas
      ADD CONSTRAINT vendas_cpf_cnpj_nota_formato
      CHECK (cpf_cnpj_nota IS NULL OR cpf_cnpj_nota ~ '^([0-9]{11}|[0-9]{14})$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.criar_venda_pdv(
  p_cliente_id uuid,
  p_total numeric,
  p_desconto numeric,
  p_total_final numeric,
  p_forma_pagamento text,
  p_parcelas integer,
  p_itens jsonb,
  p_filial text DEFAULT NULL::text,
  p_cupom_codigo text DEFAULT NULL::text,
  p_cupom_desconto numeric DEFAULT 0,
  p_valor_dinheiro numeric DEFAULT NULL::numeric,
  p_cpf_nota text DEFAULT NULL::text
)
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
  v_dinheiro      numeric(15,2);   -- MIGR 562
  v_cpf           text;            -- MIGR 574
  i               integer;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  -- MIGR 554: a porta da frente também confere a unidade.
  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Você opera o PDV da sua unidade — esta venda está sendo lançada como %.', v_filial
      USING ERRCODE = '42501';
  END IF;

  -- MIGR 574: o documento chega mascarado da tela e é guardado só em dígitos.
  v_cpf := NULLIF(regexp_replace(COALESCE(p_cpf_nota, ''), '[^0-9]', '', 'g'), '');
  IF v_cpf IS NOT NULL AND length(v_cpf) NOT IN (11, 14) THEN
    RAISE EXCEPTION 'Documento na nota inválido: CPF tem 11 dígitos e CNPJ tem 14, e vieram %.', length(v_cpf)
      USING ERRCODE = 'P0001';
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

  -- MIGR 562: quanto desta venda entra em espécie. Omitido, vale a regra
  -- antiga — forma que começa com "Dinheiro" leva o total. É o que mantém
  -- chamador antigo correto, em vez de silenciosamente zerado.
  v_dinheiro := COALESCE(
    p_valor_dinheiro,
    CASE WHEN COALESCE(p_forma_pagamento, '') ILIKE 'dinheiro%' THEN p_total_final ELSE 0 END
  );
  IF v_dinheiro < 0 OR v_dinheiro > p_total_final + 0.005 THEN
    RAISE EXCEPTION 'Dinheiro recebido (R$ %) não pode ser negativo nem maior que o total da venda (R$ %).',
      to_char(v_dinheiro,    'FM999G999G990D00'),
      to_char(p_total_final, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
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

    -- MIGR 554: o preço é do catálogo.
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
    cupom_id, cupom_codigo, cupom_desconto, valor_dinheiro, cpf_cnpj_nota
  ) VALUES (
    p_cliente_id, p_total, v_desconto, p_total_final, p_forma_pagamento, 'Concluída', v_filial,
    CASE WHEN v_tem_cupom THEN v_cupom.id     ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom.codigo ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom_calc   ELSE 0    END,
    v_dinheiro, v_cpf
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

-- A de 11 argumentos sai de cena: com as duas visíveis, o PostgREST recusa a
-- chamada por ambiguidade (PGRST203) em vez de escolher uma.
DROP FUNCTION IF EXISTS public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric,numeric);

REVOKE ALL ON FUNCTION public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric,numeric,text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
