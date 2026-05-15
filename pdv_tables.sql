-- =================================================================
-- LogMax ERP — Módulo PDV
-- Execute no Supabase SQL Editor
-- =================================================================

CREATE TABLE IF NOT EXISTS vendas (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id      uuid REFERENCES clientes(id) ON DELETE SET NULL,
  total           numeric(15,2) NOT NULL DEFAULT 0,
  desconto        numeric(15,2) NOT NULL DEFAULT 0,
  total_final     numeric(15,2) NOT NULL DEFAULT 0,
  forma_pagamento text NOT NULL DEFAULT 'Dinheiro',
  status          text NOT NULL DEFAULT 'Concluída',
  observacao      text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE vendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendas_auth" ON vendas;
CREATE POLICY "vendas_auth" ON vendas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS itens_venda (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  venda_id        uuid NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  produto_id      uuid REFERENCES produtos(id) ON DELETE SET NULL,
  nome_produto    text NOT NULL,
  qtd             integer NOT NULL DEFAULT 1,
  preco_unitario  numeric(15,2) NOT NULL DEFAULT 0,
  subtotal        numeric(15,2) NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE itens_venda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "itens_venda_auth" ON itens_venda;
CREATE POLICY "itens_venda_auth" ON itens_venda
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
