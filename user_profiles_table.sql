-- ============================================================
-- LogMax — Tabela de Perfis de Usuário (RBAC)
-- Execute no SQL Editor do Supabase APÓS os schemas existentes.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'colaborador', -- 'admin' | 'gerente' | 'colaborador'
  setor      TEXT NOT NULL DEFAULT 'all',         -- 'all' | 'logistica' | 'vendas' | 'financeiro' | 'rh'
  criado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read" ON user_profiles;
CREATE POLICY "auth_read" ON user_profiles
  FOR SELECT TO authenticated USING (true);

-- Inserts e updates são feitos exclusivamente via service_role (API serverless).
-- A service_role bypassa RLS, então não é necessária política de INSERT aqui.

-- ============================================================
-- Criar perfil do primeiro admin (ajuste o LIMIT se necessário)
-- Insere o usuário mais antigo de auth.users como admin.
-- ============================================================
INSERT INTO user_profiles (id, nome, email, role, setor)
SELECT id, split_part(email, '@', 1), email, 'admin', 'all'
FROM auth.users
ORDER BY created_at
LIMIT 1
ON CONFLICT DO NOTHING;
