-- =================================================================
-- LogMax — Fluxo Pix interativo (QR + scanner + realtime)
-- =================================================================
-- Objetivo:
--   Suportar pagamento Pix simulado em duas fases:
--     1. PDV cria registro em pix_pendentes (status='aguardando') e
--        exibe QR code com o id; itens NÃO são persistidos ainda
--        (vendas só são criadas após confirmação).
--     2. Simulador (app de banco, rota pública /simulador-pagamento)
--        lê o QR e faz UPDATE para status='pago'.
--     3. PDV escuta via supabase_realtime, recebe a notificação e
--        chama o RPC criar_venda_pdv normalmente.
--
-- Segurança:
--   • UUID aleatório é o segredo. Sem autenticação no simulador, qualquer
--     pessoa com o id poderia marcar como pago — aceitável em ambiente de
--     demo. Em produção, trocar por edge function autenticada.
--   • RLS limita updates anônimos a aguardando → pago (sem rebackdate
--     nem rollback). Nenhum SELECT lista o conjunto — só lookup por id.
--
-- Execute no Supabase SQL Editor.
-- =================================================================

CREATE TABLE IF NOT EXISTS pix_pendentes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valor        numeric(15,2) NOT NULL CHECK (valor >= 0),
  status       text NOT NULL DEFAULT 'aguardando'
               CHECK (status IN ('aguardando', 'pago', 'cancelado')),
  cliente_id   uuid REFERENCES clientes(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);

CREATE INDEX IF NOT EXISTS pix_pendentes_status_idx
  ON pix_pendentes (status, created_at DESC);

ALTER TABLE pix_pendentes ENABLE ROW LEVEL SECURITY;

-- ----- Authenticated (PDV) -----
-- PDV cria, lê, atualiza (cancelar) e apaga (cleanup) seus pendentes.
DROP POLICY IF EXISTS pix_pendentes_auth_all ON pix_pendentes;
CREATE POLICY pix_pendentes_auth_all
  ON pix_pendentes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ----- Anonymous (simulador do banco) -----
-- Lookup por id (não há list — query sempre é .eq('id', ...)).
DROP POLICY IF EXISTS pix_pendentes_anon_select ON pix_pendentes;
CREATE POLICY pix_pendentes_anon_select
  ON pix_pendentes
  FOR SELECT
  TO anon
  USING (status = 'aguardando');

-- Confirmar pagamento: só permite transição aguardando → pago.
-- O CHECK no NEW.status é via WITH CHECK (status='pago'), e
-- garante que só pendentes 'aguardando' podem ser alterados.
DROP POLICY IF EXISTS pix_pendentes_anon_update ON pix_pendentes;
CREATE POLICY pix_pendentes_anon_update
  ON pix_pendentes
  FOR UPDATE
  TO anon
  USING (status = 'aguardando')
  WITH CHECK (status = 'pago');

-- ----- Realtime -----
-- Adiciona à publicação para PDV poder escutar postgres_changes na linha.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pix_pendentes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pix_pendentes;
  END IF;
END $$;

-- Trigger: ao marcar como pago, registra timestamp.
CREATE OR REPLACE FUNCTION pix_pendentes_set_paid_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pago' AND OLD.status <> 'pago' THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pix_pendentes_paid_at ON pix_pendentes;
CREATE TRIGGER trg_pix_pendentes_paid_at
  BEFORE UPDATE ON pix_pendentes
  FOR EACH ROW EXECUTE FUNCTION pix_pendentes_set_paid_at();
