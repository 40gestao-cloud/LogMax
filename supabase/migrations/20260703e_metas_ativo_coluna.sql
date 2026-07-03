-- Coluna ativo ausente em metas_estrategicas na instância atual.
-- Todas as RPCs usam COALESCE(ativo,true) e falham com "column does not exist".
ALTER TABLE public.metas_estrategicas
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
