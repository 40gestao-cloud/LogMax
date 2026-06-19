-- =================================================================
-- Avaliações — renomear critérios + escala 0-10
-- =================================================================
-- Refino do módulo:
--   Comportamentais:
--     • Iniciativa            → Proatividade
--     • Colaboração           → Trabalho em Equipe
--     • (novo)                  Apresentação Profissional
--   Socioemocionais:
--     • Comunicação           → Comunicação Assertiva
--     • Resiliência           → Autogestão e Disciplina
--   Escala: 1-5 → 0-10
--
-- 1-5 ⊆ 0-10, então a constraint nova aceita o histórico sem perda.
-- Critérios são gravados como TEXT em `criterios_avaliacao.criterio`,
-- logo o rename é um UPDATE simples (sem migração de enum).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Rename de critérios históricos
-- ─────────────────────────────────────────────
UPDATE criterios_avaliacao SET criterio = 'Proatividade'
 WHERE categoria = 'comportamental' AND criterio = 'Iniciativa';

UPDATE criterios_avaliacao SET criterio = 'Trabalho em Equipe'
 WHERE categoria = 'comportamental' AND criterio = 'Colaboração';

UPDATE criterios_avaliacao SET criterio = 'Comunicação Assertiva'
 WHERE categoria = 'socioemocional' AND criterio = 'Comunicação';

UPDATE criterios_avaliacao SET criterio = 'Autogestão e Disciplina'
 WHERE categoria = 'socioemocional' AND criterio = 'Resiliência';

-- ─────────────────────────────────────────────
-- 2. Escala 0-10
-- ─────────────────────────────────────────────
ALTER TABLE criterios_avaliacao
  DROP CONSTRAINT IF EXISTS chk_crit_nota;

ALTER TABLE criterios_avaliacao
  ADD CONSTRAINT chk_crit_nota CHECK (nota BETWEEN 0 AND 10);

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT DISTINCT categoria, criterio FROM criterios_avaliacao
--    WHERE categoria IN ('comportamental','socioemocional')
--    ORDER BY categoria, criterio;
--   -- Tentar inserir nota inválida deve falhar:
--   --   INSERT INTO criterios_avaliacao (avaliacao_id, categoria, criterio, nota)
--   --     VALUES (..., 'tecnica', 'Domínio técnico', 11);  -- ERROR
-- =================================================================
