-- =================================================================
-- LogMax — Alinhar FKs com ON DELETE SET NULL
-- =================================================================
-- A produção original foi criada com FKs em modo default (NO ACTION),
-- bloqueando o DELETE de produtos/fornecedores/clientes/funcionários
-- quando houver registos-filho. O schema unificado já especifica
-- ON DELETE SET NULL nestas relações; esta migration alinha o banco
-- antigo com essa especificação.
--
-- Idempotente: cada bloco DROP IF EXISTS + ADD. Seguro rodar várias
-- vezes ou em ambientes onde a FK já está correta (o DROP recria-a
-- com o mesmo nome).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─── Referências a produtos ──────────────────────────────────
ALTER TABLE requisicoes_estoque
  DROP CONSTRAINT IF EXISTS requisicoes_estoque_produto_id_fkey,
  ADD  CONSTRAINT requisicoes_estoque_produto_id_fkey
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE expedicao
  DROP CONSTRAINT IF EXISTS expedicao_produto_id_fkey,
  ADD  CONSTRAINT expedicao_produto_id_fkey
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS movimentacoes_estoque_produto_id_fkey,
  ADD  CONSTRAINT movimentacoes_estoque_produto_id_fkey
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE inventarios
  DROP CONSTRAINT IF EXISTS inventarios_produto_id_fkey,
  ADD  CONSTRAINT inventarios_produto_id_fkey
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE vencimentos_estoque
  DROP CONSTRAINT IF EXISTS vencimentos_estoque_produto_id_fkey,
  ADD  CONSTRAINT vencimentos_estoque_produto_id_fkey
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE itens_venda
  DROP CONSTRAINT IF EXISTS itens_venda_produto_id_fkey,
  ADD  CONSTRAINT itens_venda_produto_id_fkey
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

ALTER TABLE marketing_promocoes
  DROP CONSTRAINT IF EXISTS marketing_promocoes_produto_id_fkey,
  ADD  CONSTRAINT marketing_promocoes_produto_id_fkey
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL;

-- ─── Referências a fornecedores ──────────────────────────────
ALTER TABLE cotacoes
  DROP CONSTRAINT IF EXISTS cotacoes_fornecedor_id_fkey,
  ADD  CONSTRAINT cotacoes_fornecedor_id_fkey
    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;

ALTER TABLE pedidos
  DROP CONSTRAINT IF EXISTS pedidos_fornecedor_id_fkey,
  ADD  CONSTRAINT pedidos_fornecedor_id_fkey
    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;

ALTER TABLE notas_recebidas
  DROP CONSTRAINT IF EXISTS notas_recebidas_fornecedor_id_fkey,
  ADD  CONSTRAINT notas_recebidas_fornecedor_id_fkey
    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;

ALTER TABLE contas_pagar
  DROP CONSTRAINT IF EXISTS contas_pagar_fornecedor_id_fkey,
  ADD  CONSTRAINT contas_pagar_fornecedor_id_fkey
    FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;

-- ─── Referências a clientes ──────────────────────────────────
ALTER TABLE vendas
  DROP CONSTRAINT IF EXISTS vendas_cliente_id_fkey,
  ADD  CONSTRAINT vendas_cliente_id_fkey
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;

ALTER TABLE contas_receber
  DROP CONSTRAINT IF EXISTS contas_receber_cliente_id_fkey,
  ADD  CONSTRAINT contas_receber_cliente_id_fkey
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;

ALTER TABLE pix_pendentes
  DROP CONSTRAINT IF EXISTS pix_pendentes_cliente_id_fkey,
  ADD  CONSTRAINT pix_pendentes_cliente_id_fkey
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;

ALTER TABLE projetos
  DROP CONSTRAINT IF EXISTS projetos_cliente_id_fkey,
  ADD  CONSTRAINT projetos_cliente_id_fkey
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;

-- ─── Referências a funcionarios ──────────────────────────────
ALTER TABLE folha_pagamento
  DROP CONSTRAINT IF EXISTS folha_pagamento_funcionario_id_fkey,
  ADD  CONSTRAINT folha_pagamento_funcionario_id_fkey
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL;

ALTER TABLE ferias
  DROP CONSTRAINT IF EXISTS ferias_funcionario_id_fkey,
  ADD  CONSTRAINT ferias_funcionario_id_fkey
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL;

ALTER TABLE ponto_eletronico
  DROP CONSTRAINT IF EXISTS ponto_eletronico_funcionario_id_fkey,
  ADD  CONSTRAINT ponto_eletronico_funcionario_id_fkey
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL;

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_funcionario_id_fkey,
  ADD  CONSTRAINT user_profiles_funcionario_id_fkey
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL;

-- ─── Referências a filiais ───────────────────────────────────
ALTER TABLE colaboradores
  DROP CONSTRAINT IF EXISTS colaboradores_filial_id_fkey,
  ADD  CONSTRAINT colaboradores_filial_id_fkey
    FOREIGN KEY (filial_id) REFERENCES filiais(id) ON DELETE SET NULL;

-- ─── Cadeia compras (requisicoes → cotacoes → pedidos → recebimentos) ─
ALTER TABLE cotacoes
  DROP CONSTRAINT IF EXISTS cotacoes_requisicao_id_fkey,
  ADD  CONSTRAINT cotacoes_requisicao_id_fkey
    FOREIGN KEY (requisicao_id) REFERENCES requisicoes(id) ON DELETE SET NULL;

ALTER TABLE pedidos
  DROP CONSTRAINT IF EXISTS pedidos_cotacao_id_fkey,
  ADD  CONSTRAINT pedidos_cotacao_id_fkey
    FOREIGN KEY (cotacao_id) REFERENCES cotacoes(id) ON DELETE SET NULL;

ALTER TABLE recebimentos
  DROP CONSTRAINT IF EXISTS recebimentos_pedido_id_fkey,
  ADD  CONSTRAINT recebimentos_pedido_id_fkey
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL;

ALTER TABLE contas_pagar
  DROP CONSTRAINT IF EXISTS contas_pagar_pedido_id_fkey,
  ADD  CONSTRAINT contas_pagar_pedido_id_fkey
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL;

ALTER TABLE expedicao
  DROP CONSTRAINT IF EXISTS expedicao_requisicao_id_fkey,
  ADD  CONSTRAINT expedicao_requisicao_id_fkey
    FOREIGN KEY (requisicao_id) REFERENCES requisicoes_estoque(id) ON DELETE SET NULL;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
-- =================================================================
-- Após rodar, valide com:
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conname IN (
--      'requisicoes_estoque_produto_id_fkey',
--      'cotacoes_fornecedor_id_fkey'
--    );
-- confdeltype deve ser 'n' (SET NULL). 'a' = NO ACTION (errado).
-- =================================================================
