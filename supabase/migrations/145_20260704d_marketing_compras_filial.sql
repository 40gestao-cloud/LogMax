-- Filial em tabelas de Marketing (campanhas/cupons) e Compras (notas_recebidas).
-- departamentos e cargos ganham filial opcional para separar org. por empresa.

-- ── 1. marketing_campanhas.filial ────────────────────────────────────────────

ALTER TABLE public.marketing_campanhas
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_marketing_campanhas_filial
  ON public.marketing_campanhas (filial);

-- ── 2. marketing_cupons.filial ────────────────────────────────────────────────

ALTER TABLE public.marketing_cupons
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_marketing_cupons_filial
  ON public.marketing_cupons (filial);

-- ── 3. notas_recebidas.filial ─────────────────────────────────────────────────

ALTER TABLE public.notas_recebidas
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_notas_recebidas_filial
  ON public.notas_recebidas (filial);

-- ── 4. departamentos.filial ───────────────────────────────────────────────────
-- Cada empresa tem sua própria estrutura departamental.

ALTER TABLE public.departamentos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_departamentos_filial
  ON public.departamentos (filial);

-- ── 5. cargos.filial ──────────────────────────────────────────────────────────
-- Cargos e faixas salariais são específicos de cada empresa.

ALTER TABLE public.cargos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_cargos_filial
  ON public.cargos (filial);
