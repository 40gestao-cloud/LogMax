-- =================================================================
-- LogMax — marketing_promocoes.tipo_origem
--
-- Adiciona suporte a promoções de SERVIÇOS além de produtos.
--
-- Hoje a tabela `marketing_promocoes` tem `produto_id` (uuid) +
-- `nome_produto` (snapshot). Sem distinguir a origem, não é possível
-- saber se `produto_id` aponta para `produtos` ou para `servicos` —
-- impede JOINs/relatórios corretos e quebra a navegação no UI.
--
-- Solução: coluna text `tipo_origem` com domínio {'produto','servico'}.
-- Linhas legadas migram automaticamente para 'produto' via DEFAULT.
-- =================================================================

BEGIN;

-- 1) Coluna tipo_origem (idempotente).
ALTER TABLE public.marketing_promocoes
  ADD COLUMN IF NOT EXISTS tipo_origem text NOT NULL DEFAULT 'produto';

-- 2) CHECK constraint para garantir o domínio. Aplica em INSERTs/UPDATEs
--    futuros — backfill já ficou ok via DEFAULT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.marketing_promocoes'::regclass
       AND conname = 'marketing_promocoes_tipo_origem_check'
  ) THEN
    ALTER TABLE public.marketing_promocoes
      ADD CONSTRAINT marketing_promocoes_tipo_origem_check
      CHECK (tipo_origem IN ('produto', 'servico'));
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Confirmar coluna + default + check:
--    \d+ marketing_promocoes
--
-- 2. INSERT com servico:
--    INSERT INTO marketing_promocoes
--      (tipo_origem, produto_id, nome_produto, preco_atual, preco_promocional, status)
--      VALUES ('servico', '<uuid-servico>', 'Instalação', 100, 80, 'Aguardando Aprovação');
--
-- 3. INSERT inválido (deve falhar com 23514):
--    INSERT INTO marketing_promocoes (tipo_origem, ...) VALUES ('xpto', ...);
-- =================================================================
