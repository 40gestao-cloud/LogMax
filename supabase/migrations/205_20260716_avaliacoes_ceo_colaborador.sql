-- =================================================================
-- Avaliações: novo tipo `ceo_colaborador` para modo Matriz.
--
-- Contexto:
--   No modo Matriz (admin/CEO em holding view) já era possível
--   avaliar gerentes de todas as filiais (tipo `ceo_gerente`),
--   mas colaboradores ficavam fora — no dia-a-dia quem os avalia
--   é o gerente do setor (tipo `gerente_colaborador`). Para o
--   modelo de competição inter-filiais, o CEO precisa poder tocar
--   diretamente em colaboradores também, agrupados por filial.
--
-- Mudança:
--   Amplia CHECK constraint `chk_aval_tipo` para incluir
--   `ceo_colaborador`. RLS e demais RPCs são agnósticas ao tipo,
--   então nada mais muda no banco.
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.avaliacoes DROP CONSTRAINT IF EXISTS chk_aval_tipo;

ALTER TABLE public.avaliacoes
  ADD CONSTRAINT chk_aval_tipo
  CHECK (tipo IN (
    'ceo_gerente',
    'ceo_colaborador',
    'gerente_colaborador',
    'feedback_colaborador',
    'ti_dev_ia',
    'matriz_filial'
  ));

COMMIT;
