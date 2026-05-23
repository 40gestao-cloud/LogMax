-- =================================================================
-- LogMax — Acelera busca server-side com pg_trgm + GIN
-- =================================================================
-- Problema:
--   useFetchData monta `or(col1.ilike.%x%, col2.ilike.%x%, ...)`
--   quando a view passa searchColumns. Sem índice apropriado, cada
--   ilike vira full table scan + match LIKE em todas as linhas.
--   Em produção com volume real, busca de Produtos / Contas / CRM
--   degrada rapidamente.
--
-- Fix:
--   pg_trgm habilita índice GIN em substring (CONTAINS / ILIKE com
--   wildcard nas duas pontas). Cobertura aplicada às colunas free-text
--   que aparecem em `searchColumns` (grep no src/views). Colunas
--   enum-like ('status', 'urgencia', 'pessoa_tipo') ficam de fora —
--   baixa cardinalidade, btree padrão já basta; trigram seria
--   desperdício de espaço.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────
-- CRM: clientes / fornecedores (CRMView, type='clientes'|'fornecedores')
-- searchColumns: nome, email, telefone, cpf_cnpj, pessoa_tipo
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clientes_nome_trgm     ON clientes     USING GIN (nome     gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clientes_email_trgm    ON clientes     USING GIN (email    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone_trgm ON clientes     USING GIN (telefone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clientes_cpfcnpj_trgm  ON clientes     USING GIN (cpf_cnpj gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_fornec_nome_trgm       ON fornecedores USING GIN (nome     gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fornec_email_trgm      ON fornecedores USING GIN (email    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fornec_telefone_trgm   ON fornecedores USING GIN (telefone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fornec_cpfcnpj_trgm    ON fornecedores USING GIN (cpf_cnpj gin_trgm_ops);

-- ─────────────────────────────────────────────
-- Produtos (ProdutosView)
-- searchColumns: nome, codigo, categoria, ean, fornecedor
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_produtos_nome_trgm       ON produtos USING GIN (nome       gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo_trgm     ON produtos USING GIN (codigo     gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria_trgm  ON produtos USING GIN (categoria  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_produtos_ean_trgm        ON produtos USING GIN (ean        gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_produtos_fornecedor_trgm ON produtos USING GIN (fornecedor gin_trgm_ops);

-- ─────────────────────────────────────────────
-- Requisicoes (RequisicoesView)
-- searchColumns: item, solicitante, urgencia, centro_custo, status
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_req_item_trgm         ON requisicoes USING GIN (item         gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_req_solicitante_trgm  ON requisicoes USING GIN (solicitante  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_req_centro_custo_trgm ON requisicoes USING GIN (centro_custo gin_trgm_ops);

-- ─────────────────────────────────────────────
-- Contas (ContasPagar/ReceberView)
-- searchColumns: descricao, status
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contas_pagar_descricao_trgm   ON contas_pagar   USING GIN (descricao gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contas_receber_descricao_trgm ON contas_receber USING GIN (descricao gin_trgm_ops);

-- ─────────────────────────────────────────────
-- Recebimentos (RecebimentosView)
-- searchColumns: status, observacao
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_recebimentos_observacao_trgm ON recebimentos USING GIN (observacao gin_trgm_ops);

-- ─────────────────────────────────────────────
-- Vendas / Histórico (HistoricoVendasView)
-- searchColumns: forma_pagamento, status
-- (forma_pagamento tem cardinalidade média — Dinheiro/Pix/Cartão x N
-- bandeiras + parcelas. Vale o GIN.)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vendas_forma_pagamento_trgm ON vendas USING GIN (forma_pagamento gin_trgm_ops);

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Extensão habilitada:
--    SELECT extname FROM pg_extension WHERE extname='pg_trgm';
--
-- 2. Confirmar que a query usa o índice (não Seq Scan):
--    EXPLAIN ANALYZE
--    SELECT * FROM produtos WHERE nome ILIKE '%caf%';
--    -- esperar "Bitmap Index Scan on idx_produtos_nome_trgm"
--
-- 3. Listar índices trigram criados:
--    SELECT indexname FROM pg_indexes
--     WHERE schemaname='public' AND indexdef ILIKE '%gin_trgm_ops%';
-- =================================================================
