-- ============================================================
-- LogMax — Tabela de Registros de Ponto por QR Code
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS ponto_qr_registros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,    -- 'entrada' | 'retorno' | 'saida'
  status        TEXT NOT NULL DEFAULT 'No Horário', -- 'No Horário' | 'Atrasado'
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ponto_qr_registros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON ponto_qr_registros;
CREATE POLICY "auth_all" ON ponto_qr_registros
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
