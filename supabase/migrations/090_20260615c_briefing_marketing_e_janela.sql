-- ============================================================================
-- Briefing Diário: janela configurável (7/15/30 dias) + inclusão de Marketing
-- ============================================================================
-- Duas mudanças no Briefing Diário (2026-06-15):
--
-- 1. JANELA CONFIGURÁVEL
--    Antes: snapshot do BI era fixo em 7 dias. Agora admin/CEO escolhe entre
--    7, 15 ou 30 dias na própria tela. `briefings_diarios.janela_dias`
--    persiste o valor escolhido — necessário pro cache lookup (sem isso,
--    pedir 30 dias devolve briefing cacheado de 7).
--
-- 2. MARKETING NA PAUTA
--    Marketing tem fluxo próprio (`marketing_tarefas` com status "Em Produção",
--    "Postado", "Aprovação de Link"). Pra incluir no briefing sem quebrar
--    esse fluxo, `marketing_tarefas` ganha as mesmas colunas que `tarefas`:
--    origem ('manual' | 'briefing_ia'), briefing_id, contexto. O handler
--    aprovarSelecionadas no client roteia: modulo='marketing' → INSERT em
--    marketing_tarefas; demais setores → INSERT em tarefas (caminho antigo).
--
-- Idempotente. Execute no Supabase SQL Editor.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. briefings_diarios.janela_dias
-- ─────────────────────────────────────────────

ALTER TABLE briefings_diarios
  ADD COLUMN IF NOT EXISTS janela_dias integer NOT NULL DEFAULT 7;

-- CHECK separado pra ser idempotente e fácil de evoluir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'briefings_diarios'::regclass
       AND conname  = 'chk_briefings_janela'
  ) THEN
    ALTER TABLE briefings_diarios
      ADD CONSTRAINT chk_briefings_janela CHECK (janela_dias IN (7, 15, 30));
  END IF;
END $$;

-- UNIQUE parcial expande de (data) pra (data, janela_dias) — permite 1
-- briefing ATIVO por combinação data × janela. Antes só 1 por data; agora
-- admin pode ter um briefing de 7d E um de 30d pra mesma data em paralelo.
DROP INDEX IF EXISTS uq_briefings_data_ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_briefings_data_janela_ativo
  ON briefings_diarios (data_referencia, janela_dias)
  WHERE ativo = true AND status <> 'descartado';

-- ─────────────────────────────────────────────
-- 2. marketing_tarefas ganha origem / briefing_id / contexto
-- ─────────────────────────────────────────────
-- Espelha as colunas que `tarefas` ganhou em 20260614e_briefing_diario.sql.
-- Marketing_tarefas não tem `modulo` (toda linha é implicitamente marketing),
-- então só precisa rastrear origem + ref ao briefing.

ALTER TABLE marketing_tarefas
  ADD COLUMN IF NOT EXISTS origem      text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS briefing_id uuid REFERENCES briefings_diarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contexto    text;

-- CHECK origem só uma vez (mesmo padrão do tarefas).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'marketing_tarefas'::regclass
       AND conname  = 'chk_marketing_tarefas_origem'
  ) THEN
    ALTER TABLE marketing_tarefas
      ADD CONSTRAINT chk_marketing_tarefas_origem CHECK (origem IN ('manual','briefing_ia'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mkt_tarefas_briefing ON marketing_tarefas(briefing_id) WHERE briefing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mkt_tarefas_origem   ON marketing_tarefas(origem) WHERE origem = 'briefing_ia';

-- Backfill defensivo.
UPDATE marketing_tarefas SET origem = 'manual' WHERE origem IS NULL;

COMMIT;

-- ============================================================================
-- VERIFICAÇÃO
--   SELECT janela_dias, count(*) FROM briefings_diarios GROUP BY janela_dias;
--   SELECT origem, count(*) FROM marketing_tarefas GROUP BY origem;
-- ============================================================================
