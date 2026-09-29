-- 659_20260928_pdv_vende_servico_e_anexo_iii.sql
--
-- O Simples separa o que a empresa VENDE (mercadoria, Anexo I) do que ela
-- PRESTA (serviço, Anexo III). As duas receitas usam a mesma faixa — a da
-- receita TOTAL dos 12 meses — mas cada uma na sua tabela. Na TechMax, a OS de
-- troca de tela tem as duas coisas: a tela (peça) e a mão de obra.
--
-- Até aqui o sistema não vendia serviço: o PDV e o orçamento só levavam
-- `produtos`, e o catálogo `servicos` (prestado, migr. 516) não aparecia em
-- venda nenhuma. Sem receita de serviço não havia o que separar.
--
-- ── A VENDA ─────────────────────────────────────────────────────────────────
--   • `itens_venda.servico_id`: o item é produto OU serviço, nunca os dois.
--   • `criar_venda_pdv` aceita serviço PRESTADO, ativo, da unidade, pelo preço
--     do cadastro. Serviço não tem estoque: não trava saldo nem gera saída.
--   • A nota se divide: mercadoria em NF de produto, serviço em NFS-e (série
--     própria, NFSE), com o desconto repartido pelo peso de cada parte.
--   • `fn_valida_filial_item_venda` recusa serviço de outra unidade e serviço
--     CONTRATADO (esse a loja compra, não vende).
--   • DRE: linha de serviço não é "item vendido sem custo" (mão de obra não tem
--     CMV — o custo dela é a folha). Painel de BI: fora do "mais vendidos".
--
-- ── O IMPOSTO ───────────────────────────────────────────────────────────────
--   • `simples_anexo_iii(rbt12)` — tabela do Anexo III (LC 123, redação da LC
--     155/2016). Reparo e manutenção é Anexo III direto, sem fator R.
--   • `_receita_servico` — parte da receita de cada venda que é serviço (o
--     desconto da venda se reparte proporcionalmente).
--   • `_simples_periodo` — receita total, a de serviço, a faixa e o imposto:
--     (receita − serviço) × efetiva do I + serviço × efetiva do III. É a conta
--     única que o DRE, o DAS e a Precificação passam a usar.
--
-- Fora de escopo: devolução de serviço abate a receita de mercadoria (a linha
-- devolvida não guarda se era serviço); orçamento/pedido de venda continua só
-- com produto; PDV do SuperMax continua sem serviço.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ════ Estrutura ══════════════════════════════════════════════════════════════

ALTER TABLE public.itens_venda
  ADD COLUMN IF NOT EXISTS servico_id uuid REFERENCES public.servicos(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'itens_venda_produto_ou_servico') THEN
    ALTER TABLE public.itens_venda
      ADD CONSTRAINT itens_venda_produto_ou_servico
      CHECK (NOT (produto_id IS NOT NULL AND servico_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_itens_venda_servico ON public.itens_venda (servico_id) WHERE servico_id IS NOT NULL;

COMMENT ON COLUMN public.itens_venda.servico_id IS
  'Serviço prestado vendido (migr. 659). Item é produto OU serviço. Serviço não tem estoque e é tributado pelo Anexo III.';

ALTER TABLE public.das_apuracoes ADD COLUMN IF NOT EXISTS receita_servico numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE public.das_apuracoes ADD COLUMN IF NOT EXISTS aliquota_efetiva_iii numeric(8,4);

-- ════ Simples — Anexo III ════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.simples_anexo_iii(p_rbt12 numeric)
RETURNS TABLE (faixa integer, aliquota_nominal numeric, parcela_deduzir numeric, aliquota_efetiva numeric)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  -- Tabela do Anexo III (LC 123, redação da LC 155/2016). Mesmos limites de
  -- faixa do Anexo I; alíquotas e deduções próprias.
  WITH t(faixa, ate, nominal, deduzir) AS (VALUES
    (1,  180000.00,  6.00,      0.00),
    (2,  360000.00, 11.20,   9360.00),
    (3,  720000.00, 13.50,  17640.00),
    (4, 1800000.00, 16.00,  35640.00),
    (5, 3600000.00, 21.00, 125640.00),
    (6,        NULL, 33.00, 648000.00)
  ), f AS (
    SELECT * FROM t
     WHERE t.ate IS NULL OR GREATEST(COALESCE(p_rbt12, 0), 0) <= t.ate
     ORDER BY t.faixa
     LIMIT 1
  )
  SELECT f.faixa, f.nominal, f.deduzir,
         CASE WHEN COALESCE(p_rbt12, 0) <= 0 THEN f.nominal
              ELSE ROUND((p_rbt12 * f.nominal / 100 - f.deduzir) / p_rbt12 * 100, 4)
         END
    FROM f;
$function$;

REVOKE ALL ON FUNCTION public.simples_anexo_iii(numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.simples_anexo_iii(numeric) TO authenticated;

-- Parte da receita (líquida de desconto e cupom) que é serviço.
CREATE OR REPLACE FUNCTION public._receita_servico(p_filial text, p_inicio date, p_fim date)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ROUND(COALESCE(SUM(
           (v.total - COALESCE(v.desconto, 0) - COALESCE(v.cupom_desconto, 0)) * s.serv / NULLIF(v.total, 0)
         ), 0), 2)
    FROM public.vendas v
    JOIN LATERAL (SELECT SUM(iv.subtotal) AS serv
                    FROM public.itens_venda iv
                   WHERE iv.venda_id = v.id AND iv.servico_id IS NOT NULL) s ON s.serv > 0
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;
$function$;

REVOKE ALL ON FUNCTION public._receita_servico(text, date, date) FROM public, anon, authenticated;

-- A conta única do Simples para um trecho de um mês (o DRE corta o mês no
-- período; o DAS usa o mês inteiro). A faixa é a do mês de apuração.
CREATE OR REPLACE FUNCTION public._simples_periodo(p_filial text, p_mes date, p_inicio date, p_fim date)
RETURNS TABLE (receita numeric, receita_servico numeric, rbt12 numeric, rbt12_origem text, faixa integer,
               aliquota_efetiva numeric, aliquota_efetiva_iii numeric, imposto numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT b.base, sv.serv, r.rbt12, r.origem, a1.faixa, a1.aliquota_efetiva, a3.aliquota_efetiva,
         ROUND(GREATEST(b.base - sv.serv, 0) * a1.aliquota_efetiva / 100, 2)
       + ROUND(sv.serv * a3.aliquota_efetiva / 100, 2)
    FROM (SELECT public._receita_simples(p_filial, p_inicio, p_fim) AS base) b
    CROSS JOIN LATERAL (SELECT LEAST(public._receita_servico(p_filial, p_inicio, p_fim), GREATEST(b.base, 0)) AS serv) sv
    CROSS JOIN LATERAL public._simples_rbt12(p_filial, date_trunc('month', p_mes)::date) r
    CROSS JOIN LATERAL public.simples_anexo_i(r.rbt12) a1
    CROSS JOIN LATERAL public.simples_anexo_iii(r.rbt12) a3;
$function$;

REVOKE ALL ON FUNCTION public._simples_periodo(text, date, date, date) FROM public, anon, authenticated;

-- O mês inteiro (DAS). Troca a assinatura de retorno da 658: DROP e recria.
DROP FUNCTION IF EXISTS public._simples_do_mes(text, date);
CREATE FUNCTION public._simples_do_mes(p_filial text, p_mes date)
RETURNS TABLE (receita numeric, receita_servico numeric, rbt12 numeric, rbt12_origem text, faixa integer,
               aliquota_efetiva numeric, aliquota_efetiva_iii numeric, imposto numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public._simples_periodo(p_filial, p_mes,
           date_trunc('month', p_mes)::date,
           (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date);
$function$;

REVOKE ALL ON FUNCTION public._simples_do_mes(text, date) FROM public, anon, authenticated;

-- ════ Funções vivas, copiadas do banco (linhas novas marcadas MIGR 659) ══════

CREATE OR REPLACE FUNCTION public.criar_venda_pdv(p_cliente_id uuid, p_total numeric, p_desconto numeric, p_total_final numeric, p_forma_pagamento text, p_parcelas integer, p_itens jsonb, p_filial text DEFAULT NULL::text, p_cupom_codigo text DEFAULT NULL::text, p_cupom_desconto numeric DEFAULT 0, p_valor_dinheiro numeric DEFAULT NULL::numeric, p_cpf_nota text DEFAULT NULL::text)
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


CREATE OR REPLACE FUNCTION public.fn_valida_filial_item_venda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_filial_venda   text;
  v_filial_produto text;
  v_nome_produto   text;
  v_natureza       text;   -- MIGR 659
BEGIN
  SELECT filial INTO v_filial_venda
    FROM public.vendas WHERE id = NEW.venda_id;

  SELECT filial, nome INTO v_filial_produto, v_nome_produto
    FROM public.produtos WHERE id = NEW.produto_id;

  IF v_filial_venda IS NOT NULL
     AND v_filial_produto IS NOT NULL
     AND v_filial_produto <> v_filial_venda THEN
    RAISE EXCEPTION
      'O produto "%" é da filial % e a venda é da filial % — uma filial não vende o estoque da outra.',
      COALESCE(v_nome_produto, NEW.nome_produto), v_filial_produto, v_filial_venda
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 659: serviço também é da unidade, e só o PRESTADO se vende.
  IF NEW.servico_id IS NOT NULL THEN
    SELECT s.filial, s.nome, s.natureza INTO v_filial_produto, v_nome_produto, v_natureza
      FROM public.servicos s WHERE s.id = NEW.servico_id;
    IF v_natureza = 'contratado' THEN
      RAISE EXCEPTION '"%" é serviço que a loja CONTRATA, não que ela presta — não se vende.',
        COALESCE(v_nome_produto, NEW.nome_produto) USING ERRCODE = 'P0001';
    END IF;
    IF v_filial_venda IS NOT NULL AND v_filial_produto IS NOT NULL
       AND v_filial_produto <> v_filial_venda THEN
      RAISE EXCEPTION 'O serviço "%" é da filial % e a venda é da filial %.',
        COALESCE(v_nome_produto, NEW.nome_produto), v_filial_produto, v_filial_venda
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public._dre_calculo(p_filial text, p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receita_bruta   numeric(15,2);
  v_descontos       numeric(15,2);
  v_devolucoes      numeric(15,2);
  v_receita_liquida numeric(15,2);
  v_cmv             numeric(15,2);
  v_cmv_devolvido   numeric(15,2);
  v_lucro_bruto     numeric(15,2);
  v_despesas        numeric(15,2);
  v_resultado       numeric(15,2);
  v_grupos          jsonb;
  v_sem_custo       integer;
  v_itens           integer;
  v_consumo         numeric(15,2);
  v_consumo_sem     integer;
  v_cmv_ajuste      numeric(15,2);
  v_impostos        numeric(15,2);
  v_impostos_meses  jsonb;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(v.total), 0),
         COALESCE(SUM(COALESCE(v.desconto, 0) + COALESCE(v.cupom_desconto, 0)), 0)
    INTO v_receita_bruta, v_descontos
    FROM public.vendas v
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(d.valor_devolvido), 0)
    INTO v_devolucoes
    FROM public.devolucoes d
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  -- MIGR 656/659: Simples Nacional mês a mês — cada mês na alíquota da sua
  -- faixa; mercadoria pelo Anexo I e serviço pelo Anexo III, os dois na faixa
  -- da receita TOTAL dos 12 meses (a regra do Simples).
  SELECT COALESCE(SUM(x.imposto), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'mes', x.mes, 'base', x.receita, 'base_servico', x.receita_servico,
           'rbt12', x.rbt12, 'rbt12_origem', x.rbt12_origem, 'faixa', x.faixa,
           'aliquota_efetiva', x.aliquota_efetiva, 'aliquota_efetiva_iii', x.aliquota_efetiva_iii,
           'imposto', x.imposto) ORDER BY x.mes), '[]'::jsonb)
    INTO v_impostos, v_impostos_meses
    FROM (
      SELECT g.mes, s.*
        FROM (SELECT gs::date AS mes
                FROM generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') gs) g
        CROSS JOIN LATERAL public._simples_periodo(p_filial, g.mes,
                              GREATEST(p_inicio, g.mes),
                              LEAST(p_fim, (g.mes + interval '1 month' - interval '1 day')::date)) s
       WHERE s.receita <> 0
    ) x;

  v_receita_liquida := ROUND(v_receita_bruta - v_descontos - v_devolucoes - v_impostos, 2);

  SELECT COALESCE(SUM(iv.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0),
         -- MIGR 659: serviço não tem custo de mercadoria — não é "item sem custo".
         COUNT(*) FILTER (WHERE iv.custo_unitario IS NULL AND iv.servico_id IS NULL),
         COUNT(*) FILTER (WHERE iv.servico_id IS NULL)
    INTO v_cmv, v_sem_custo, v_itens
    FROM public.itens_venda iv
    JOIN public.vendas v ON v.id = iv.venda_id
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = iv.produto_id
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(idev.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0)
    INTO v_cmv_devolvido
    FROM public.itens_devolucao idev
    JOIN public.devolucoes d ON d.id = idev.devolucao_id
    LEFT JOIN LATERAL (
      SELECT iv2.custo_unitario
        FROM public.itens_venda iv2
       WHERE iv2.venda_id = d.venda_id
         AND iv2.produto_id IS NOT DISTINCT FROM idev.produto_id
       LIMIT 1
    ) iv ON true
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = idev.produto_id
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  v_cmv         := ROUND(GREATEST(v_cmv - v_cmv_devolvido, 0), 2);

  -- MIGR 645: diferença entre a nota e o pedido na parte da mercadoria que já
  -- tinha sido vendida quando a nota foi conferida. O que ainda estava em
  -- estoque foi para o custo médio e sai no CMV das vendas seguintes.
  SELECT COALESCE(SUM(a.valor_resultado), 0)
    INTO v_cmv_ajuste
    FROM public.ajustes_custo_compra a
   WHERE a.filial = p_filial
     AND a.destino = 'cmv'
     AND a.data BETWEEN p_inicio AND p_fim;
  v_cmv := ROUND(v_cmv + v_cmv_ajuste, 2);

  v_lucro_bruto := ROUND(v_receita_liquida - v_cmv, 2);

  -- Migr. 442/447/508: material de consumo que saiu para os setores no período.
  SELECT COALESCE(SUM(cm.valor), 0),
         COUNT(*) FILTER (WHERE cm.custo_unitario IS NULL)
    INTO v_consumo, v_consumo_sem
    FROM public.consumos_material cm
   WHERE cm.ativo = true
     AND cm.filial = p_filial
     AND cm.data BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(t.valor), 0),
         COALESCE(jsonb_agg(jsonb_build_object('grupo', t.grupo, 'valor', t.valor)
                            ORDER BY t.valor DESC), '[]'::jsonb)
    INTO v_despesas, v_grupos
    FROM (
      SELECT COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cp.valor), 2) AS valor
        FROM public.contas_pagar cp
        LEFT JOIN public.centros_custo cc ON cc.id = cp.centro_custo_id
       WHERE cp.ativo = true
         AND cp.filial = p_filial
         AND cp.status <> 'Cancelado'
         AND COALESCE(cp.natureza, 'despesa') NOT IN ('estoque', 'imobilizado')
         AND COALESCE(cp.origem, '') NOT IN ('devolucao_pdv', 'emprestimo', 'das')
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado')

      UNION ALL

      SELECT COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cm.valor), 2) AS valor
        FROM public.consumos_material cm
        LEFT JOIN public.centros_custo cc2 ON cc2.id = cm.centro_custo_id
       WHERE cm.ativo = true
         AND cm.filial = p_filial
         AND cm.data BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado')

      UNION ALL

      SELECT 'Despesas financeiras'::text AS grupo,
             ROUND(SUM(COALESCE(pe.juros, 0)), 2) AS valor
        FROM public.contas_pagar cp
        JOIN public.parcelas_emprestimo pe ON pe.contas_pagar_id = cp.id
       WHERE cp.ativo = true
         AND cp.filial = p_filial
         AND cp.status <> 'Cancelado'
         AND COALESCE(cp.origem, '') = 'emprestimo'
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
      HAVING ROUND(SUM(COALESCE(pe.juros, 0)), 2) > 0

      UNION ALL

      -- MIGR 645: mesma diferença, para material de consumo já consumido.
      SELECT 'Ajuste de custo de compras'::text AS grupo, ROUND(SUM(a.valor_resultado), 2) AS valor
        FROM public.ajustes_custo_compra a
       WHERE a.filial = p_filial
         AND a.destino = 'despesa'
         AND a.data BETWEEN p_inicio AND p_fim
      HAVING ROUND(SUM(a.valor_resultado), 2) <> 0

      UNION ALL

      SELECT 'Depreciação'::text AS grupo, ROUND(SUM(dep.valor_dia), 2) AS valor
        FROM (
          SELECT GREATEST(0,
                   LEAST(p_fim,
                         COALESCE(p.patrimonio_baixado_em, 'infinity'::date),
                         (p.created_at::date + (p.patrimonio_vida_util_meses || ' months')::interval - '1 day'::interval)::date)
                   - GREATEST(p_inicio, p.created_at::date) + 1
                 ) * (COALESCE(pc.preco_custo, 0))
                   / p.patrimonio_vida_util_meses / 30.0 AS valor_dia
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND COALESCE(p.ativo, true)
             AND p.filial = p_filial
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
             AND p.created_at::date <= p_fim
             AND (p.patrimonio_baixado_em IS NULL OR p.patrimonio_baixado_em >= p_inicio)
        ) dep
      HAVING ROUND(SUM(dep.valor_dia), 2) > 0

      UNION ALL

      SELECT 'Baixa de imobilizado'::text AS grupo, ROUND(SUM(bx.resultado), 2) AS valor
        FROM (
          SELECT (COALESCE(pc.preco_custo, 0))
                 * GREATEST(0, 1 - (p.patrimonio_baixado_em - p.created_at::date)::numeric
                                   / (p.patrimonio_vida_util_meses * 30.0))
                 - COALESCE(p.patrimonio_valor_venda, 0) AS resultado
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND COALESCE(p.ativo, true)
             AND p.filial = p_filial
             AND p.patrimonio_baixado_em BETWEEN p_inicio AND p_fim
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
        ) bx
      HAVING ROUND(SUM(bx.resultado), 2) <> 0
    ) t;

  v_resultado := ROUND(v_lucro_bruto - v_despesas, 2);

  RETURN jsonb_build_object(
    'filial',           p_filial,
    'inicio',           p_inicio,
    'fim',              p_fim,
    'receita_bruta',    v_receita_bruta,
    'descontos',        v_descontos,
    'devolucoes',       v_devolucoes,
    'impostos',         v_impostos,
    'impostos_meses',   v_impostos_meses,
    'receita_liquida',  v_receita_liquida,
    'cmv',              v_cmv,
    'cmv_devolvido',    v_cmv_devolvido,
    'cmv_ajuste_compras', v_cmv_ajuste,
    'lucro_bruto',      v_lucro_bruto,
    'margem_bruta_pct', CASE WHEN v_receita_liquida > 0
                             THEN ROUND(100 * v_lucro_bruto / v_receita_liquida, 1) END,
    'despesas',         v_despesas,
    'despesas_grupos',  v_grupos,
    'consumo_material', v_consumo,
    'consumos_sem_custo', v_consumo_sem,
    'resultado',        v_resultado,
    'margem_liquida_pct', CASE WHEN v_receita_liquida > 0
                               THEN ROUND(100 * v_resultado / v_receita_liquida, 1) END,
    'itens_vendidos',   v_itens,
    'itens_sem_custo',  v_sem_custo
  );
END;
$function$;


-- ════ DAS (658) com o Anexo III ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apurar_das(p_filial text, p_competencia date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp   date := date_trunc('month', p_competencia)::date;
  v_calc   record;
  v_venc   date;
  v_ap     public.das_apuracoes;
  v_conta  public.contas_pagar;
  v_desc   text;
BEGIN
  PERFORM public._assert_rpc('financeiro');
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Apuração de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF p_filial IS NULL OR p_filial = 'Matriz' THEN
    RAISE EXCEPTION 'A Matriz não vende: não há Simples a apurar.' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp IS NULL OR v_comp >= date_trunc('month', public.acre_today())::date THEN
    RAISE EXCEPTION 'Só se apura mês fechado — o mês corrente ainda tem venda por vir.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma apuração por vez para a mesma competência.
  PERFORM pg_advisory_xact_lock(hashtext('das:' || p_filial || ':' || v_comp::text));

  SELECT * INTO v_calc FROM public._simples_do_mes(p_filial, v_comp);
  v_venc := public.vencimento_das(v_comp);
  v_desc := format('DAS Simples Nacional — competência %s', to_char(v_comp, 'MM/YYYY'));

  SELECT * INTO v_ap FROM public.das_apuracoes WHERE filial = p_filial AND competencia = v_comp FOR UPDATE;

  IF v_ap.id IS NOT NULL THEN
    SELECT * INTO v_conta FROM public.contas_pagar WHERE id = v_ap.conta_pagar_id FOR UPDATE;
    IF v_conta.status IN ('Pago', 'Parcial') OR COALESCE(v_conta.valor_pago, 0) > 0 THEN
      RAISE EXCEPTION 'O DAS de % já foi pago (total ou parte) e não se reapura. Diferença depois do pagamento é DAS complementar — fora do exercício.',
        to_char(v_comp, 'MM/YYYY') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF COALESCE(v_calc.imposto, 0) <= 0 THEN
    -- Mês sem receita não gera DAS. Se havia apuração, ela sai.
    IF v_ap.id IS NOT NULL THEN
      PERFORM set_config('app.das', 'true', true);
      UPDATE public.contas_pagar SET ativo = false, status = 'Cancelado' WHERE id = v_ap.conta_pagar_id;
      DELETE FROM public.das_apuracoes WHERE id = v_ap.id;
      PERFORM set_config('app.das', '', true);
    END IF;
    RETURN jsonb_build_object('competencia', v_comp, 'receita', COALESCE(v_calc.receita, 0), 'valor', 0,
                              'mensagem', 'Sem receita na competência: não há DAS a pagar.');
  END IF;

  PERFORM set_config('app.das', 'true', true);
  IF v_ap.id IS NULL THEN
    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, natureza, origem)
    VALUES (v_desc, v_calc.imposto, v_venc, 'Pendente', p_filial, 'despesa', 'das')
    RETURNING * INTO v_conta;

    INSERT INTO public.das_apuracoes
      (filial, competencia, receita, receita_servico, rbt12, rbt12_origem, faixa,
       aliquota_efetiva, aliquota_efetiva_iii, valor, vencimento, conta_pagar_id)
    VALUES (p_filial, v_comp, v_calc.receita, v_calc.receita_servico, v_calc.rbt12, v_calc.rbt12_origem, v_calc.faixa,
            v_calc.aliquota_efetiva, v_calc.aliquota_efetiva_iii, v_calc.imposto, v_venc, v_conta.id)
    RETURNING * INTO v_ap;
  ELSE
    UPDATE public.contas_pagar
       SET valor = v_calc.imposto, vencimento = v_venc, descricao = v_desc
     WHERE id = v_ap.conta_pagar_id;
    UPDATE public.das_apuracoes
       SET receita = v_calc.receita, receita_servico = v_calc.receita_servico,
           rbt12 = v_calc.rbt12, rbt12_origem = v_calc.rbt12_origem, faixa = v_calc.faixa,
           aliquota_efetiva = v_calc.aliquota_efetiva, aliquota_efetiva_iii = v_calc.aliquota_efetiva_iii,
           valor = v_calc.imposto, vencimento = v_venc,
           apurado_em = now(), apurado_por = auth.uid()
     WHERE id = v_ap.id
    RETURNING * INTO v_ap;
  END IF;
  PERFORM set_config('app.das', '', true);

  RETURN jsonb_build_object(
    'competencia', v_comp, 'receita', v_ap.receita, 'receita_servico', v_ap.receita_servico,
    'faixa', v_ap.faixa, 'aliquota_efetiva', v_ap.aliquota_efetiva,
    'aliquota_efetiva_iii', v_ap.aliquota_efetiva_iii, 'valor', v_ap.valor,
    'vencimento', v_ap.vencimento, 'conta_pagar_id', v_ap.conta_pagar_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.das_competencias(p_filial text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'DAS de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial veem a apuração do imposto.'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'competencia',      m.comp,
             'receita',          c.receita,
             'receita_servico',  c.receita_servico,
             'faixa',            c.faixa,
             'aliquota_efetiva', c.aliquota_efetiva,
             'aliquota_efetiva_iii', c.aliquota_efetiva_iii,
             'imposto',          c.imposto,
             'vencimento',       public.vencimento_das(m.comp),
             'apurado',          ap.id IS NOT NULL,
             'valor_apurado',    ap.valor,
             'apurado_em',       ap.apurado_em,
             'conta_status',     cp.status,
             'conta_pagar_id',   ap.conta_pagar_id
           ) ORDER BY m.comp DESC)
      FROM (SELECT (date_trunc('month', public.acre_today()) - (n || ' months')::interval)::date AS comp
              FROM generate_series(1, 12) n) m
      CROSS JOIN LATERAL public._simples_do_mes(p_filial, m.comp) c
      LEFT JOIN public.das_apuracoes ap ON ap.filial = p_filial AND ap.competencia = m.comp
      LEFT JOIN public.contas_pagar cp ON cp.id = ap.conta_pagar_id
     WHERE c.receita <> 0 OR ap.id IS NOT NULL
  ), '[]'::jsonb);
END;
$function$;

-- ════ Parâmetros de preço com o Anexo III ════════════════════════════════════
-- Corpo da 657; linhas novas marcadas MIGR 659.
CREATE OR REPLACE FUNCTION public.parametros_precificacao(p_filial text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje       date := public.acre_today();
  v_mes        date := date_trunc('month', public.acre_today())::date;
  -- Janela: os 3 últimos meses FECHADOS. O mês corrente distorce — a
  -- despesa do mês entra de uma vez (aluguel no dia 5) e a venda vem aos poucos.
  v_ini        date := (date_trunc('month', public.acre_today()) - interval '3 months')::date;
  v_fim        date := (date_trunc('month', public.acre_today()) - interval '1 day')::date;
  v_cfg        public.filial_precificacao%ROWTYPE;
  v_rbt12      numeric;
  v_rbt_origem text;
  v_rbt_meses  integer;
  v_faixa      integer;
  v_nominal    numeric;
  v_deduzir    numeric;
  v_efetiva    numeric;
  v_nominal3   numeric;   -- MIGR 659
  v_deduzir3   numeric;   -- MIGR 659
  v_efetiva3   numeric;   -- MIGR 659
  v_base       numeric;
  v_taxas_hist numeric := 0;
  v_desp_hist  numeric;
  v_desp_pct   numeric;
  v_desp_orig  text;
  v_taxa_pct   numeric;
  v_taxa_orig  text;
  v_gestor     boolean;
  v_mix        jsonb;   -- MIGR 657
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Parâmetros de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Quem abre o DRE vê os valores em reais e edita; os demais veem só os
  -- percentuais, que é o que o cadastro de produto precisa.
  v_gestor := COALESCE(public.auth_in_setor('financeiro'), false)
           OR COALESCE(public.auth_gerente_da(p_filial), false);

  SELECT * INTO v_cfg FROM public.filial_precificacao WHERE filial = p_filial;

  SELECT r.rbt12, r.origem, r.meses INTO v_rbt12, v_rbt_origem, v_rbt_meses
    FROM public._simples_rbt12(p_filial, v_mes) r;
  SELECT a.faixa, a.aliquota_nominal, a.parcela_deduzir, a.aliquota_efetiva
    INTO v_faixa, v_nominal, v_deduzir, v_efetiva
    FROM public.simples_anexo_i(v_rbt12) a;
  -- MIGR 659: a mesma faixa na tabela do serviço.
  SELECT a.aliquota_nominal, a.parcela_deduzir, a.aliquota_efetiva
    INTO v_nominal3, v_deduzir3, v_efetiva3
    FROM public.simples_anexo_iii(v_rbt12) a;

  v_base := public._receita_simples(p_filial, v_ini, v_fim);

  IF v_base > 0 THEN
    SELECT COALESCE(SUM(cp.valor), 0) INTO v_taxas_hist
      FROM public.contas_pagar cp
     WHERE cp.ativo = true
       AND cp.filial = p_filial
       AND cp.status <> 'Cancelado'
       AND cp.origem = 'conciliacao_maquininha'
       AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN v_ini AND v_fim;
    v_desp_hist := (public._dre_calculo(p_filial, v_ini, v_fim) ->> 'despesas')::numeric - v_taxas_hist;
  END IF;

  IF v_cfg.despesas_pct_manual IS NOT NULL THEN
    v_desp_pct := v_cfg.despesas_pct_manual; v_desp_orig := 'manual';
  ELSIF v_base > 0 THEN
    v_desp_pct := ROUND(100 * GREATEST(v_desp_hist, 0) / v_base, 2); v_desp_orig := 'historico';
  ELSE
    v_desp_orig := 'sem_historico';
  END IF;

  -- MIGR 657: a taxa é a ESPERADA pelo mix de vendas × cadastro. O que a
  -- conciliação reteve vai junto, como conferência (`taxas_realizada_pct`).
  v_mix := public._taxa_pelo_mix(p_filial, v_ini, v_fim);

  IF v_cfg.taxas_pct_manual IS NOT NULL THEN
    v_taxa_pct := v_cfg.taxas_pct_manual; v_taxa_orig := 'manual';
  ELSIF (v_mix ->> 'taxa_pct') IS NOT NULL THEN
    v_taxa_pct := (v_mix ->> 'taxa_pct')::numeric; v_taxa_orig := 'mix';
  ELSE
    v_taxa_orig := 'sem_historico';
  END IF;

  RETURN jsonb_build_object(
    'filial',           p_filial,
    'regime',           COALESCE(v_cfg.regime, 'simples_anexo_i'),
    'rbt12',            CASE WHEN v_gestor THEN v_rbt12 END,
    'rbt12_origem',     v_rbt_origem,
    'rbt12_meses',      v_rbt_meses,
    'faixa',            v_faixa,
    'aliquota_nominal', v_nominal,
    'parcela_deduzir',  v_deduzir,
    'aliquota_efetiva', v_efetiva,
    -- MIGR 659
    'aliquota_nominal_iii', v_nominal3,
    'parcela_deduzir_iii',  v_deduzir3,
    'aliquota_efetiva_iii', v_efetiva3,
    'vende_servico',    EXISTS (SELECT 1 FROM public.servicos s
                                 WHERE s.filial = p_filial
                                   AND COALESCE(s.natureza, 'prestado') = 'prestado'
                                   AND COALESCE(s.ativo, true) AND s.excluido_em IS NULL
                                   AND COALESCE(s.status, 'Ativo') = 'Ativo'),
    'acima_do_teto',    COALESCE(v_rbt12, 0) > 4800000,
    'despesas_pct',     v_desp_pct,
    'despesas_origem',  v_desp_orig,
    'taxas_pct',        v_taxa_pct,
    'taxas_origem',     v_taxa_orig,
    -- MIGR 657
    'taxas_mix',        v_mix -> 'itens',
    'taxas_sem_cadastro', v_mix -> 'sem_cadastro',
    'taxas_fora_mix_pct', CASE WHEN ((v_mix ->> 'base')::numeric + (v_mix ->> 'fora')::numeric) > 0
                               THEN ROUND(100 * (v_mix ->> 'fora')::numeric
                                          / ((v_mix ->> 'base')::numeric + (v_mix ->> 'fora')::numeric), 1) END,
    'taxas_realizada_pct', CASE WHEN v_base > 0 THEN ROUND(100 * v_taxas_hist / v_base, 2) END,
    'janela_inicio',    v_ini,
    'janela_fim',       v_fim,
    'pode_editar',      v_gestor,
    'manual',           CASE WHEN v_gestor THEN jsonb_build_object(
                          'rbt12',        v_cfg.rbt12_manual,
                          'despesas_pct', v_cfg.despesas_pct_manual,
                          'taxas_pct',    v_cfg.taxas_pct_manual) END,
    'atualizado_em',    v_cfg.updated_at
  );
END;
$function$;

-- ════ Painel de BI: serviço fora do "mais vendidos" (troca cirúrgica) ═══════
DO $migra$
DECLARE
  v_def  text := pg_get_functiondef('public.gerar_painel_bi(date,date)'::regprocedure);
  v_de   text := $$LEFT JOIN produtos p ON p.id = iv.produto_id
         WHERE v.created_at::date BETWEEN p_inicio AND p_fim$$;
  v_para text := $$LEFT JOIN produtos p ON p.id = iv.produto_id
         WHERE iv.servico_id IS NULL  -- MIGR 659
           AND v.created_at::date BETWEEN p_inicio AND p_fim$$;
BEGIN
  IF position('MIGR 659' IN v_def) = 0 THEN
    v_def := replace(v_def, E'\r', '');
    IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
      RAISE EXCEPTION '659: trecho do gerar_painel_bi não encontrado exatamente uma vez';
    END IF;
    EXECUTE replace(v_def, v_de, v_para);
  END IF;
END
$migra$;

NOTIFY pgrst, 'reload schema';
