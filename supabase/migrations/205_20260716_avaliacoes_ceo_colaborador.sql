-- =================================================================
-- Avaliações: novos tipos `ceo_colaborador` e `ceo_conselheiro` para modo Matriz.
--
-- Contexto:
--   No modo Matriz (admin/CEO em holding view) já era possível
--   avaliar gerentes de todas as filiais (tipo `ceo_gerente`),
--   mas colaboradores e conselheiros ficavam fora. Para a
--   competição inter-filiais, o CEO precisa tocar diretamente
--   em colaboradores (por filial) e no Conselho (global).
--
-- Mudança:
--   Amplia CHECK constraint `chk_aval_tipo` para incluir
--   `ceo_colaborador` e `ceo_conselheiro`. RLS e demais RPCs
--   são agnósticas ao tipo, então nada mais muda no banco.
--   Conselheiros são avaliados dentro do ciclo Matriz (que já
--   existe pra avaliar filial-como-entidade).
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
    'ceo_conselheiro',
    'gerente_colaborador',
    'feedback_colaborador',
    'ti_dev_ia',
    'matriz_filial'
  ));

COMMIT;
