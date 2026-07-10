-- ─────────────────────────────────────────────────────────────────────────────
-- LogMax — Alinhamento de fuso horário no SQL (Acre / UTC-5)
-- Data: 2026-05-30
--
-- Problema:
--   Supabase corre em UTC. `CURRENT_DATE` (e `now()::date`) avalia o dia UTC.
--   Em Rio Branco (UTC-5), uma operação às 19h ACT já está no dia UTC seguinte
--   — então DEFAULTs e cálculos em RPC ficam +1 dia errados nas últimas 5 horas
--   de cada dia local.
--
--   O frontend já trata o problema via `todayBR()` (`src/lib/dates.ts`),
--   mas só onde o front controla a data. Onde o front NÃO manda (DEFAULTs
--   de coluna acionados por insert sem o campo `data`, e cálculos puramente
--   server-side em RPC), o bug persiste.
--
-- Solução:
--   1. Helper `public.acre_today()` (STABLE) — equivalente a `CURRENT_DATE`
--      mas em America/Rio_Branco.
--   2. ALTER TABLE substituindo DEFAULT CURRENT_DATE pela helper em 7 colunas.
--   3. CREATE OR REPLACE de 3 RPCs trocando `CURRENT_DATE` por `acre_today()`:
--      criar_venda_pdv, converter_orcamento_em_pedido, reverter_promocoes_expiradas.
--
-- Decisão: apenas correção a partir desta data, SEM backfill. Linhas antigas
-- com data UTC permanecem; recuperação fica caso-a-caso.
--
-- Idempotente — rodar 2x não causa efeito colateral. Execute no SQL Editor
-- do Supabase (dev e prod separadamente — atenção ao schema drift).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1) Helper ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acre_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'America/Rio_Branco')::date;
$$;

GRANT EXECUTE ON FUNCTION public.acre_today() TO authenticated;

COMMENT ON FUNCTION public.acre_today() IS
  'Data de hoje no fuso America/Rio_Branco (UTC-5, sem DST). '
  'Use no lugar de CURRENT_DATE em DEFAULTs e cálculos de RPC para '
  'alinhar com a operação física da escola em Rio Branco.';

-- ─── 2) DEFAULTs de colunas date ────────────────────────────────────────────
-- ALTER ... SET DEFAULT é idempotente (sobrescreve sem erro).
-- Cada coluna foi mapeada por busca em logmax_supabase_schema.sql + migrations.

ALTER TABLE public.requisicoes
  ALTER COLUMN data SET DEFAULT public.acre_today();

ALTER TABLE public.recebimentos
  ALTER COLUMN data SET DEFAULT public.acre_today();

ALTER TABLE public.expedicao
  ALTER COLUMN data_expedicao SET DEFAULT public.acre_today();

ALTER TABLE public.movimentacoes_estoque
  ALTER COLUMN data SET DEFAULT public.acre_today();

ALTER TABLE public.inventarios
  ALTER COLUMN data SET DEFAULT public.acre_today();

ALTER TABLE public.integracoes_bancarias
  ALTER COLUMN data_import SET DEFAULT public.acre_today();

ALTER TABLE public.orcamentos
  ALTER COLUMN data_emissao SET DEFAULT public.acre_today();

-- ─── 3a) criar_venda_pdv ────────────────────────────────────────────────────
-- Última versão estável: 20260523b_pdv_validar_totais.sql. Mudança única:
-- v_today date := CURRENT_DATE  →  v_today date := public.acre_today().
-- O restante do corpo permanece byte-a-byte idêntico para evitar regressão.

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
  VALUES (p_cliente_id, p_total, v_desconto, p_total_final, p_forma_pagamento, 'Concluída', p_filial)
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

-- ─── 3b) converter_orcamento_em_pedido ──────────────────────────────────────
-- Última versão estável: 20260529b_corrigir_link_view_notificacoes_pedido_venda.sql.
-- Mudança única: v_vencimento := CURRENT_DATE + 30 → public.acre_today() + 30.

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_pedido(
  p_orcamento_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc            public.orcamentos;
  v_pedido_id      uuid;
  v_conta_id       uuid;
  v_cliente_nome   text;
  v_desc           text;
  v_vencimento     date;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_orc.pedido_venda_id IS NOT NULL THEN
    RETURN v_orc.pedido_venda_id;
  END IF;

  IF v_orc.status <> 'Aprovado Cliente' THEN
    RAISE EXCEPTION 'Só é possível converter orçamentos aprovados pelo cliente. Status atual: %.', v_orc.status
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.pedidos_venda (
    orcamento_id, cliente_id, vendedor_id, vendedor_nome,
    itens, valor_total, status
  )
  VALUES (
    v_orc.id, v_orc.cliente_id, v_orc.vendedor_id, v_orc.vendedor_nome,
    v_orc.itens, v_orc.valor_total, 'Aguardando Separação'
  )
  RETURNING id INTO v_pedido_id;

  SELECT nome INTO v_cliente_nome FROM public.clientes WHERE id = v_orc.cliente_id;
  v_desc       := 'Pedido Venda #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                  || COALESCE(' - ' || v_cliente_nome, '');
  v_vencimento := public.acre_today() + 30;

  INSERT INTO public.contas_receber (cliente_id, descricao, valor, vencimento, status)
  VALUES (v_orc.cliente_id, v_desc, v_orc.valor_total, v_vencimento, 'Aberto')
  RETURNING id INTO v_conta_id;

  UPDATE public.pedidos_venda
     SET conta_receber_id = v_conta_id
   WHERE id = v_pedido_id;

  UPDATE public.orcamentos
     SET status = 'Convertido em Pedido',
         pedido_venda_id = v_pedido_id
   WHERE id = v_orc.id;

  PERFORM public.notificar_setor(
    p_setor      => 'logistica',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Novo pedido de venda para separar',
    p_mensagem   => 'Pedido #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                    || COALESCE(' - ' || v_cliente_nome, ''),
    p_link_view  => 'estoque-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id,
    p_motivo     => NULL
  );

  PERFORM public.notificar_setor(
    p_setor      => 'financeiro',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Pedido de venda aguardando pagamento',
    p_mensagem   => 'Pedido #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                    || COALESCE(' - ' || v_cliente_nome, '')
                    || ' (Conta a Receber #' || UPPER(SUBSTRING(v_conta_id::text, 1, 6)) || ')',
    p_link_view  => 'financeiro-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id,
    p_motivo     => NULL
  );

  RETURN v_pedido_id;
END;
$$;

-- ─── 3c) reverter_promocoes_expiradas ───────────────────────────────────────
-- Fonte: promocoes_reversao.sql (raiz). Mudança única:
-- data_fim < CURRENT_DATE → data_fim < public.acre_today().

CREATE OR REPLACE FUNCTION reverter_promocoes_expiradas()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec   RECORD;
  total INT := 0;
BEGIN
  FOR rec IN
    SELECT id, produto_id, preco_atual, preco_promocional
    FROM marketing_promocoes
    WHERE status     = 'Aprovado'
      AND data_fim IS NOT NULL
      AND data_fim   < public.acre_today()
      AND produto_id IS NOT NULL
  LOOP
    UPDATE produtos
       SET preco = rec.preco_atual
     WHERE id    = rec.produto_id
       AND preco = rec.preco_promocional;

    UPDATE marketing_promocoes
       SET status = 'Encerrada'
     WHERE id     = rec.id;

    total := total + 1;
  END LOOP;

  RETURN total;
END;
$$;

GRANT EXECUTE ON FUNCTION reverter_promocoes_expiradas() TO authenticated;

COMMIT;
