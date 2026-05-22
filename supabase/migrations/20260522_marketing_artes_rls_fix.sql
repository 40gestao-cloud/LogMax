-- =================================================================
-- LogMax — Fix RLS: artes promocionais invisíveis para outros setores
-- =================================================================
-- Sintoma reportado (22/05/2026):
--   Marketing publica a arte e dispara notificar_setor('all'). A
--   notificação chega aos outros setores, mas ao clicar e abrir a
--   tela /artes-promocionais aparece "Nenhuma arte publicada ainda".
--
-- Diagnóstico:
--   • marketing_artes.artes_read deveria ser USING (true) (gallery
--     aberta para todos os autenticados — o snapshot já foi pensado
--     pra contornar a RLS restrita de marketing_promocoes).
--   • Em produção a policy ou está ausente (RLS enabled sem SELECT
--     policy → default deny → 0 rows), ou ficou com USING restritivo
--     herdado de versão anterior. Como Marketing consegue INSERT,
--     a policy artes_insert existe — mas a artes_read não está
--     consistente.
--
-- Fix:
--   Reaplica idempotentemente as 4 policies de marketing_artes e as
--   4 de marketing_arte_feedback, exatamente como o repo descreve em
--   20260521_marketing_artes_feedback.sql. Pode rodar em projetos
--   onde a migração original passou (no-op) ou onde ficou parcial.
--
-- Pré-requisitos:
--   • Tabelas marketing_artes e marketing_arte_feedback existem
--     (criadas em 20260521_marketing_artes_feedback.sql).
--   • Helpers auth_user_role(), auth_is_admin() já estão criados.
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. marketing_artes — gallery aberta a todos os autenticados
-- ─────────────────────────────────────────────

ALTER TABLE marketing_artes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "artes_read"   ON marketing_artes;
DROP POLICY IF EXISTS "artes_insert" ON marketing_artes;
DROP POLICY IF EXISTS "artes_update" ON marketing_artes;
DROP POLICY IF EXISTS "artes_delete" ON marketing_artes;

-- SELECT aberto: qualquer autenticado pode ver a galeria de artes.
-- Snapshot denormalizado (nome_produto/preço/datas) já evita expor
-- marketing_promocoes (que é restrito a marketing+financeiro).
CREATE POLICY "artes_read" ON marketing_artes
  FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE/DELETE: só marketing (+ admin via auth_in_setor).
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
-- 2. marketing_arte_feedback — leitura cross-setor (transparência)
-- ─────────────────────────────────────────────

ALTER TABLE marketing_arte_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_read"   ON marketing_arte_feedback;
DROP POLICY IF EXISTS "feedback_insert" ON marketing_arte_feedback;
DROP POLICY IF EXISTS "feedback_update" ON marketing_arte_feedback;
DROP POLICY IF EXISTS "feedback_delete" ON marketing_arte_feedback;

CREATE POLICY "feedback_read" ON marketing_arte_feedback
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "feedback_insert" ON marketing_arte_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND auth_user_role() IN ('gerente','admin','ceo')
  );

CREATE POLICY "feedback_update" ON marketing_arte_feedback
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR auth_is_admin())
  WITH CHECK (user_id = auth.uid() OR auth_is_admin());

CREATE POLICY "feedback_delete" ON marketing_arte_feedback
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR auth_is_admin());

-- ─────────────────────────────────────────────
-- 3. Realtime — reasserta inclusão na publicação
-- ─────────────────────────────────────────────
-- Se a publicação ficou sem essas tabelas, o sino realtime não
-- recebe a notificação para forçar reload da galeria. Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_artes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_artes;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_arte_feedback'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_arte_feedback;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO (rodar separadamente, fora da transação)
--
-- 1. Conferir policies aplicadas:
--    SELECT polname, polcmd, polqual::text
--    FROM pg_policy
--    WHERE polrelid = 'marketing_artes'::regclass;
--    -- esperado: artes_read com polqual = 'true'
--
-- 2. Simular leitura por outro setor (rodar como usuário 'vendas'):
--    SET LOCAL ROLE authenticated;
--    SELECT count(*) FROM marketing_artes;
--    -- esperado: count > 0 (não mais zero)
-- =================================================================
