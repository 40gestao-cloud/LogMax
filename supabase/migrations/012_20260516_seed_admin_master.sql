-- =================================================================
-- LogMax — Seed do usuário Admin Master (pós-TRUNCATE)
-- =================================================================
-- ⚠️  ANTES DE EXECUTAR: substitua TODAS as ocorrências de
-- 'admin@example.com' abaixo pelo email REAL do administrador
-- (o mesmo cadastrado no passo 1). Senão a query não casa com
-- nenhuma linha em auth.users e nada é inserido.
--
-- Como usar:
--
--   1) Supabase Dashboard → Authentication → Users → "Add user"
--      ▸ Email:    <email real do admin>
--      ▸ Password: <senha forte>
--      ▸ Auto-confirm user: ✅  (marcar)
--      Clique em "Create user".
--
--   2) De volta ao SQL Editor, substitua o placeholder abaixo e
--      execute ESTE arquivo. Ele cria/atualiza a linha em
--      user_profiles vinculada ao auth.users criado no passo 1.
--
--   3) Faça login na app com as credenciais acima.
--
-- Idempotente: pode ser executado várias vezes sem efeito colateral
-- (ON CONFLICT atualiza role/setor/nome para o estado canónico).
-- =================================================================

INSERT INTO user_profiles (id, nome, email, role, setor, criado_por, created_at)
SELECT
  u.id,
  'Admin Master',
  'admin@example.com',
  'admin',
  'all',
  NULL,
  COALESCE(u.created_at, now())
FROM auth.users u
WHERE u.email = 'admin@example.com'
ON CONFLICT (id) DO UPDATE
  SET nome  = EXCLUDED.nome,
      email = EXCLUDED.email,
      role  = 'admin',
      setor = 'all';

-- Verificação
SELECT id, nome, email, role, setor, created_at
  FROM user_profiles
 WHERE email = 'admin@example.com';
