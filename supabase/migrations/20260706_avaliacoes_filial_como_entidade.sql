-- =================================================================
-- Avaliações: avaliar filiais como entidade (modo Matriz)
-- =================================================================
-- Contexto:
--   No modo Matriz (consolidado das 3 unidades), admin/CEO precisa
--   avaliar cada filial (SuperMax/MaxLook/TechMax) como uma entidade,
--   usando os mesmos 7 eixos (CRITERIOS_MATRIZ). Isso exige:
--     - avaliado_id nullable (filial não é um user)
--     - nova coluna avaliada_filial text
--     - tipo 'matriz_filial' aceito na tabela
--     - categoria 'criterios' aceita em criterios_avaliacao
--     - constraint UNIQUE separada para avaliações de filial
--     - RPC criar_avaliacao_filial (transacional)
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. avaliado_id → nullable ────────────────────────────────────
ALTER TABLE public.avaliacoes
  ALTER COLUMN avaliado_id DROP NOT NULL;

-- ── 2. Nova coluna avaliada_filial ───────────────────────────────
ALTER TABLE public.avaliacoes
  ADD COLUMN IF NOT EXISTS avaliada_filial text;

CREATE INDEX IF NOT EXISTS idx_avaliacoes_avaliada_filial
  ON public.avaliacoes (avaliada_filial)
  WHERE avaliada_filial IS NOT NULL;

-- ── 3. Atualiza constraints ──────────────────────────────────────

-- Tipo: inclui 'matriz_filial'
ALTER TABLE public.avaliacoes
  DROP CONSTRAINT IF EXISTS chk_aval_tipo;
ALTER TABLE public.avaliacoes
  ADD CONSTRAINT chk_aval_tipo
  CHECK (tipo IN ('ceo_gerente', 'gerente_colaborador', 'feedback_colaborador', 'ti_dev_ia', 'matriz_filial'));

-- Distinct: só aplica quando há avaliado_id (filial eval não tem avaliado_id)
ALTER TABLE public.avaliacoes
  DROP CONSTRAINT IF EXISTS chk_aval_distinct;
ALTER TABLE public.avaliacoes
  ADD CONSTRAINT chk_aval_distinct
  CHECK (avaliado_id IS NULL OR avaliador_id <> avaliado_id);

-- Integridade: toda linha precisa de avaliado_id OU avaliada_filial
ALTER TABLE public.avaliacoes
  DROP CONSTRAINT IF EXISTS chk_aval_avaliado_or_filial;
ALTER TABLE public.avaliacoes
  ADD CONSTRAINT chk_aval_avaliado_or_filial
  CHECK (avaliado_id IS NOT NULL OR avaliada_filial IS NOT NULL);

-- Filiais válidas
ALTER TABLE public.avaliacoes
  DROP CONSTRAINT IF EXISTS chk_aval_filial_opcoes;
ALTER TABLE public.avaliacoes
  ADD CONSTRAINT chk_aval_filial_opcoes
  CHECK (avaliada_filial IS NULL OR avaliada_filial IN ('SuperMax', 'MaxLook', 'TechMax'));

-- UNIQUE: a constraint original não aceita NULL em avaliado_id;
-- recria como dois índices parciais separados.
ALTER TABLE public.avaliacoes
  DROP CONSTRAINT IF EXISTS unq_avaliacao;

CREATE UNIQUE INDEX IF NOT EXISTS unq_avaliacao
  ON public.avaliacoes (ciclo_id, avaliador_id, avaliado_id, tipo)
  WHERE avaliado_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unq_avaliacao_filial
  ON public.avaliacoes (ciclo_id, avaliador_id, avaliada_filial)
  WHERE avaliada_filial IS NOT NULL;

-- ── 4. criterios_avaliacao: aceita categoria 'criterios' ─────────
ALTER TABLE public.criterios_avaliacao
  DROP CONSTRAINT IF EXISTS chk_crit_categoria;
ALTER TABLE public.criterios_avaliacao
  ADD CONSTRAINT chk_crit_categoria
  CHECK (categoria IN ('tecnica', 'comportamental', 'socioemocional', 'criterios'));

-- ── 5. Ciclos: aceita filial 'Matriz' ────────────────────────────
-- ciclos_avaliacao.filial não tem CHECK constraint (migração 20260704c
-- só adiciona NOT NULL DEFAULT). Nenhuma alteração necessária; 'Matriz'
-- passa como valor livre. Apenas documentado aqui.

-- ── 6. RPC criar_avaliacao_filial ────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_avaliacao_filial(
  p_ciclo_id        uuid,
  p_avaliada_filial text,
  p_observacao      text,
  p_criterios       jsonb   -- [{categoria, criterio, nota}, ...]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_avaliacao_id uuid;
  v_criterio     jsonb;
  v_ciclo_status text;
BEGIN
  -- Valida filial
  IF p_avaliada_filial NOT IN ('SuperMax', 'MaxLook', 'TechMax') THEN
    RAISE EXCEPTION 'Filial inválida: %', p_avaliada_filial;
  END IF;

  -- Bloqueia ciclo fechado
  SELECT status INTO v_ciclo_status
    FROM ciclos_avaliacao WHERE id = p_ciclo_id;
  IF v_ciclo_status IS NULL THEN
    RAISE EXCEPTION 'Ciclo não encontrado';
  END IF;
  IF v_ciclo_status <> 'Aberto' THEN
    RAISE EXCEPTION 'Ciclo fechado — não aceita novas avaliações';
  END IF;

  INSERT INTO avaliacoes (ciclo_id, avaliador_id, avaliado_id, avaliada_filial, tipo, observacao)
  VALUES (p_ciclo_id, auth.uid(), NULL, p_avaliada_filial, 'matriz_filial', p_observacao)
  RETURNING id INTO v_avaliacao_id;

  FOR v_criterio IN SELECT * FROM jsonb_array_elements(p_criterios) LOOP
    INSERT INTO criterios_avaliacao (avaliacao_id, categoria, criterio, nota)
    VALUES (
      v_avaliacao_id,
      v_criterio->>'categoria',
      v_criterio->>'criterio',
      (v_criterio->>'nota')::smallint
    );
  END LOOP;

  RETURN v_avaliacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_avaliacao_filial(uuid, text, text, jsonb) TO authenticated;

COMMIT;
