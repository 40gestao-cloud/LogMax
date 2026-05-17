-- =================================================================
-- LogMax — Adicionar colunas em falta na tabela produtos
-- =================================================================
-- A UI (ProdutosView) usa preco_custo, estoque_minimo, ean e fornecedor
-- no payload de save e até pesquisa por ean/fornecedor (useFetchData
-- searchColumns), mas o schema original (logmax_supabase_schema.sql)
-- nunca foi atualizado. Por isso INSERT/UPDATE rebenta com erro
-- "Could not find the X column of 'produtos' in the schema cache".
--
-- Execute no Supabase SQL Editor.
-- =================================================================

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS preco_custo    numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estoque_minimo integer       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ean            text,
  ADD COLUMN IF NOT EXISTS fornecedor     text;

-- Índice leve para pesquisa por EAN (etiqueta escaneada no PDV/scanner).
CREATE INDEX IF NOT EXISTS produtos_ean_idx ON produtos (ean) WHERE ean IS NOT NULL;
