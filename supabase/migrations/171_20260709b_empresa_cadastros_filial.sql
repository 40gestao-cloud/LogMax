-- =================================================================
-- LogMax — Módulo Empresa: cadastros por filial
-- =================================================================
-- Contexto: Categorias já tinha coluna `filial` (20260703b) mas RLS de
-- escrita ainda restringia a admin/ceo/gerente e não isolava por
-- unidade. Projetos/Condições de Pagamento/Mapeamentos de Rateio/
-- Formas de Pagamento eram 100% globais (sem coluna `filial`).
--
-- Esta migration:
--   1. Adiciona `filial` (+ backfill + índice) nas 4 tabelas que ainda
--      não tinham; backfilla NULLs de categorias_produto também.
--   2. Reescreve RLS das 5 tabelas: leitura e escrita liberadas pra
--      qualquer colaborador autenticado, restritas à própria filial
--      via `auth_pode_filial(filial)` — admin/CEO/conselheiro (e Matriz
--      no front) enxergam/gravam em qualquer unidade.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Colunas + backfill + índice ────────────────────────────────
ALTER TABLE public.projetos
  ADD COLUMN IF NOT EXISTS filial text;
UPDATE public.projetos SET filial = 'SuperMax' WHERE filial IS NULL;
ALTER TABLE public.projetos
  ALTER COLUMN filial SET DEFAULT 'SuperMax',
  ALTER COLUMN filial SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projetos_filial ON public.projetos (filial);

ALTER TABLE public.condicoes_pagamento
  ADD COLUMN IF NOT EXISTS filial text;
UPDATE public.condicoes_pagamento SET filial = 'SuperMax' WHERE filial IS NULL;
ALTER TABLE public.condicoes_pagamento
  ALTER COLUMN filial SET DEFAULT 'SuperMax',
  ALTER COLUMN filial SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_condicoes_pagamento_filial ON public.condicoes_pagamento (filial);

ALTER TABLE public.mapeamentos_rateio
  ADD COLUMN IF NOT EXISTS filial text;
UPDATE public.mapeamentos_rateio SET filial = 'SuperMax' WHERE filial IS NULL;
ALTER TABLE public.mapeamentos_rateio
  ALTER COLUMN filial SET DEFAULT 'SuperMax',
  ALTER COLUMN filial SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mapeamentos_rateio_filial ON public.mapeamentos_rateio (filial);

ALTER TABLE public.formas_pagamento
  ADD COLUMN IF NOT EXISTS filial text;
UPDATE public.formas_pagamento SET filial = 'SuperMax' WHERE filial IS NULL;
ALTER TABLE public.formas_pagamento
  ALTER COLUMN filial SET DEFAULT 'SuperMax',
  ALTER COLUMN filial SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_formas_pagamento_filial ON public.formas_pagamento (filial);

-- categorias_produto.filial já existe (20260703b) mas ficou nullable e
-- sem backfill — fecha o mesmo padrão das outras 4.
UPDATE public.categorias_produto SET filial = 'SuperMax' WHERE filial IS NULL;
ALTER TABLE public.categorias_produto
  ALTER COLUMN filial SET DEFAULT 'SuperMax',
  ALTER COLUMN filial SET NOT NULL;

-- ─── 2. RLS — qualquer colaborador autenticado, restrito à própria filial ──
DROP POLICY IF EXISTS "read_authenticated" ON public.projetos;
DROP POLICY IF EXISTS "write_admin"        ON public.projetos;
CREATE POLICY "projetos_select" ON public.projetos FOR SELECT TO authenticated USING (auth_pode_filial(filial));
CREATE POLICY "projetos_write"  ON public.projetos FOR ALL    TO authenticated
  USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));

DROP POLICY IF EXISTS "read_authenticated" ON public.condicoes_pagamento;
DROP POLICY IF EXISTS "write_financ"       ON public.condicoes_pagamento;
CREATE POLICY "condicoes_pagamento_select" ON public.condicoes_pagamento FOR SELECT TO authenticated USING (auth_pode_filial(filial));
CREATE POLICY "condicoes_pagamento_write"  ON public.condicoes_pagamento FOR ALL    TO authenticated
  USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));

DROP POLICY IF EXISTS "read_authenticated" ON public.mapeamentos_rateio;
DROP POLICY IF EXISTS "write_financ"       ON public.mapeamentos_rateio;
CREATE POLICY "mapeamentos_rateio_select" ON public.mapeamentos_rateio FOR SELECT TO authenticated USING (auth_pode_filial(filial));
CREATE POLICY "mapeamentos_rateio_write"  ON public.mapeamentos_rateio FOR ALL    TO authenticated
  USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));

DROP POLICY IF EXISTS "read_authenticated" ON public.formas_pagamento;
DROP POLICY IF EXISTS "write_financ"       ON public.formas_pagamento;
CREATE POLICY "formas_pagamento_select" ON public.formas_pagamento FOR SELECT TO authenticated USING (auth_pode_filial(filial));
CREATE POLICY "formas_pagamento_write"  ON public.formas_pagamento FOR ALL    TO authenticated
  USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));

-- categorias_produto: mesma liberação (antes só admin/ceo/gerente criavam/editavam).
DROP POLICY IF EXISTS "categorias_produto_select" ON public.categorias_produto;
DROP POLICY IF EXISTS "categorias_produto_insert" ON public.categorias_produto;
DROP POLICY IF EXISTS "categorias_produto_update" ON public.categorias_produto;
DROP POLICY IF EXISTS "categorias_produto_delete" ON public.categorias_produto;
CREATE POLICY "categorias_produto_select" ON public.categorias_produto FOR SELECT TO authenticated USING (auth_pode_filial(filial));
CREATE POLICY "categorias_produto_write"  ON public.categorias_produto FOR ALL    TO authenticated
  USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));

-- subcategorias_produto: filho de categorias_produto (herda a filial via
-- categoria_id), UI já libera pra qualquer colaborador — RLS acompanha.
DROP POLICY IF EXISTS "subcategorias_select" ON public.subcategorias_produto;
DROP POLICY IF EXISTS "subcategorias_insert" ON public.subcategorias_produto;
DROP POLICY IF EXISTS "subcategorias_update" ON public.subcategorias_produto;
DROP POLICY IF EXISTS "subcategorias_delete" ON public.subcategorias_produto;
CREATE POLICY "subcategorias_select" ON public.subcategorias_produto FOR SELECT TO authenticated USING (true);
CREATE POLICY "subcategorias_write"  ON public.subcategorias_produto FOR ALL    TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.categorias_produto c WHERE c.id = subcategorias_produto.categoria_id AND auth_pode_filial(c.filial))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.categorias_produto c WHERE c.id = subcategorias_produto.categoria_id AND auth_pode_filial(c.filial))
  );

COMMIT;
