-- =================================================================
-- Idempotência do Recebimento → Movimentação de Estoque.
--
-- Bug reportado (2026-05-25): produto com estoque 2 recebeu pedido
-- de 250 un. e o saldo virou 502 (esperado 252). A causa-raiz mais
-- provável é race condition no botão "Confirmar" do RecebimentosView:
-- o `disabled={confirmSaving}` depende de state React (assíncrono),
-- então um double-click rápido dispara `handleConfirmar` 2× antes do
-- botão ser pintado como desabilitado. Cada chamada insere uma linha
-- em `movimentacoes_estoque`, o trigger `trg_atualiza_estoque` aplica
-- `+qtd` duas vezes.
--
-- Esta migração fecha o vazamento no banco — independente de double-
-- click, dois operadores em paralelo, ou trigger duplicado: um
-- recebimento gera, no máximo, UMA movimentação ativa.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- 1. FK opcional: liga a movimentação ao recebimento que a originou.
--    NULL para movimentos legados ou de outras origens (PDV, requisição
--    de estoque, saldo inicial), que não passam por essa via.
ALTER TABLE movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS recebimento_id uuid
  REFERENCES recebimentos(id) ON DELETE SET NULL;

-- 2. UNIQUE parcial:
--    - WHERE recebimento_id IS NOT NULL → não impacta linhas legadas / outras origens.
--    - WHERE ativo = true → padrão documentado em feedback_partial_unique_soft_delete.
--      Permite re-inserir caso o movimento anterior seja inativado
--      (correção administrativa via soft-delete em GerenciamentoEstoque).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_estoque_por_recebimento
  ON movimentacoes_estoque (recebimento_id)
  WHERE recebimento_id IS NOT NULL AND ativo = true;

COMMIT;

-- =================================================================
-- DIAGNÓSTICO (rodar antes/depois para verificar a causa-raiz):
--
--   -- Triggers em movimentacoes_estoque (esperado: 1)
--   SELECT tgname, proname AS function
--     FROM pg_trigger t JOIN pg_proc p ON t.tgfoid = p.oid
--    WHERE tgrelid = 'movimentacoes_estoque'::regclass AND NOT tgisinternal;
--
--   -- Histórico do produto com saldo duplicado
--   SELECT id, tipo, qtd, origem, created_at, recebimento_id
--     FROM movimentacoes_estoque
--    WHERE produto_id = '<UUID-DO-PRODUTO>'
--    ORDER BY created_at DESC LIMIT 20;
--
-- CORREÇÃO PONTUAL (se o saldo já estourou):
--   INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data)
--   VALUES ('<UUID>', 'Saída', 250, 'Ajuste', 'Correção duplicação recebimento', CURRENT_DATE);
-- =================================================================
