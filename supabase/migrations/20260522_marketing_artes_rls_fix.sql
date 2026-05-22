-- =================================================================
-- LogMax — Fix: gallery de artes vazia em outros setores
-- =================================================================
-- Sintoma reportado (22/05/2026):
--   Marketing publica e dispara notificar_setor('all'). Notificação
--   chega aos outros setores, mas ao abrir /artes-promocionais aparece
--   "Nenhuma arte publicada ainda".
--
-- Diagnóstico real (RLS não era a causa — polqual de artes_read já é
-- 'true' em produção):
--   O hook useFetchData faz `order('created_at', ...)` hard-coded para
--   toda tabela. A `marketing_artes` foi criada com `publicada_em` em
--   vez de `created_at` (inconsistência com o padrão do resto da app).
--   PostgREST devolve 400 ("column does not exist"), o hook captura no
--   campo `error` mas mantém `data = []` → UI mostra empty state.
--   Marketing "parece" funcionar porque após o INSERT o handler faz
--   setArtes((prev) => [saved, ...prev]) local — mas a galeria some
--   se a tela for atualizada.
--
-- Fix:
--   Acrescenta `created_at` em marketing_artes (timestamptz, default
--   now()) e backfill a partir de `publicada_em` para registros
--   existentes. Mantém `publicada_em` (snapshot semântico já usado em
--   UI/feedback). Index novo + reasserção do realtime publication.
--
-- Execute no Supabase SQL Editor. Idempotente.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. marketing_artes — adiciona created_at
-- ─────────────────────────────────────────────

ALTER TABLE marketing_artes
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Backfill: para registros pré-existentes, copia o valor de
-- publicada_em (semanticamente equivalente — a arte "nasceu" quando
-- foi publicada). Só corre uma vez na prática.
UPDATE marketing_artes
   SET created_at = publicada_em
 WHERE created_at = updated_at         -- linha recém-criada por este ALTER
   AND publicada_em IS NOT NULL
   AND created_at <> publicada_em;

CREATE INDEX IF NOT EXISTS idx_artes_created_at
  ON marketing_artes(created_at DESC);

-- ─────────────────────────────────────────────
-- 2. Reasserção de RLS (idempotente, defensivo)
-- ─────────────────────────────────────────────
-- O diagnóstico inicial suspeitou de RLS — confirmado em produção que
-- já está como deveria (polqual = 'true'). Reaplicar é no-op seguro e
-- protege contra deriva futura, então mantemos.

ALTER TABLE marketing_artes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "artes_read"   ON marketing_artes;
DROP POLICY IF EXISTS "artes_insert" ON marketing_artes;
DROP POLICY IF EXISTS "artes_update" ON marketing_artes;
DROP POLICY IF EXISTS "artes_delete" ON marketing_artes;

CREATE POLICY "artes_read" ON marketing_artes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "artes_insert" ON marketing_artes
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "artes_update" ON marketing_artes
  FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing'))
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "artes_delete" ON marketing_artes
  FOR DELETE TO authenticated
  USING (auth_in_setor('marketing'));

-- ─────────────────────────────────────────────
-- 3. Realtime publication (reasserta inclusão)
-- ─────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_artes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_artes;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Coluna existe:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='marketing_artes' AND column_name='created_at';
--
-- 2. Linhas backfilladas:
--    SELECT count(*) FROM marketing_artes WHERE created_at IS NULL;
--    -- esperado: 0
--
-- 3. Order funciona via REST (rodar no app ou via PostgREST):
--    GET /rest/v1/marketing_artes?order=created_at.desc
--    -- não deve mais devolver 400.
-- =================================================================
