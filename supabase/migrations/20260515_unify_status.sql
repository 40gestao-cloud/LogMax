-- Migração 2026-05-15
-- Unifica género dos status (#15) + adiciona snapshot ao pedido (#20)
--
-- Correr no Supabase SQL Editor. É idempotente (safe to re-run).
-- Sem isto, as Views React deixarão de ver requisições/cotações/férias
-- antigas que ainda tenham 'Aprovada' / 'Negada' na BD.

-- 1) Unificação de status (Aprovada/Negada → Aprovado/Negado)
UPDATE requisicoes          SET status = 'Aprovado' WHERE status = 'Aprovada';
UPDATE requisicoes          SET status = 'Negado'   WHERE status = 'Negada';
UPDATE requisicoes_estoque  SET status = 'Aprovado' WHERE status = 'Aprovada';
UPDATE requisicoes_estoque  SET status = 'Negado'   WHERE status = 'Negada';
UPDATE ferias               SET status = 'Aprovado' WHERE status = 'Aprovada';
UPDATE ferias               SET status = 'Negado'   WHERE status = 'Negada';

-- 2) Snapshot do item no pedido (preserva descrição/qtd se a requisição mudar)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS item_descricao TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS item_qtd       INTEGER;
