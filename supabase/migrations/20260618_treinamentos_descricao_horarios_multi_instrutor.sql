-- =================================================================
-- LogMax — Treinamentos: descrição, horários, multi-instrutor
-- =================================================================
-- Refino do form de Treinamentos (RH):
--
--   1. `descricao` text                — contexto/pauta do treinamento.
--   2. `hora_inicio` / `hora_fim` time — horário das sessões.
--   3. `instrutores` text[]            — múltiplos instrutores (mantém
--                                        `instrutor` text legado pra
--                                        compat; nova UI grava só no array).
--
-- `vagas` permanece na tabela (legado), mas o form não escreve mais —
-- inscrição vira lista de funcionários selecionada na criação e o número
-- de inscritos sai da contagem em `treinamento_inscricoes`.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

ALTER TABLE treinamentos
  ADD COLUMN IF NOT EXISTS descricao   text,
  ADD COLUMN IF NOT EXISTS hora_inicio time,
  ADD COLUMN IF NOT EXISTS hora_fim    time,
  ADD COLUMN IF NOT EXISTS instrutores text[] NOT NULL DEFAULT '{}';

-- Backfill: se já existia treinamento com `instrutor` preenchido e
-- `instrutores` ainda vazio, replica o nome pro array pra UI antiga e
-- nova mostrarem a mesma coisa. Idempotente.
UPDATE treinamentos
   SET instrutores = ARRAY[instrutor]
 WHERE instrutor IS NOT NULL
   AND length(trim(instrutor)) > 0
   AND (instrutores IS NULL OR cardinality(instrutores) = 0);

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   \d treinamentos
--   SELECT id, nome, descricao, hora_inicio, hora_fim, instrutores
--     FROM treinamentos ORDER BY created_at DESC LIMIT 3;
-- =================================================================
