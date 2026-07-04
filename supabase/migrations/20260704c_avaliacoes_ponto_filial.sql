-- Separação por filial: avaliações e ponto eletrônico
-- Aplica filial em ciclos_avaliacao, avaliacoes e ponto_eletronico.
-- Triggers propagam filial automaticamente — sem mudar os RPCs existentes.

-- ── 1. ciclos_avaliacao.filial ───────────────────────────────────────────────

ALTER TABLE public.ciclos_avaliacao
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_ciclos_avaliacao_filial
  ON public.ciclos_avaliacao (filial);

-- ── 2. avaliacoes.filial (herdado do ciclo via trigger) ──────────────────────

ALTER TABLE public.avaliacoes
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_avaliacoes_filial
  ON public.avaliacoes (filial);

-- Trigger: ao inserir avaliação, herda filial do ciclo ao qual pertence.
CREATE OR REPLACE FUNCTION public.fn_avaliacoes_filial_from_ciclo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.filial := COALESCE(
    (SELECT filial FROM public.ciclos_avaliacao WHERE id = NEW.ciclo_id),
    'SuperMax'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_avaliacoes_filial ON public.avaliacoes;
CREATE TRIGGER trg_avaliacoes_filial
  BEFORE INSERT ON public.avaliacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_avaliacoes_filial_from_ciclo();

-- Backfill: sincroniza avaliacoes existentes com a filial do ciclo.
UPDATE public.avaliacoes av
SET filial = c.filial
FROM public.ciclos_avaliacao c
WHERE av.ciclo_id = c.id
  AND av.filial IS DISTINCT FROM c.filial;

-- ── 3. ponto_eletronico.filial (herdado do funcionário via trigger) ──────────

ALTER TABLE public.ponto_eletronico
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_ponto_eletronico_filial
  ON public.ponto_eletronico (filial);

-- Trigger: ao inserir registro de ponto, herda filial do funcionário.
CREATE OR REPLACE FUNCTION public.fn_ponto_filial_from_funcionario()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.filial := COALESCE(
    (SELECT filial FROM public.funcionarios WHERE id = NEW.funcionario_id),
    'SuperMax'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ponto_filial ON public.ponto_eletronico;
CREATE TRIGGER trg_ponto_filial
  BEFORE INSERT ON public.ponto_eletronico
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ponto_filial_from_funcionario();

-- Backfill: sincroniza registros existentes com a filial do funcionário.
UPDATE public.ponto_eletronico pe
SET filial = f.filial
FROM public.funcionarios f
WHERE pe.funcionario_id = f.id
  AND pe.filial IS DISTINCT FROM f.filial;
