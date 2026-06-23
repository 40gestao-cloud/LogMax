-- =================================================================
-- Audit trail de baixas: qual banco foi debitado/creditado em cada
-- conta paga/recebida.
--
-- Motivação:
--   ContasPagarView/ContasReceberView pediam o banco no diálogo
--   "Pagar"/"Receber" e mexiam direto em caixa_bancos.saldo, mas
--   nunca persistiam o vínculo `conta ↔ banco`. Resultado:
--     1) Bug do saldo sobrescrito (corrigido em 7381047): não dava
--        pra reconciliar pq não sabíamos qual banco cada baixa tocou.
--     2) Estorno de baixa: hoje impossível devolver no banco certo.
--
-- Decisão:
--   Coluna `banco_id` (uuid, nullable, FK -> caixa_bancos com
--   ON DELETE SET NULL) em contas_pagar e contas_receber. Nullable
--   porque registros antigos (anteriores ao fix) ficam sem vínculo
--   — ajuste manual conforme controle externo.
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS banco_id uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL;

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS banco_id uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_banco_id
  ON public.contas_pagar(banco_id) WHERE banco_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_receber_banco_id
  ON public.contas_receber(banco_id) WHERE banco_id IS NOT NULL;

COMMENT ON COLUMN public.contas_pagar.banco_id IS
  'Banco debitado quando a conta foi paga. Preenchido no fluxo "Pagar" '
  'em ContasPagarView. NULL pra contas ainda Pendentes ou pagas antes '
  'desta migração.';

COMMENT ON COLUMN public.contas_receber.banco_id IS
  'Banco creditado quando a conta foi recebida. Preenchido no fluxo '
  '"Receber" em ContasReceberView. NULL pra contas ainda Abertas ou '
  'recebidas antes desta migração.';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Total já reconciliável (com banco vinculado), por banco:
--   SELECT cb.banco, COALESCE(SUM(cp.valor), 0) AS total_pago
--     FROM contas_pagar cp
--     JOIN caixa_bancos cb ON cb.id = cp.banco_id
--    WHERE cp.status = 'Pago' AND cp.ativo = true
--    GROUP BY cb.banco;
--
--   -- Backlog sem vínculo (precisam de ajuste manual de saldo):
--   SELECT COUNT(*) FROM contas_pagar
--    WHERE status = 'Pago' AND ativo = true AND banco_id IS NULL;
-- =================================================================
