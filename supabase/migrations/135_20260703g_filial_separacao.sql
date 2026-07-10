-- Separação operacional por filial:
-- 1. Funcionários passam a ter coluna `filial` (antes inexistente).
-- 2. Promoções de Marketing ganham `filial` denormalizado do produto vinculado.

-- ── 1. funcionarios.filial ────────────────────────────────────────────────────
ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- Registros antigos sem filial já recebem 'SuperMax' pelo DEFAULT acima.

-- ── 2. marketing_promocoes.filial ─────────────────────────────────────────────
ALTER TABLE marketing_promocoes
  ADD COLUMN IF NOT EXISTS filial text;

-- Popula filial a partir do produto vinculado
UPDATE marketing_promocoes mp
SET filial = p.filial
FROM produtos p
WHERE mp.produto_id = p.id
  AND mp.filial IS NULL;

-- Promoções órfãs (produto deletado) ficam em SuperMax como fallback
UPDATE marketing_promocoes
SET filial = 'SuperMax'
WHERE filial IS NULL;
