-- =================================================================
-- LogMax ERP — P2 Fixes
-- Execute no Supabase SQL Editor
-- =================================================================

-- 1. Adiciona requisicao_id na tabela pedidos (rastreabilidade completa)
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS requisicao_id uuid REFERENCES requisicoes(id) ON DELETE SET NULL;

-- 2. Tabela de configurações do sistema (necessária para integração WhatsApp e futuras integrações)
CREATE TABLE IF NOT EXISTS configuracoes (
  chave      TEXT PRIMARY KEY,
  valor      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read" ON configuracoes;
CREATE POLICY "auth_read" ON configuracoes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_write" ON configuracoes;
CREATE POLICY "admin_write" ON configuracoes
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );
