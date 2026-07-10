-- =================================================================
-- Remove trigger duplicado em movimentacoes_estoque.
--
-- Diagnóstico em produção (2026-05-25) mostrou DOIS triggers
-- AFTER INSERT rodando em série em movimentacoes_estoque:
--   1. trg_atualiza_estoque → fn_atualiza_estoque_produto  (oficial,
--      em p0_fixes.sql e supabase/migrations/20260517_estoque_lock.sql)
--   2. trg_sync_estoque    → fn_sync_estoque_from_movimentacao
--      (fantasma — não existe em nenhuma migração do repo)
--
-- Causa real da duplicação de estoque: ambos somavam ao saldo a cada
-- INSERT, dobrando Entrada/Saída (recebimento de 250 un. virava +500).
--
-- Diferença semântica em 'Ajuste':
--   - oficial:  estoque += qtd     (ramo ELSE)
--   - fantasma: estoque  = qtd     (SET — sobrescrevia o oficial)
-- O codebase trata Ajuste como aditivo (seed_data.sql usa 'Ajuste,-5'),
-- então a semântica SET era bug acessório, não feature.
--
-- A migração 20260525_recebimento_idempotencia.sql (FK + UNIQUE parcial)
-- segue valendo como defesa em profundidade contra double-click e
-- dois operadores em paralelo.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_sync_estoque ON movimentacoes_estoque;
DROP FUNCTION IF EXISTS fn_sync_estoque_from_movimentacao();

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'movimentacoes_estoque'::regclass AND NOT tgisinternal;
--   -- esperado: SÓ trg_atualiza_estoque
-- =================================================================
