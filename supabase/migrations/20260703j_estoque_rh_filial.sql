-- =================================================================
-- Estoque (movimentacoes, vencimentos, inventarios, expedicao)
-- RH (ferias, folha_pagamento, afastamentos)
-- Adiciona coluna filial e propaga dados históricos a partir das
-- tabelas-pai (produto / funcionario).
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Colunas ──────────────────────────────────────────────────
ALTER TABLE public.movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.vencimentos_estoque
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.inventarios
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.expedicao
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.ferias
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.folha_pagamento
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.afastamentos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- ─── 2. Propagação histórica (estoque) ───────────────────────────
UPDATE public.movimentacoes_estoque me
SET filial = p.filial
FROM public.produtos p
WHERE me.produto_id = p.id
  AND me.filial = 'SuperMax';

UPDATE public.vencimentos_estoque ve
SET filial = p.filial
FROM public.produtos p
WHERE ve.produto_id = p.id
  AND ve.filial = 'SuperMax';

UPDATE public.inventarios inv
SET filial = p.filial
FROM public.produtos p
WHERE inv.produto_id = p.id
  AND inv.filial = 'SuperMax';

UPDATE public.expedicao ex
SET filial = p.filial
FROM public.produtos p
WHERE ex.produto_id = p.id
  AND ex.filial = 'SuperMax';

-- ─── 3. Propagação histórica (RH) ────────────────────────────────
UPDATE public.ferias f
SET filial = fn.filial
FROM public.funcionarios fn
WHERE f.funcionario_id = fn.id
  AND f.filial = 'SuperMax';

UPDATE public.folha_pagamento fp
SET filial = fn.filial
FROM public.funcionarios fn
WHERE fp.funcionario_id = fn.id
  AND fp.filial = 'SuperMax';

UPDATE public.afastamentos a
SET filial = fn.filial
FROM public.funcionarios fn
WHERE a.funcionario_id = fn.id
  AND a.filial = 'SuperMax';

COMMIT;
