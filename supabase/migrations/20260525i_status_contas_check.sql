-- =================================================================
-- CHECK constraints defensivos em contas_receber.status e
-- contas_pagar.status.
--
-- Antes: campos text livres aceitavam qualquer valor — UI poderia
-- gravar status quebrado ("Absurdo", "", null não, etc.) que sumiria
-- de filtros como `WHERE status = 'Aberto'` e quebraria relatórios.
--
-- Whitelists vêm dos valores realmente usados (frontend + seed_data):
--   - contas_receber: 'Aberto','Pago','Atrasado','Cancelado'
--   - contas_pagar:   'Pendente','Pago','Atrasado','Cancelado'
--
-- Usa NOT VALID pra não falhar caso existam linhas legadas com status
-- fora da whitelist (defensivo). Após a migração, novos
-- INSERTs/UPDATEs respeitam o CHECK; o operador pode rodar
-- `ALTER TABLE ... VALIDATE CONSTRAINT ...` depois de auditar linhas
-- antigas.
--
-- Idempotente.
-- =================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_contas_receber_status'
  ) THEN
    ALTER TABLE contas_receber
      ADD CONSTRAINT chk_contas_receber_status
      CHECK (status IN ('Aberto','Pago','Atrasado','Cancelado'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_contas_pagar_status'
  ) THEN
    ALTER TABLE contas_pagar
      ADD CONSTRAINT chk_contas_pagar_status
      CHECK (status IN ('Pendente','Pago','Atrasado','Cancelado'))
      NOT VALID;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO / VALIDAÇÃO TOTAL (opcional, rodar quando confiar nos dados):
--
--   -- Lista linhas que violam a whitelist (se houver, tratar antes de VALIDATE)
--   SELECT id, status FROM contas_receber
--    WHERE status NOT IN ('Aberto','Pago','Atrasado','Cancelado');
--   SELECT id, status FROM contas_pagar
--    WHERE status NOT IN ('Pendente','Pago','Atrasado','Cancelado');
--
--   -- Após zerar violações, valida (constraint passa a cobrir histórico):
--   ALTER TABLE contas_receber VALIDATE CONSTRAINT chk_contas_receber_status;
--   ALTER TABLE contas_pagar   VALIDATE CONSTRAINT chk_contas_pagar_status;
-- =================================================================
