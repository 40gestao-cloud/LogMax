-- 660_20260928_pagamento_estruturado_e_pedido_de_venda_e_venda.sql
--
-- Dois buracos que a formação de preço (656-659) deixou à vista:
--
-- 1. A VENDA MISTA NÃO TINHA FORMA. O PDV gravava "Misto: PIX R$ 10,00 +
--    Dinheiro R$ 20,00" como texto, e a taxa média da precificação (657)
--    deixava essas vendas de fora — deduzir forma de texto é a armadilha da
--    migr. 562. Agora toda venda grava as partes do pagamento em
--    `vendas_pagamentos` (forma, tipo do cadastro, valor, parcelas):
--      • `criar_venda_pdv` ganha `p_pagamentos` (as linhas do misto); sem ele,
--        forma única vira uma linha só. Misto de tela antiga fica sem linhas
--        (e fora do mix, como antes) — nada quebra.
--      • `_taxa_pelo_mix` lê as linhas; venda anterior a esta migração cai na
--        regra antiga (forma do PDV).
--
-- 2. O PEDIDO DE VENDA NÃO ERA VENDA. `converter_orcamento_em_pedido` criava
--    o pedido e a cobrança, mas nenhuma linha em `vendas` — então a receita
--    do orçamento nunca chegou ao DRE nem ao Simples, e o custo da mercadoria
--    também não. Agora a conversão É o faturamento:
--      • nasce a venda (com `pedido_venda_id`), os itens, a parte do
--        pagamento (tipo vindo de `formas_pagamento.tipo`) e as notas — NF-e
--        para produto, NFS-e para serviço (origem 'pedido_venda');
--      • o orçamento aceita SERVIÇO prestado (item com `servico_id`): entra
--        no Anexo III pela mesma conta do PDV (659), e a separação o pula;
--      • cancelar o pedido cancela a venda; o estoque continua sendo do
--        cancelar_pedido_venda (o gatilho da venda não estorna de novo).
--    Nenhuma turma tem pedido de venda hoje — sem histórico a converter.
--
-- 3. De passagem: o índice único das movimentações de pedido de venda (400)
--    impedia cancelar pedido já separado. Passa a incluir o tipo.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ════ Estrutura ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vendas_pagamentos (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id  uuid NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  filial    text NOT NULL,
  forma     text NOT NULL,
  tipo      text,
  valor     numeric(15,2) NOT NULL CHECK (valor > 0),
  parcelas  integer NOT NULL DEFAULT 1 CHECK (parcelas >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendas_pagamentos_venda ON public.vendas_pagamentos (venda_id);

COMMENT ON TABLE public.vendas_pagamentos IS
  'Partes do pagamento de cada venda (migr. 660). `tipo` é a lista de formas_pagamento.tipo (657). Escrita por criar_venda_pdv e converter_orcamento_em_pedido.';

ALTER TABLE public.vendas_pagamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vendas_pagamentos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.vendas_pagamentos FROM authenticated;
GRANT SELECT ON TABLE public.vendas_pagamentos TO authenticated;

DROP POLICY IF EXISTS vendas_pagamentos_select ON public.vendas_pagamentos;
CREATE POLICY vendas_pagamentos_select ON public.vendas_pagamentos
  FOR SELECT TO authenticated
  USING (COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS pedido_venda_id uuid REFERENCES public.pedidos_venda(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_pedido_venda ON public.vendas (pedido_venda_id) WHERE pedido_venda_id IS NOT NULL;
COMMENT ON COLUMN public.vendas.pedido_venda_id IS
  'Venda nascida da conversão de um orçamento (migr. 660). O estoque dela sai na separação do pedido, não na venda.';

-- Defeito da migr. 400 achado aqui: o índice único da movimentação por pedido
-- de venda não tinha o TIPO, então a entrada do estorno (cancelar pedido já
-- separado) batia com a saída da separação e o cancelamento morria. Uma saída
-- e uma entrada por pedido e produto, cada uma no máximo uma vez.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE indexname = 'uq_mov_estoque_por_pedido_venda'
                    AND indexdef LIKE '%tipo%') THEN
    DROP INDEX IF EXISTS public.uq_mov_estoque_por_pedido_venda;
    CREATE UNIQUE INDEX uq_mov_estoque_por_pedido_venda
      ON public.movimentacoes_estoque (pedido_venda_id, produto_id, tipo)
      WHERE pedido_venda_id IS NOT NULL;
  END IF;
END $$;

-- Nota do pedido de venda tem origem própria.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'notas_emitidas_origem_check'
                    AND pg_get_constraintdef(oid) LIKE '%pedido_venda%') THEN
    ALTER TABLE public.notas_emitidas DROP CONSTRAINT IF EXISTS notas_emitidas_origem_check;
    ALTER TABLE public.notas_emitidas ADD CONSTRAINT notas_emitidas_origem_check
      CHECK (origem = ANY (ARRAY['pdv'::text, 'servico_manual'::text, 'avulso'::text, 'pedido_venda'::text]));
  END IF;
END $$;

-- A forma do PDV no vocabulário do cadastro (657).
CREATE OR REPLACE FUNCTION public._tipo_da_forma_pdv(p_forma text, p_parcelas integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE p_forma
    WHEN 'Dinheiro'         THEN 'Dinheiro'
    WHEN 'PIX'              THEN 'PIX'
    WHEN 'Cartão Débito'    THEN 'Cartão de débito'
    WHEN 'Cartão Crédito'   THEN CASE WHEN COALESCE(p_parcelas, 1) > 1
                                      THEN 'Cartão de crédito parcelado' ELSE 'Cartão de crédito à vista' END
    WHEN 'Fiado'            THEN 'Crediário da loja'
    WHEN 'Vale-Alimentação' THEN 'Vale / voucher'
  END;
$function$;

REVOKE ALL ON FUNCTION public._tipo_da_forma_pdv(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._tipo_da_forma_pdv(text, integer) TO authenticated;

-- ════ criar_venda_pdv com as partes do pagamento ═════════════════════════════
-- Parâmetro novo no fim, com DEFAULT: a tela antiga continua chamando sem ele.
-- Trocar a lista de parâmetros exige DROP da assinatura vigente.
DROP FUNCTION IF EXISTS public.criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text, text, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.criar_venda_pdv(p_cliente_id uuid, p_total numeric, p_desconto numeric, p_total_final numeric, p_forma_pagamento text, p_parcelas integer, p_itens jsonb, p_filial text DEFAULT NULL::text, p_cupom_codigo text DEFAULT NULL::text, p_cupom_desconto numeric DEFAULT 0, p_valor_dinheiro numeric DEFAULT NULL::numeric, p_cpf_nota text DEFAULT NULL::text, p_pagamentos jsonb DEFAULT NULL::jsonb)
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
  v_servico_id    uuid;            -- MIGR 659
  v_soma_servico  numeric(15,2);   -- MIGR 659
  v_valor_servico numeric(15,2);   -- MIGR 659
  v_pag           jsonb;           -- MIGR 660
  v_soma_pag      numeric(15,2);   -- MIGR 660
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
    -- MIGR 659: o item pode ser serviço prestado do catálogo (mão de obra da
    -- OS, ajuste de bainha). Um ou outro, nunca os dois.
    v_servico_id := NULLIF(v_item->>'servico_id', '')::uuid;
    IF v_produto_id IS NOT NULL AND v_servico_id IS NOT NULL THEN
      RAISE EXCEPTION 'Item "%" aponta para produto e serviço ao mesmo tempo.',
        COALESCE(v_item->>'nome_produto', '(sem nome)') USING ERRCODE = 'P0001';
    END IF;
    IF v_produto_id IS NULL AND v_servico_id IS NULL THEN
      RAISE EXCEPTION 'Item "%" não aponta para um produto do catálogo.',
        COALESCE(v_item->>'nome_produto', '(sem nome)') USING ERRCODE = 'P0001';
    END IF;

    IF v_servico_id IS NOT NULL THEN
      -- MIGR 659: serviço PRESTADO, ativo e da unidade. Preço é o do cadastro
      -- (promoção não alcança serviço).
      SELECT s.valor, s.nome INTO v_preco_cat, v_nome_produto
        FROM public.servicos s
       WHERE s.id = v_servico_id
         AND s.filial = v_filial
         AND COALESCE(s.natureza, 'prestado') = 'prestado'
         AND COALESCE(s.ativo, true)
         AND s.excluido_em IS NULL
         AND COALESCE(s.status, 'Ativo') = 'Ativo';
      IF v_nome_produto IS NULL THEN
        RAISE EXCEPTION 'O serviço "%" não está no catálogo ativo de serviços prestados de %.',
          COALESCE(v_item->>'nome_produto', '(sem nome)'), v_filial USING ERRCODE = 'P0001';
      END IF;
    ELSE
      SELECT public.preco_efetivo(id, v_today), nome INTO v_preco_cat, v_nome_produto
        FROM public.produtos WHERE id = v_produto_id;
      IF v_nome_produto IS NULL THEN
        RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
      END IF;
    END IF;

    v_preco_env := (v_item->>'preco_unitario')::numeric;
    IF ABS(COALESCE(v_preco_cat, 0) - v_preco_env) > 0.01 THEN
      RAISE EXCEPTION
        'Preço de "%" não confere: o preço de venda de hoje é R$ %, e a venda foi enviada com R$ %. Se o preço mudou, recarregue a tela; se é abatimento, use o campo Desconto — é ele que o DRE lê para separar receita de desconto concedido.',
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
     WHERE NULLIF(item->>'produto_id', '') IS NOT NULL   -- MIGR 659: serviço não tem estoque
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

  -- MIGR 660: as partes do pagamento, estruturadas. O misto deixa de existir
  -- só como texto ("Misto: PIX R$ 10,00 + …"): cada linha vira um registro,
  -- e é por ele que a taxa média da precificação enxerga o que o cliente usou.
  IF p_pagamentos IS NOT NULL AND jsonb_array_length(p_pagamentos) > 0 THEN
    SELECT COALESCE(SUM((x->>'valor')::numeric), 0) INTO v_soma_pag FROM jsonb_array_elements(p_pagamentos) x;
    IF ABS(v_soma_pag - p_total_final) > 0.01 THEN
      RAISE EXCEPTION 'As partes do pagamento somam R$ % e a venda é de R$ %.',
        to_char(v_soma_pag, 'FM999G999G990D00'), to_char(p_total_final, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      IF COALESCE((v_pag->>'valor')::numeric, 0) <= 0 THEN CONTINUE; END IF;
      IF public._tipo_da_forma_pdv(v_pag->>'forma', 1) IS NULL THEN
        RAISE EXCEPTION 'Forma de pagamento desconhecida na venda: "%".', v_pag->>'forma' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.vendas_pagamentos (venda_id, filial, forma, tipo, valor, parcelas)
      VALUES (v_venda_id, v_filial, v_pag->>'forma',
              public._tipo_da_forma_pdv(v_pag->>'forma', GREATEST(COALESCE((v_pag->>'parcelas')::int, 1), 1)),
              (v_pag->>'valor')::numeric, GREATEST(COALESCE((v_pag->>'parcelas')::int, 1), 1));
    END LOOP;
  ELSIF COALESCE(p_forma_pagamento, '') NOT LIKE 'Misto%' THEN
    INSERT INTO public.vendas_pagamentos (venda_id, filial, forma, tipo, valor, parcelas)
    VALUES (v_venda_id, v_filial, p_forma_pagamento,
            public._tipo_da_forma_pdv(p_forma_pagamento, v_parcelas), p_total_final, v_parcelas);
  END IF;

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
    -- MIGR 659: + servico_id; serviço não movimenta estoque.
    INSERT INTO itens_venda (venda_id, produto_id, servico_id, nome_produto, qtd, preco_unitario, subtotal)
    VALUES (v_venda_id, NULLIF(v_item->>'produto_id', '')::uuid, NULLIF(v_item->>'servico_id', '')::uuid,
            v_item->>'nome_produto',
            (v_item->>'qtd')::numeric, (v_item->>'preco_unitario')::numeric, (v_item->>'subtotal')::numeric);

    IF NULLIF(v_item->>'produto_id', '') IS NOT NULL THEN
      INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data, filial)
      VALUES ((v_item->>'produto_id')::uuid, 'Saída', (v_item->>'qtd')::numeric,
              'PDV', 'Venda #' || v_short_id, v_today, v_filial);
    END IF;
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

  -- MIGR 659: mercadoria sai em NF de produto; serviço em NFS-e, com numeração
  -- própria. O desconto da venda se reparte pelo peso de cada parte.
  SELECT COALESCE(SUM((item->>'subtotal')::numeric)
                    FILTER (WHERE NULLIF(item->>'servico_id', '') IS NOT NULL), 0)
    INTO v_soma_servico
    FROM jsonb_array_elements(p_itens) item;
  v_valor_servico := CASE WHEN p_total > 0 THEN ROUND(p_total_final * v_soma_servico / p_total, 2) ELSE 0 END;

  IF v_soma_servico < p_total THEN
    PERFORM public.emitir_nota(
      p_filial          => v_filial,
      p_tipo            => 'NF Produto',
      p_origem          => 'pdv',
      p_cliente_id      => p_cliente_id,
      p_cliente_nome    => v_cliente_nome,
      p_valor_total     => p_total_final - v_valor_servico,
      p_descricao       => v_desc_base,
      p_venda_id        => v_venda_id,
      p_conta_receber_id => v_conta_receber_id,
      p_data_emissao    => v_today,
      p_serie           => '001'
    );
  END IF;

  IF v_soma_servico > 0 THEN
    PERFORM public.emitir_nota(
      p_filial          => v_filial,
      p_tipo            => 'NFS-e Serviço',
      p_origem          => 'pdv',
      p_cliente_id      => p_cliente_id,
      p_cliente_nome    => v_cliente_nome,
      p_valor_total     => v_valor_servico,
      p_descricao       => v_desc_base,
      p_venda_id        => v_venda_id,
      p_conta_receber_id => v_conta_receber_id,
      p_data_emissao    => v_today,
      p_serie           => 'NFSE'
    );
  END IF;

  RETURN v_venda_id;
END;
$function$;


REVOKE ALL ON FUNCTION public.criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text, text, numeric, numeric, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text, text, numeric, numeric, text, jsonb) TO authenticated;

-- ════ Taxa pelo mix, com as partes do pagamento ══════════════════════════════
CREATE OR REPLACE FUNCTION public._taxa_pelo_mix(p_filial text, p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT v.id, v.forma_pagamento,
           v.total - COALESCE(v.desconto, 0) - COALESCE(v.cupom_desconto, 0) AS receita,
           EXISTS (SELECT 1 FROM public.vendas_pagamentos vp WHERE vp.venda_id = v.id) AS tem_partes
      FROM public.vendas v
     WHERE v.ativo = true
       AND v.filial = p_filial
       AND v.status <> 'Cancelada'
       AND v.created_at::date BETWEEN p_inicio AND p_fim
  ), linhas AS (
    -- MIGR 660: venda com as partes gravadas — cada parte pelo seu tipo, na
    -- proporção do que ela pagou (misto incluído).
    SELECT vp.tipo, v.receita * vp.valor / NULLIF(SUM(vp.valor) OVER (PARTITION BY v.id), 0) AS receita
      FROM v JOIN public.vendas_pagamentos vp ON vp.venda_id = v.id
     WHERE v.tem_partes
    UNION ALL
    -- Venda anterior à 660: pela forma do PDV. Misto antigo fica sem tipo.
    SELECT CASE v.forma_pagamento
             WHEN 'Cartão Crédito' THEN
               CASE WHEN (SELECT count(*) FROM public.contas_receber cr
                           WHERE cr.venda_id = v.id AND COALESCE(cr.ativo, true)) > 1
                    THEN 'Cartão de crédito parcelado' ELSE 'Cartão de crédito à vista' END
             ELSE public._tipo_da_forma_pdv(v.forma_pagamento, 1)
           END,
           v.receita
      FROM v WHERE NOT v.tem_partes
  ), cad AS (
    SELECT f.tipo, ROUND(AVG(f.taxa), 3) AS taxa
      FROM public.formas_pagamento f
     WHERE f.filial = p_filial
       AND COALESCE(f.ativo, true)
       AND COALESCE(f.status, 'Ativo') <> 'Inativo'
       AND f.tipo IS NOT NULL
     GROUP BY f.tipo
  ), t AS (
    SELECT l.tipo, SUM(l.receita) AS receita
      FROM linhas l WHERE l.tipo IS NOT NULL
     GROUP BY l.tipo
  ), tt AS (
    SELECT t.tipo, t.receita,
           COALESCE(
             c.taxa,
             CASE WHEN t.tipo = 'Cartão de crédito parcelado'
                  THEN (SELECT c2.taxa FROM cad c2 WHERE c2.tipo = 'Cartão de crédito à vista') END,
             CASE WHEN t.tipo IN ('Dinheiro', 'Crediário da loja') THEN 0 END
           ) AS taxa
      FROM t LEFT JOIN cad c ON c.tipo = t.tipo
  ), tot AS (
    SELECT COALESCE(SUM(receita), 0) AS base FROM tt
  )
  SELECT jsonb_build_object(
    'base',       (SELECT base FROM tot),
    'fora',       COALESCE((SELECT SUM(receita) FROM linhas WHERE tipo IS NULL), 0),
    'taxa_pct',   CASE WHEN (SELECT base FROM tot) > 0
                       THEN ROUND(COALESCE((SELECT SUM(receita * COALESCE(taxa, 0)) FROM tt), 0) / (SELECT base FROM tot), 2) END,
    'itens',      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'tipo', tt.tipo,
                    'participacao_pct', ROUND(100 * tt.receita / NULLIF((SELECT base FROM tot), 0), 1),
                    'taxa_pct', tt.taxa) ORDER BY tt.receita DESC) FROM tt), '[]'::jsonb),
    'sem_cadastro', COALESCE((SELECT jsonb_agg(tt.tipo ORDER BY tt.receita DESC) FROM tt WHERE tt.taxa IS NULL), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public._taxa_pelo_mix(text, date, date) FROM public, anon, authenticated;

-- ════ Pedido de venda (funções vivas, linhas novas marcadas MIGR 660) ════════

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
  v_venda_id      uuid;            -- MIGR 660
  v_subtotal      numeric(12,2);   -- MIGR 660
  v_soma_servico  numeric(12,2);   -- MIGR 660
  v_valor_servico numeric(12,2);   -- MIGR 660
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_orc.pedido_venda_id IS NOT NULL THEN
    SELECT pv.id INTO v_vivo
      FROM public.pedidos_venda pv
     WHERE pv.id = v_orc.pedido_venda_id
       AND COALESCE(pv.ativo, true)
       AND pv.status <> 'Cancelado';

    IF v_vivo IS NOT NULL THEN
      RETURN v_vivo;
    END IF;

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

  v_total    := round(COALESCE(v_orc.valor_total, 0), 2);
  v_parcelas := GREATEST(1, COALESCE(v_orc.parcelas, 1));

  IF v_orc.forma_pagamento_id IS NOT NULL THEN
    SELECT * INTO f FROM public.formas_pagamento
     WHERE id = v_orc.forma_pagamento_id AND COALESCE(ativo, true);

    IF FOUND THEN
      v_prazo     := GREATEST(0, COALESCE(f.prazo, 0));
      v_intervalo := GREATEST(1, COALESCE(f.intervalo_dias, 30));

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

  -- MIGR 660: o pedido de venda É uma venda. Sem esta linha a receita dele
  -- não chegava ao DRE nem ao Simples (os dois leem `vendas`), e o custo da
  -- mercadoria também não. A venda nasce aqui, junto com a cobrança — é o
  -- faturamento; o estoque continua saindo na separação.
  --   total = soma dos itens; desconto = o que a condição abateu; se a
  --   condição acrescentou juros ao cliente, o total sobe junto (receita).
  v_subtotal := COALESCE(
    (SELECT SUM((x->>'subtotal')::numeric) FROM jsonb_array_elements(COALESCE(v_orc.itens, '[]'::jsonb)) x),
    v_total);
  INSERT INTO public.vendas (
    cliente_id, total, desconto, total_final, forma_pagamento, status, filial,
    valor_dinheiro, pedido_venda_id
  ) VALUES (
    v_orc.cliente_id, GREATEST(v_subtotal, v_total), GREATEST(v_subtotal - v_total, 0), v_total,
    'Pedido de venda — ' || COALESCE(NULLIF(btrim(v_orc.forma_pagamento), ''), 'a combinar'),
    'Concluída', v_orc.filial, 0, v_pedido_id
  ) RETURNING id INTO v_venda_id;

  INSERT INTO public.itens_venda (venda_id, produto_id, servico_id, nome_produto, qtd, preco_unitario, subtotal)
  SELECT v_venda_id,
         NULLIF(x->>'produto_id', '')::uuid,
         NULLIF(x->>'servico_id', '')::uuid,
         COALESCE(NULLIF(x->>'nome', ''), '(sem nome)'),
         COALESCE((x->>'qtd')::numeric, 0),
         COALESCE((x->>'preco_unitario')::numeric, 0),
         COALESCE((x->>'subtotal')::numeric, 0)
    FROM jsonb_array_elements(COALESCE(v_orc.itens, '[]'::jsonb)) x;

  -- A forma veio do cadastro: o `tipo` dela é o elo com a taxa (migr. 657).
  INSERT INTO public.vendas_pagamentos (venda_id, filial, forma, tipo, valor, parcelas)
  VALUES (v_venda_id, v_orc.filial, COALESCE(v_orc.forma_pagamento, 'a combinar'),
          CASE WHEN f.id IS NOT NULL THEN f.tipo END, v_total, v_parcelas);

  SELECT nome INTO v_cliente_nome FROM public.clientes WHERE id = v_orc.cliente_id;
  v_desc := 'Pedido Venda #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
            || COALESCE(' - ' || v_cliente_nome, '');

  v_parcela := round(v_total / v_parcelas, 2);

  FOR i IN 1..v_parcelas LOOP
    IF i < v_parcelas THEN
      v_valor := v_parcela;
      v_acum  := v_acum + v_valor;
    ELSE
      v_valor := v_total - v_acum;
    END IF;

    v_vencimento := public.acre_today() + v_prazo + (i - 1) * v_intervalo;

    INSERT INTO public.contas_receber (
      cliente_id, descricao, valor, vencimento, status, filial,
      pedido_venda_id, forma_pagamento_id
    )
    VALUES (
      v_orc.cliente_id,
      v_desc || CASE WHEN v_parcelas > 1 THEN format(' (%s/%s)', i, v_parcelas) ELSE '' END,
      v_valor, v_vencimento, 'Aberto', v_orc.filial,
      v_pedido_id, v_orc.forma_pagamento_id
    )
    RETURNING id INTO v_conta_id;

    IF i = 1 THEN
      v_primeira := v_conta_id;
    END IF;
  END LOOP;

  UPDATE public.pedidos_venda
     SET conta_receber_id = v_primeira
   WHERE id = v_pedido_id;

  -- MIGR 660: a nota do faturamento — produto em NF-e, serviço em NFS-e.
  SELECT COALESCE(SUM((x->>'subtotal')::numeric) FILTER (WHERE NULLIF(x->>'servico_id', '') IS NOT NULL), 0)
    INTO v_soma_servico FROM jsonb_array_elements(COALESCE(v_orc.itens, '[]'::jsonb)) x;
  v_valor_servico := CASE WHEN v_subtotal > 0 THEN ROUND(v_total * v_soma_servico / v_subtotal, 2) ELSE 0 END;
  IF v_soma_servico < v_subtotal THEN
    PERFORM public.emitir_nota(
      p_filial => v_orc.filial, p_tipo => 'NF Produto', p_origem => 'pedido_venda',
      p_cliente_id => v_orc.cliente_id, p_cliente_nome => v_cliente_nome,
      p_valor_total => v_total - v_valor_servico, p_descricao => v_desc,
      p_venda_id => v_venda_id, p_conta_receber_id => v_primeira,
      p_data_emissao => public.acre_today(), p_serie => '001');
  END IF;
  IF v_soma_servico > 0 THEN
    PERFORM public.emitir_nota(
      p_filial => v_orc.filial, p_tipo => 'NFS-e Serviço', p_origem => 'pedido_venda',
      p_cliente_id => v_orc.cliente_id, p_cliente_nome => v_cliente_nome,
      p_valor_total => v_valor_servico, p_descricao => v_desc,
      p_venda_id => v_venda_id, p_conta_receber_id => v_primeira,
      p_data_emissao => public.acre_today(), p_serie => 'NFSE');
  END IF;

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


CREATE OR REPLACE FUNCTION public.separar_pedido_venda(p_pedido_id uuid)
 RETURNS pedidos_venda
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT COALESCE(public.auth_pode_filial(v_ped.filial), false) THEN
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
    -- MIGR 660: serviço não sai do estoque — não há o que separar.
    CONTINUE WHEN NULLIF(v_item->>'servico_id', '') IS NOT NULL;
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
$function$;


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

  UPDATE public.pedidos_venda SET status = 'Cancelado' WHERE id = v_ped.id;

  -- MIGR 660: a venda nascida da conversão sai do resultado junto. O estoque
  -- e as contas quem cuida é esta função (acima); o gatilho da venda sabe
  -- disso pelo `pedido_venda_id` e não estorna estoque de novo.
  UPDATE public.vendas SET status = 'Cancelada'
   WHERE pedido_venda_id = v_ped.id AND status <> 'Cancelada';

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


CREATE OR REPLACE FUNCTION public.fn_venda_cancelada_desfaz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_short   text := upper(right(NEW.id::text, 6));
  v_hoje    date := public.acre_today();
  v_origem  text;
  v_item    record;
  v_marca   text;
BEGIN
  v_origem := 'Estorno — Venda #' || v_short || ' cancelada';
  v_marca  := ' [venda #' || v_short || ' cancelada — devolver ao cliente]';

  -- 1.1 Estoque de volta. Uma Entrada por item, com guard de idempotência pela
  -- origem: se a tela antiga já estornou este item, não estorna de novo.
  FOR v_item IN
    SELECT iv.produto_id, SUM(iv.qtd) AS qtd
      FROM public.itens_venda iv
     WHERE iv.venda_id = NEW.id
       AND iv.produto_id IS NOT NULL
       -- MIGR 660: venda de pedido de venda — quem estorna é cancelar_pedido_venda
       -- (e só se o pedido já tinha sido separado).
       AND NEW.pedido_venda_id IS NULL
     GROUP BY iv.produto_id
    HAVING SUM(iv.qtd) > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.movimentacoes_estoque me
       WHERE me.produto_id = v_item.produto_id
         AND me.origem = v_origem
         AND COALESCE(me.ativo, true)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.movimentacoes_estoque
      (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES
      (v_item.produto_id, 'Entrada', v_item.qtd, v_origem, 'Almoxarifado',
       v_hoje, COALESCE(NEW.filial, 'SuperMax'));
  END LOOP;

  -- 1.2 Aparelho de volta para 'Em estoque'. Mesma decisão da 446: o vínculo
  -- com a venda antiga PERMANECE (o recibo já emitido lê `venda_id` para
  -- imprimir o IMEI); só o estado muda, e a próxima venda sobrescreve.
  UPDATE public.produto_unidades pu
     SET status     = 'Em estoque',
         vendida_em = NULL,
         observacao = trim(both ' ' from COALESCE(pu.observacao || ' | ', '')
           || 'Venda ' || v_short || ' cancelada em '
           || to_char(v_hoje, 'DD/MM/YYYY'))
   WHERE pu.ativo
     AND pu.venda_id = NEW.id
     AND pu.status = 'Vendida';

  -- 1.3 Cobrança. O elo é `contas_receber.venda_id` — a coluna existe e
  -- `criar_venda_pdv` a grava em toda venda. (Até a migr. 553 este comentário
  -- dizia que a coluna NÃO existia e que o elo era a descrição: era verdade
  -- quando a 448 foi escrita, e deixou de ser quando a coluna nasceu. O código
  -- migrou; o comentário não. Quem escrever o próximo desfazimento usa
  -- `venda_id`, não texto.)
  UPDATE public.contas_receber cr
     SET status     = 'Cancelado',
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.venda_id = NEW.id
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) = 0;

  -- Dinheiro que entrou fica, e fica VISÍVEL. `position` em vez de LIKE para
  -- não marcar duas vezes se o gatilho rodar de novo.
  UPDATE public.contas_receber cr
     SET descricao  = cr.descricao || v_marca,
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.venda_id = NEW.id
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) > 0
     AND position(v_marca in cr.descricao) = 0;

  -- 1.4 Cupom de volta para a campanha (MIGR 557). A venda consumiu um uso no
  -- `criar_venda_pdv`; cancelada, ela não consumiu nada. Sem isto, três alunos
  -- testando e cancelando esgotam uma campanha de 3 usos sem nenhuma venda ter
  -- existido — e o próximo recebe 'Cupom atingiu o limite de usos.' sem ter
  -- como descobrir o porquê.
  IF NEW.cupom_id IS NOT NULL THEN
    UPDATE public.marketing_cupons
       SET usos = usos - 1
     WHERE id = NEW.cupom_id
       AND COALESCE(usos, 0) > 0;
  END IF;

  RETURN NEW;
END;
$function$;


NOTIFY pgrst, 'reload schema';
