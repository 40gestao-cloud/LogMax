-- =================================================================
-- LogMax — Briefing Diário com IA (Pauta do Dia)
-- =================================================================
-- Cria infraestrutura pro Admin/CEO solicitar à IA um briefing de
-- tarefas reais baseadas no estado atual do ERP. Fluxo:
--
--   1. Admin clica "Gerar Briefing" → endpoint chama gerar_painel_bi
--      pra ter snapshot do dia; envia pro Gemini que devolve um array
--      de tarefas propostas por setor.
--   2. Briefing nasce em status 'rascunho_ia' — admin revisa, edita,
--      descarta e aprova individualmente (checkbox por tarefa).
--   3. Aprovação em lote insere as tarefas selecionadas em `tarefas`
--      com origem='briefing_ia' e briefing_id apontando pra origem.
--      O submenu "Tarefas" de cada setor passa a mostrar a pauta.
--
-- Escopo dos módulos: empresa, compras, estoque, financeiro, rh,
-- vendas — os 6 que usam a tabela genérica `tarefas`. Marketing fica
-- fora (tem fluxo próprio rico: Promoções/Campanhas/Cupons/Calendário).
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabela briefings_diarios
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS briefings_diarios (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  data_referencia   date        NOT NULL,
  -- Status do briefing como unidade:
  --   rascunho_ia       → gerado mas ainda não aprovado
  --   aprovado_parcial  → algumas tarefas aprovadas, restantes descartadas
  --   aprovado_total    → todas aprovadas
  --   descartado        → admin recusou tudo
  status            text        NOT NULL DEFAULT 'rascunho_ia'
    CHECK (status IN ('rascunho_ia','aprovado_parcial','aprovado_total','descartado')),
  -- Snapshot da agregação que alimentou o prompt — usado pra auditoria
  -- e pra futura comparação ("o que mudou desde aquele briefing?").
  dados_snapshot    jsonb       NOT NULL,
  -- Array de tarefas propostas. Cada item tem
  --   { modulo, titulo, descricao, prioridade, prazo, contexto_origem }
  -- E flags adicionadas durante a revisão:
  --   { aprovada (bool), descartada (bool), editada (bool) }
  tarefas_propostas jsonb       NOT NULL,
  total_propostas   integer     NOT NULL DEFAULT 0,
  total_aprovadas   integer     NOT NULL DEFAULT 0,
  gerado_por        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_gerador      text,
  aprovado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_aprovador    text,
  observacao        text,
  modelo_ia         text,
  ativo             boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Um briefing ATIVO por data — admin descarta antes de gerar outro.
-- Segue o padrão [[feedback_partial_unique_soft_delete]].
CREATE UNIQUE INDEX IF NOT EXISTS uq_briefings_data_ativo
  ON briefings_diarios (data_referencia)
  WHERE ativo = true AND status <> 'descartado';

CREATE INDEX IF NOT EXISTS idx_briefings_data       ON briefings_diarios(data_referencia DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_status     ON briefings_diarios(status) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_briefings_gerado_por ON briefings_diarios(gerado_por, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_created_at ON briefings_diarios(created_at DESC);

CREATE OR REPLACE FUNCTION trg_briefings_diarios_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS briefings_diarios_updated_at ON briefings_diarios;
CREATE TRIGGER briefings_diarios_updated_at
  BEFORE UPDATE ON briefings_diarios
  FOR EACH ROW EXECUTE FUNCTION trg_briefings_diarios_updated_at();

ALTER TABLE briefings_diarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefings_read"   ON briefings_diarios;
DROP POLICY IF EXISTS "briefings_insert" ON briefings_diarios;
DROP POLICY IF EXISTS "briefings_update" ON briefings_diarios;
DROP POLICY IF EXISTS "briefings_delete" ON briefings_diarios;

-- Read: todos autenticados (colaborador vê de onde veio a tarefa dele).
CREATE POLICY "briefings_read" ON briefings_diarios
  FOR SELECT TO authenticated USING (true);

-- Insert/Update/Delete: só admin/CEO.
CREATE POLICY "briefings_insert" ON briefings_diarios
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin());

CREATE POLICY "briefings_update" ON briefings_diarios
  FOR UPDATE TO authenticated
  USING (auth_is_admin())
  WITH CHECK (auth_is_admin());

CREATE POLICY "briefings_delete" ON briefings_diarios
  FOR DELETE TO authenticated
  USING (auth_is_admin());

-- ─────────────────────────────────────────────
-- 2. Tarefas ganha origem + briefing_id
-- ─────────────────────────────────────────────

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS origem      text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS briefing_id uuid REFERENCES briefings_diarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contexto    text;

-- CHECK pode existir já (de migrações anteriores) — só recria sem quebrar
-- se valores fora do permitido aparecerem.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'tarefas'::regclass
       AND conname  = 'chk_tarefas_origem'
  ) THEN
    ALTER TABLE tarefas
      ADD CONSTRAINT chk_tarefas_origem CHECK (origem IN ('manual','briefing_ia'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tarefas_briefing ON tarefas(briefing_id) WHERE briefing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_origem   ON tarefas(origem) WHERE origem = 'briefing_ia';

-- Backfill defensivo: linhas existentes ficam como 'manual'. NULL → 'manual'.
UPDATE tarefas SET origem = 'manual' WHERE origem IS NULL;

-- ─────────────────────────────────────────────
-- 3. Realtime publication
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'briefings_diarios'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE briefings_diarios;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT count(*) FROM briefings_diarios;
--   SELECT origem, count(*) FROM tarefas GROUP BY origem;
-- =================================================================
