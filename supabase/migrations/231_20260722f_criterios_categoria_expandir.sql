-- =================================================================
-- criterios_avaliacao.chk_crit_categoria — ampliar whitelist
--
-- Contexto:
--   O frontend usa como `categoria` a CHAVE do set de critérios
--   definido em `src/lib/avaliacaoCriterios.ts`:
--     • 'desempenho'  → gerente→colab, CEO→gerente/colab/conselheiro
--     • 'criterios'   → matriz→filial (7 eixos)
--     • 'estrategico' → admin→CEO / admin→conselheiro (migr. 230)
--
--   A constraint ainda listava só os rótulos históricos
--   ('tecnica','comportamental','socioemocional') + 'criterios',
--   então qualquer avaliação que não fosse matriz_filial (e o
--   histórico legado) explodia com
--     new row for relation "criterios_avaliacao" violates
--     check constraint "chk_crit_categoria"
--
-- Correção: recria a constraint incluindo 'desempenho' e
-- 'estrategico'. Rótulos legados mantidos pra não quebrar linhas
-- antigas.
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.criterios_avaliacao
  DROP CONSTRAINT IF EXISTS chk_crit_categoria;

ALTER TABLE public.criterios_avaliacao
  ADD CONSTRAINT chk_crit_categoria
  CHECK (categoria IN (
    'tecnica',
    'comportamental',
    'socioemocional',
    'criterios',
    'desempenho',
    'estrategico'
  ));

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint WHERE conname = 'chk_crit_categoria';
-- =================================================================
