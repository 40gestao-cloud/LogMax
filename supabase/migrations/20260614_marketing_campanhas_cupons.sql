-- =================================================================
-- LogMax — Marketing: Campanhas (ROI) + Cupons promocionais
-- =================================================================
-- Acrescenta dois conceitos clássicos de marketing ao ERP didático:
--
--   1. CAMPANHA — guarda-chuva acima de promoções e cupons. Tem
--      período, orçamento (custo previsto + gasto real), objetivo
--      e filial-alvo. O ROI é calculado agregando vendas no período
--      (matched por filial-alvo OU vendas que usaram cupom da campanha)
--      contra `gasto_real`. Promoções ganham FK opcional pra campanha.
--
--   2. CUPOM — código promocional aplicado no PDV. Tipos:
--        • 'percentual' — % sobre o subtotal (com teto opcional)
--        • 'fixo'       — valor R$ fixo
--      Restrições: validade, valor mínimo de compra, limite de usos,
--      filial-alvo. `validar_cupom` é o único caminho para descobrir
--      o desconto (RPC SECURITY DEFINER); o PDV chama na hora de
--      digitar o código e re-valida ao fechar a venda.
--
--   3. Integração com PDV — `criar_venda_pdv` ganha 2 params opcionais
--      (p_cupom_codigo, p_cupom_desconto). Quando presentes:
--        • re-valida o cupom no servidor (não confia no front);
--        • verifica que o desconto enviado bate com o cupom (±0,01);
--        • persiste cupom_id + cupom_codigo + cupom_desconto na venda;
--        • incrementa `usos` atomicamente sob lock pessimista.
--      Backwards-compatible: chamadas sem cupom funcionam idêntico.
--
-- Idempotente (CREATE TABLE IF NOT EXISTS, DROP POLICY antes de CREATE,
-- CREATE OR REPLACE FUNCTION). Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabela: marketing_campanhas
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_campanhas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text        NOT NULL,
  descricao     text,
  objetivo      text,
  -- Filial-alvo opcional. NULL = todas as filiais (campanha holding).
  filial        text,
  data_inicio   date        NOT NULL,
  data_fim      date        NOT NULL,
  -- Orçamento previsto vs. gasto realizado. admin/CEO/financeiro
  -- atualiza gasto_real conforme nota fiscal entra.
  orcamento     numeric(12,2) NOT NULL DEFAULT 0,
  gasto_real    numeric(12,2) NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'Rascunho',
  nome_criador  text,
  criado_por    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ativo         boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_campanha_periodo CHECK (data_fim >= data_inicio),
  CONSTRAINT chk_campanha_status  CHECK (status IN ('Rascunho','Ativa','Concluída','Cancelada')),
  CONSTRAINT chk_campanha_orcamento CHECK (orcamento >= 0 AND gasto_real >= 0)
);

CREATE INDEX IF NOT EXISTS idx_campanhas_status      ON marketing_campanhas(status) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_campanhas_periodo     ON marketing_campanhas(data_inicio, data_fim) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_campanhas_created_at  ON marketing_campanhas(created_at DESC);

CREATE OR REPLACE FUNCTION trg_marketing_campanhas_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_campanhas_updated_at ON marketing_campanhas;
CREATE TRIGGER marketing_campanhas_updated_at
  BEFORE UPDATE ON marketing_campanhas
  FOR EACH ROW EXECUTE FUNCTION trg_marketing_campanhas_updated_at();

ALTER TABLE marketing_campanhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campanhas_read"   ON marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_insert" ON marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_update" ON marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_delete" ON marketing_campanhas;

-- Read: todos autenticados (financeiro precisa ver orçamento; PDV não acessa).
CREATE POLICY "campanhas_read" ON marketing_campanhas
  FOR SELECT TO authenticated USING (true);

-- Write: marketing + admin/CEO. Financeiro tb pode atualizar `gasto_real`
-- via UPDATE livre (RLS não consegue restringir colunas; controlamos no UI).
CREATE POLICY "campanhas_insert" ON marketing_campanhas
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "campanhas_update" ON marketing_campanhas
  FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing') OR auth_in_setor('financeiro'))
  WITH CHECK (auth_in_setor('marketing') OR auth_in_setor('financeiro'));

CREATE POLICY "campanhas_delete" ON marketing_campanhas
  FOR DELETE TO authenticated
  USING (auth_in_setor('marketing'));

-- ─────────────────────────────────────────────
-- 2. Tabela: marketing_cupons
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_cupons (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          text        NOT NULL,
  tipo            text        NOT NULL,
  valor           numeric(12,2) NOT NULL,
  -- Valor mínimo de compra pra acionar o cupom. 0 = sem mínimo.
  valor_minimo    numeric(12,2) NOT NULL DEFAULT 0,
  -- Teto de desconto pra cupom percentual. NULL = sem teto.
  desconto_maximo numeric(12,2),
  validade_inicio date,
  validade_fim    date        NOT NULL,
  -- Limite de usos totais (não por cliente). NULL = ilimitado.
  limite_uso      integer,
  usos            integer     NOT NULL DEFAULT 0,
  -- Filial-alvo opcional. NULL = válido em qualquer filial.
  filial          text,
  campanha_id     uuid        REFERENCES marketing_campanhas(id) ON DELETE SET NULL,
  descricao       text,
  nome_criador    text,
  criado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ativo           boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cupom_tipo            CHECK (tipo IN ('percentual','fixo')),
  CONSTRAINT chk_cupom_valor_positivo  CHECK (valor > 0),
  CONSTRAINT chk_cupom_percentual_max  CHECK (tipo <> 'percentual' OR valor <= 100),
  CONSTRAINT chk_cupom_limite_positivo CHECK (limite_uso IS NULL OR limite_uso > 0),
  CONSTRAINT chk_cupom_usos_positivo   CHECK (usos >= 0),
  CONSTRAINT chk_cupom_validade        CHECK (validade_inicio IS NULL OR validade_fim >= validade_inicio),
  CONSTRAINT chk_cupom_valor_minimo    CHECK (valor_minimo >= 0)
);

-- Códigos únicos só entre cupons ativos. Cupom expirado e inativado libera
-- o código pra ser reaproveitado (segue padrão de [[feedback_partial_unique_soft_delete]]).
-- Normaliza UPPER pra que 'PRIMAVERA10' e 'primavera10' não coexistam.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cupons_codigo_ativo
  ON marketing_cupons (UPPER(codigo))
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_cupons_validade_fim  ON marketing_cupons(validade_fim) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_cupons_campanha     ON marketing_cupons(campanha_id) WHERE campanha_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cupons_created_at   ON marketing_cupons(created_at DESC);

CREATE OR REPLACE FUNCTION trg_marketing_cupons_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_cupons_updated_at ON marketing_cupons;
CREATE TRIGGER marketing_cupons_updated_at
  BEFORE UPDATE ON marketing_cupons
  FOR EACH ROW EXECUTE FUNCTION trg_marketing_cupons_updated_at();

ALTER TABLE marketing_cupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupons_read"   ON marketing_cupons;
DROP POLICY IF EXISTS "cupons_insert" ON marketing_cupons;
DROP POLICY IF EXISTS "cupons_update" ON marketing_cupons;
DROP POLICY IF EXISTS "cupons_delete" ON marketing_cupons;

-- Read: todos autenticados podem listar. Cupom não é segredo absoluto —
-- o PDV precisa exibir o código aplicado e o caixa precisa enxergar o
-- cupom escolhido. A validação real fica no RPC `validar_cupom` (que
-- decide se aplica) e no incremento atômico em `criar_venda_pdv`.
CREATE POLICY "cupons_read" ON marketing_cupons
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cupons_insert" ON marketing_cupons
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "cupons_update" ON marketing_cupons
  FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing'))
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "cupons_delete" ON marketing_cupons
  FOR DELETE TO authenticated
  USING (auth_in_setor('marketing'));

-- ─────────────────────────────────────────────
-- 3. marketing_promocoes ganha FK opcional pra campanha
-- ─────────────────────────────────────────────

ALTER TABLE marketing_promocoes
  ADD COLUMN IF NOT EXISTS campanha_id uuid
    REFERENCES marketing_campanhas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promocoes_campanha
  ON marketing_promocoes(campanha_id) WHERE campanha_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 4. vendas ganha colunas de cupom (audit + ROI)
-- ─────────────────────────────────────────────

ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS cupom_id        uuid REFERENCES marketing_cupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cupom_codigo    text,
  ADD COLUMN IF NOT EXISTS cupom_desconto  numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_vendas_cupom_id ON vendas(cupom_id) WHERE cupom_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 5. RPC: validar_cupom (consulta-only, SECURITY DEFINER)
-- ─────────────────────────────────────────────
-- Front chama no momento em que o operador digita o código (debounced).
-- Retorna jsonb: { valido, motivo, cupom_id, codigo, tipo, valor, desconto }.
-- `desconto` já vem aplicado às regras: percentual com teto, fixo capado
-- ao subtotal. Não consulta usos sob lock — só lê `usos < limite_uso`.
-- O incremento real e o lock acontecem no `criar_venda_pdv`.
CREATE OR REPLACE FUNCTION validar_cupom(
  p_codigo   text,
  p_filial   text,
  p_subtotal numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom  marketing_cupons;
  v_today  date := public.acre_today();
  v_desc   numeric(12,2);
BEGIN
  IF p_codigo IS NULL OR length(trim(p_codigo)) = 0 THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'Informe o código do cupom.');
  END IF;

  IF p_subtotal IS NULL OR p_subtotal <= 0 THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'Carrinho vazio.');
  END IF;

  SELECT *
    INTO v_cupom
    FROM marketing_cupons
   WHERE UPPER(codigo) = UPPER(trim(p_codigo))
     AND ativo = true
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'Cupom não encontrado.');
  END IF;

  IF v_cupom.validade_inicio IS NOT NULL AND v_today < v_cupom.validade_inicio THEN
    RETURN jsonb_build_object('valido', false, 'motivo',
      'Cupom ainda não está em vigor (inicia em ' || to_char(v_cupom.validade_inicio, 'DD/MM/YYYY') || ').');
  END IF;

  IF v_today > v_cupom.validade_fim THEN
    RETURN jsonb_build_object('valido', false, 'motivo',
      'Cupom expirou em ' || to_char(v_cupom.validade_fim, 'DD/MM/YYYY') || '.');
  END IF;

  IF v_cupom.filial IS NOT NULL AND v_cupom.filial <> p_filial THEN
    RETURN jsonb_build_object('valido', false, 'motivo',
      'Cupom válido apenas em ' || v_cupom.filial || '.');
  END IF;

  IF p_subtotal < v_cupom.valor_minimo THEN
    RETURN jsonb_build_object('valido', false, 'motivo',
      'Compra mínima de R$ ' || to_char(v_cupom.valor_minimo, 'FM999G999G990D00') || ' para usar este cupom.');
  END IF;

  IF v_cupom.limite_uso IS NOT NULL AND v_cupom.usos >= v_cupom.limite_uso THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'Cupom atingiu o limite de usos.');
  END IF;

  -- Cálculo do desconto.
  IF v_cupom.tipo = 'percentual' THEN
    v_desc := ROUND(p_subtotal * v_cupom.valor / 100.0, 2);
    IF v_cupom.desconto_maximo IS NOT NULL AND v_desc > v_cupom.desconto_maximo THEN
      v_desc := v_cupom.desconto_maximo;
    END IF;
  ELSE
    v_desc := v_cupom.valor;
  END IF;

  -- Cap final: nunca devolver desconto maior que o subtotal (zero a conta,
  -- não vira negativo).
  IF v_desc > p_subtotal THEN
    v_desc := p_subtotal;
  END IF;

  RETURN jsonb_build_object(
    'valido',     true,
    'cupom_id',   v_cupom.id,
    'codigo',     v_cupom.codigo,
    'tipo',       v_cupom.tipo,
    'valor',      v_cupom.valor,
    'desconto',   v_desc,
    'descricao',  v_cupom.descricao
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validar_cupom(text, text, numeric) TO authenticated;

-- ─────────────────────────────────────────────
-- 6. criar_venda_pdv ganha suporte a cupom
-- ─────────────────────────────────────────────
-- Mudanças (vs. 20260612_pdv_qtd_decimal_kg.sql):
--   • +2 params opcionais (p_cupom_codigo text, p_cupom_desconto numeric)
--     com DEFAULT NULL/0 — chamadas existentes seguem funcionando.
--   • Se p_cupom_codigo presente:
--       1. Lock pessimista no cupom (FOR UPDATE) pra evitar race com
--          outro caixa esgotando o limite_uso ao mesmo tempo.
--       2. Re-valida validade/filial/limite/valor mínimo via lógica
--          embutida (não chama validar_cupom — economiza overhead e
--          lê dentro do lock).
--       3. Recalcula desconto server-side e exige que p_cupom_desconto
--          bata (±0,01). Front pode mentir; servidor recusa.
--       4. Persiste cupom_id/cupom_codigo/cupom_desconto em vendas.
--       5. UPDATE marketing_cupons SET usos = usos + 1.
--   • Tudo dentro da transação do RPC — venda + uso são atômicos.

CREATE OR REPLACE FUNCTION criar_venda_pdv(
  p_cliente_id      uuid,
  p_total           numeric,
  p_desconto        numeric,
  p_total_final     numeric,
  p_forma_pagamento text,
  p_parcelas        integer,
  p_itens           jsonb,
  p_filial          text DEFAULT NULL,
  p_cupom_codigo    text DEFAULT NULL,
  p_cupom_desconto  numeric DEFAULT 0
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
  v_produtos_resumo text;
  v_estoque_atual numeric(15,3);
  v_nome_produto  text;
  v_qtd_pedida    numeric(15,3);
  v_produto_id    uuid;
  v_soma_itens    numeric(15,2);
  v_desconto      numeric(15,2) := COALESCE(p_desconto, 0);
  v_filial        text          := COALESCE(p_filial, 'Matriz');
  -- Cupom
  v_cupom         marketing_cupons;
  v_cupom_desc    numeric(15,2) := COALESCE(p_cupom_desconto, 0);
  v_cupom_calc    numeric(15,2);
  v_tem_cupom     boolean := p_cupom_codigo IS NOT NULL AND length(trim(p_cupom_codigo)) > 0;
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
    IF (v_item->>'qtd')::numeric <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida no item "%".', v_item->>'nome_produto'
        USING ERRCODE = 'P0001';
    END IF;
    IF ABS(((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::numeric) - (v_item->>'subtotal')::numeric) > 0.01 THEN
      RAISE EXCEPTION
        'Subtotal incoerente no item "%": esperado R$ %, recebido R$ %.',
        v_item->>'nome_produto',
        to_char((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::numeric, 'FM999G999G990D00'),
        to_char((v_item->>'subtotal')::numeric, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ─── Cupom: lock + re-validação + recálculo do desconto ──────────
  IF v_tem_cupom THEN
    SELECT *
      INTO v_cupom
      FROM marketing_cupons
     WHERE UPPER(codigo) = UPPER(trim(p_cupom_codigo))
       AND ativo = true
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cupom "%" não encontrado.', p_cupom_codigo USING ERRCODE = 'P0001';
    END IF;

    IF v_cupom.validade_inicio IS NOT NULL AND v_today < v_cupom.validade_inicio THEN
      RAISE EXCEPTION 'Cupom só passa a valer em %.', to_char(v_cupom.validade_inicio, 'DD/MM/YYYY')
        USING ERRCODE = 'P0001';
    END IF;

    IF v_today > v_cupom.validade_fim THEN
      RAISE EXCEPTION 'Cupom expirou em %.', to_char(v_cupom.validade_fim, 'DD/MM/YYYY')
        USING ERRCODE = 'P0001';
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

    -- Anti-fraude: front não pode declarar desconto de cupom diferente do
    -- que o servidor calcula. Tolerância de R$ 0,01 (arredondamento).
    IF ABS(v_cupom_calc - v_cupom_desc) > 0.01 THEN
      RAISE EXCEPTION
        'Desconto do cupom inconsistente: servidor calculou R$ %, cliente enviou R$ %.',
        to_char(v_cupom_calc, 'FM999G999G990D00'),
        to_char(v_cupom_desc, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;

    -- O desconto total enviado precisa cobrir pelo menos o cupom. O
    -- operador pode dar desconto adicional manual; nunca menor.
    IF v_desconto + 0.01 < v_cupom_calc THEN
      RAISE EXCEPTION
        'Desconto total (R$ %) menor que o cupom (R$ %).',
        to_char(v_desconto,   'FM999G999G990D00'),
        to_char(v_cupom_calc, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ─── Lock + validação de estoque ──────────────────────────────────
  FOR v_produto_id, v_qtd_pedida IN
    SELECT (item->>'produto_id')::uuid,
           SUM((item->>'qtd')::numeric)
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
  INSERT INTO vendas (
    cliente_id, total, desconto, total_final, forma_pagamento, status, filial,
    cupom_id, cupom_codigo, cupom_desconto
  )
  VALUES (
    p_cliente_id, p_total, v_desconto, p_total_final, p_forma_pagamento, 'Concluída', v_filial,
    CASE WHEN v_tem_cupom THEN v_cupom.id     ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom.codigo ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom_calc   ELSE 0    END
  )
  RETURNING id INTO v_venda_id;

  v_short_id := UPPER(RIGHT(v_venda_id::text, 6));

  IF p_cliente_id IS NOT NULL THEN
    SELECT nome INTO v_cliente_nome FROM clientes WHERE id = p_cliente_id;
  END IF;

  SELECT string_agg(
    CASE WHEN (item->>'qtd')::numeric <> 1
      THEN replace((item->>'qtd'), '.', ',') || 'x ' || (item->>'nome_produto')
      ELSE (item->>'nome_produto')
    END,
    ', '
    ORDER BY ord
  )
  INTO v_produtos_resumo
  FROM jsonb_array_elements(p_itens) WITH ORDINALITY AS t(item, ord);

  IF v_produtos_resumo IS NULL THEN
    v_produtos_resumo := '';
  END IF;

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

    INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data)
    VALUES ((v_item->>'produto_id')::uuid, 'Saída', (v_item->>'qtd')::numeric,
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

  -- Incremento atômico do uso do cupom (sob o lock pego acima).
  IF v_tem_cupom THEN
    UPDATE marketing_cupons
       SET usos = usos + 1
     WHERE id = v_cupom.id;
  END IF;

  RETURN v_venda_id;
END;
$$;

-- Remove assinatura anterior (8 params) pra evitar overload ambíguo.
DROP FUNCTION IF EXISTS criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text);
GRANT EXECUTE ON FUNCTION criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb, text, text, numeric)
  TO authenticated;

-- ─────────────────────────────────────────────
-- 7. View de ROI por campanha
-- ─────────────────────────────────────────────
-- Agrega vendas que tocam a campanha de duas formas:
--   a) vendas no período da campanha, na filial-alvo (ou em qualquer filial
--      se a campanha for holding);
--   b) vendas que usaram um cupom vinculado à campanha (mesmo fora do período).
-- Cada venda entra uma única vez (UNION removerá duplicatas via DISTINCT).
-- ROI exposto em % = (receita - gasto) / NULLIF(gasto, 0) * 100.
-- View pública (sem RLS própria); herda RLS de vendas/cupons/campanhas.

CREATE OR REPLACE VIEW v_campanha_roi AS
WITH vendas_campanha AS (
  SELECT DISTINCT v.id, c.id AS campanha_id, v.total_final, v.created_at
    FROM marketing_campanhas c
    JOIN vendas v ON (
      -- (a) vendas no período da campanha, na filial-alvo
      (
        v.created_at::date BETWEEN c.data_inicio AND c.data_fim
        AND (c.filial IS NULL OR v.filial = c.filial)
        AND v.status = 'Concluída'
        AND v.ativo = true
      )
      OR
      -- (b) vendas com cupom da campanha (não importa data/filial)
      EXISTS (
        SELECT 1 FROM marketing_cupons cu
         WHERE cu.id = v.cupom_id
           AND cu.campanha_id = c.id
      )
    )
)
SELECT
  c.id,
  c.nome,
  c.filial,
  c.data_inicio,
  c.data_fim,
  c.status,
  c.orcamento,
  c.gasto_real,
  COALESCE(SUM(vc.total_final), 0)::numeric(15,2) AS receita,
  COUNT(vc.id)::integer                           AS vendas_count,
  CASE WHEN COUNT(vc.id) > 0
       THEN ROUND(SUM(vc.total_final) / COUNT(vc.id), 2)
       ELSE 0
  END                                             AS ticket_medio,
  CASE WHEN c.gasto_real > 0
       THEN ROUND(((COALESCE(SUM(vc.total_final), 0) - c.gasto_real) / c.gasto_real) * 100, 2)
       ELSE NULL
  END                                             AS roi_percent
FROM marketing_campanhas c
LEFT JOIN vendas_campanha vc ON vc.campanha_id = c.id
WHERE c.ativo = true
GROUP BY c.id;

GRANT SELECT ON v_campanha_roi TO authenticated;

-- ─────────────────────────────────────────────
-- 8. Realtime publication
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_campanhas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_campanhas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_cupons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_cupons;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT count(*) FROM marketing_campanhas;
--   SELECT count(*) FROM marketing_cupons;
--   -- como gerente de marketing logado:
--   --   INSERT INTO marketing_campanhas (nome, data_inicio, data_fim, orcamento, status)
--   --     VALUES ('Verão 2026', '2026-01-01', '2026-03-31', 500, 'Ativa');
--   --   INSERT INTO marketing_cupons (codigo, tipo, valor, validade_fim)
--   --     VALUES ('VERAO10', 'percentual', 10, '2026-03-31');
--   -- validar:
--   --   SELECT validar_cupom('VERAO10', 'SuperMax', 250);
-- =================================================================
