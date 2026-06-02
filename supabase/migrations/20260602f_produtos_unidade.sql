-- =================================================================
-- LogMax — produtos.unidade
--
-- Adiciona coluna `unidade` (UN, KG, L, M, CX, PC, etc.) ao cadastro
-- de produtos. Reflete a unidade de medida da regra de negócio para
-- cada produto: granéis em KG, líquidos em L, embalados em UN/CX, etc.
--
-- Apresentação no ProdutosView: a unidade do produto aparece como
-- sufixo dos campos numéricos de Estoque Inicial, Quantidade Comprada
-- e Estoque Mínimo, esclarecendo a unidade dos valores informados.
--
-- DEFAULT 'UN' — o caso mais comum em ERPs. Linhas legadas viram 'UN'
-- automaticamente; os admins ajustam manualmente conforme necessário.
-- =================================================================

BEGIN;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'UN';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Confirmar coluna criada:
--    \d+ produtos
--
-- 2. Distribuição inicial (todos legados devem estar 'UN'):
--    SELECT unidade, COUNT(*) FROM produtos GROUP BY unidade;
-- =================================================================
