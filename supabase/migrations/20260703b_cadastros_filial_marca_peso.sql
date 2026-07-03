-- Adiciona filial em categorias_produto e marca/peso em produtos.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.

-- 1. categorias_produto.filial
ALTER TABLE public.categorias_produto
  ADD COLUMN IF NOT EXISTS filial text;

CREATE INDEX IF NOT EXISTS idx_categorias_produto_filial
  ON public.categorias_produto (filial);

-- 2. produtos.marca e produtos.peso
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS marca text,
  ADD COLUMN IF NOT EXISTS peso  numeric(10,3);
