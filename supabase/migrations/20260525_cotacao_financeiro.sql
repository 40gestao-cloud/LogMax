-- =================================================================
-- Cotações passam a depender de aprovação do Financeiro.
--
-- Fluxo novo:
--   1. Compras cria cotação      → status 'Aguardando Financeiro'
--   2. Financeiro aprova         → status 'Aprovado'   (+ cancela concorrentes)
--      Financeiro reprova        → status 'Negado'     (+ feedback obrigatório)
--   3. Compras (com cotação 'Aprovado') gera o pedido manualmente.
--
-- Notificações usam `notificar_setor()` (já existente):
--   - na criação           → setor 'financeiro' (aprovacao_pendente)
--   - na aprovação/reprovação → setor 'compras' (aprovado/reprovado)
--
-- Idempotente.
-- =================================================================

BEGIN;

-- 1. Colunas novas
ALTER TABLE cotacoes
  ADD COLUMN IF NOT EXISTS feedback      text,
  ADD COLUMN IF NOT EXISTS aprovado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprovado_em   timestamptz;

-- Status válidos: 'Em Cotação' (legado) | 'Aguardando Financeiro' |
--                 'Aprovado' | 'Negado' | 'Cancelado'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cotacoes_status'
  ) THEN
    ALTER TABLE cotacoes
      ADD CONSTRAINT chk_cotacoes_status
      CHECK (status IN ('Em Cotação','Aguardando Financeiro',
                        'Aprovado','Negado','Cancelado'));
  END IF;
END $$;

-- Feedback obrigatório em 'Negado'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cotacoes_negado_feedback'
  ) THEN
    ALTER TABLE cotacoes
      ADD CONSTRAINT chk_cotacoes_negado_feedback
      CHECK (status <> 'Negado' OR (feedback IS NOT NULL AND length(trim(feedback)) > 0));
  END IF;
END $$;

-- 2. Backfill: cotações existentes em 'Em Cotação' viram 'Aguardando Financeiro'
--    pra entrar no novo fluxo. Aprovadas/canceladas/negadas ficam como estão.
UPDATE cotacoes
   SET status = 'Aguardando Financeiro'
 WHERE status = 'Em Cotação';

-- 3. RLS: Financeiro precisa SELECT + UPDATE.
--    Compras mantém INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "compras_all" ON cotacoes;
DROP POLICY IF EXISTS "cot_select"  ON cotacoes;
DROP POLICY IF EXISTS "cot_insert"  ON cotacoes;
DROP POLICY IF EXISTS "cot_update"  ON cotacoes;
DROP POLICY IF EXISTS "cot_delete"  ON cotacoes;

CREATE POLICY "cot_select" ON cotacoes
  FOR SELECT TO authenticated USING (auth_in_setor('compras', 'financeiro'));

CREATE POLICY "cot_insert" ON cotacoes
  FOR INSERT TO authenticated WITH CHECK (auth_in_setor('compras'));

-- Update aberto pra compras + financeiro; UI decide quem move qual status.
CREATE POLICY "cot_update" ON cotacoes
  FOR UPDATE TO authenticated
  USING      (auth_in_setor('compras', 'financeiro'))
  WITH CHECK (auth_in_setor('compras', 'financeiro'));

CREATE POLICY "cot_delete" ON cotacoes
  FOR DELETE TO authenticated USING (auth_in_setor('compras'));

-- 4. Requisições: Financeiro precisa ler pra exibir o item ligado à cotação
--    na tela de aprovação. SELECT-only, sem permissão de escrita.
DROP POLICY IF EXISTS "compras_select" ON requisicoes;
CREATE POLICY "compras_select" ON requisicoes
  FOR SELECT TO authenticated USING (auth_in_setor('compras', 'financeiro'));

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT status, count(*) FROM cotacoes GROUP BY 1;
--   -- 'Aguardando Financeiro' deve conter as antigas 'Em Cotação'.
-- =================================================================
