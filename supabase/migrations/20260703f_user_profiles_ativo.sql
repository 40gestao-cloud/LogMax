-- user_profiles não tinha coluna ativo; RPCs de metas e outras usam
-- COALESCE(ativo, true) = true nessa tabela, causando "column does not exist".
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
