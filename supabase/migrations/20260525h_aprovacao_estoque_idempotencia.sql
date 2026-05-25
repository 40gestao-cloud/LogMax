-- =================================================================
-- Idempotência da Aprovação de Estoque → Movimentação de Saída.
--
-- AprovacoesEstoqueView.handleAprovar tinha o mesmo anti-padrão do
-- recebimento (commit b952609 corrigiu lá): `if (processing) return`
-- baseado em state React assíncrono. Double-click rápido entra 2× no
-- handler antes do re-render, gerando 2 INSERTs de Saída e duplicando
-- o decremento do estoque.
--
-- Esta migração fecha o vazamento no banco — mesmo se o cliente
-- estiver desatualizado ou dois operadores aprovarem em paralelo,
-- cada requisição_estoque gera no máximo UMA movimentação ativa.
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS requisicao_estoque_id uuid
  REFERENCES requisicoes_estoque(id) ON DELETE SET NULL;

-- UNIQUE parcial (padrão de feedback_partial_unique_soft_delete):
--   - WHERE requisicao_estoque_id IS NOT NULL → não afeta linhas legadas
--     nem outras origens (PDV, recebimento, saldo inicial)
--   - WHERE ativo = true → permite re-INSERT se o movimento anterior
--     for inativado em correção administrativa
CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_estoque_por_requisicao_estoque
  ON movimentacoes_estoque (requisicao_estoque_id)
  WHERE requisicao_estoque_id IS NOT NULL AND ativo = true;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- após aprovar uma requisição com qtd=10, double-click no botão:
--   SELECT count(*) FROM movimentacoes_estoque
--    WHERE requisicao_estoque_id = '<id>' AND ativo = true;
--   -- esperado: 1 (com o fix). Antes do fix: 2 → estoque dobrava o decremento.
-- =================================================================
