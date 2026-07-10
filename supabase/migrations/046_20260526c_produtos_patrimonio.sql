-- =================================================================
-- Produtos: separação entre 'estoque_venda' e 'patrimonio'.
--
-- Contexto:
--   Compras cadastra produtos que vão para revenda (PDV) e bens de
--   patrimônio (computadores, móveis, máquinas). Hoje tudo cai na
--   mesma tabela e aparece no PDV. Operação reportou que patrimônio
--   estava vazando para a tela de vendas, e que o Financeiro
--   precisa de controle separado (tag + responsável + localização).
--
-- Mudança:
--   - Nova coluna `tipo` com CHECK (estoque_venda | patrimonio),
--     default 'estoque_venda' (back-compat: tudo que já existe
--     mantém o comportamento anterior).
--   - Colunas opcionais `patrimonio_numero`, `patrimonio_responsavel`,
--     `patrimonio_localizacao` — usadas só quando tipo='patrimonio'.
--   - Índice parcial pra busca rápida por tag de patrimônio.
--
-- A separação no PDV (esconder patrimônio) é feita no frontend via
-- filtro `tipo='estoque_venda'`. Não há gate de RLS extra — a regra
-- é de produto, não de acesso.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- 1. Coluna `tipo`
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'estoque_venda';

-- 2. CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_produtos_tipo'
  ) THEN
    ALTER TABLE produtos
      ADD CONSTRAINT chk_produtos_tipo
      CHECK (tipo IN ('estoque_venda', 'patrimonio'));
  END IF;
END $$;

-- 3. Campos opcionais de patrimônio
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS patrimonio_numero       text,
  ADD COLUMN IF NOT EXISTS patrimonio_responsavel  text,
  ADD COLUMN IF NOT EXISTS patrimonio_localizacao  text;

-- 4. Índice parcial pra listagem/busca de patrimônio
CREATE INDEX IF NOT EXISTS idx_produtos_patrimonio_numero
  ON produtos (patrimonio_numero)
  WHERE tipo = 'patrimonio';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT tipo, count(*) FROM produtos GROUP BY 1;
--   -- esperado: tudo em 'estoque_venda' até que alguém marque algo como patrimônio.
--   INSERT INTO produtos (codigo, nome, preco, tipo, patrimonio_numero, patrimonio_responsavel, patrimonio_localizacao)
--     VALUES ('PAT-001', 'Notebook Dell Latitude', 5500.00, 'patrimonio', 'TAG-2026-001', 'Igor Neri', 'Sala TI - Rio Branco');
-- =================================================================
