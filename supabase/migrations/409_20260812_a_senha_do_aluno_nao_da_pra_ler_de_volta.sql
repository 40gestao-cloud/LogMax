-- 409_20260812_a_senha_do_aluno_nao_da_pra_ler_de_volta.sql
--
-- Aluno esquece a senha toda semana, e o professor tem de criar outra.
--
-- A causa não é falta de tela: é que a senha não existe em lugar nenhum depois
-- de definida. O Supabase Auth guarda só o hash bcrypt em `auth.users`, que é
-- irreversível por construção — nem o service_role lê de volta. Por isso a
-- única saída até hoje era abrir o formulário e inventar uma senha nova, o que
-- deixa o professor gerenciando uma lista de senhas na cabeça.
--
-- Esta tabela é um cofre: guarda, em texto legível, a senha NO MOMENTO EM QUE
-- ELA É DEFINIDA pelo painel. Não recupera o hash — apenas anota o que o
-- painel acabou de escrever. Senhas definidas antes desta migração não têm
-- registro e não têm como ter: o passado é irrecuperável.
--
-- POR QUE ISSO É ACEITÁVEL AQUI E NÃO SERIA EM PRODUÇÃO REAL:
--
-- O LogMax é ambiente didático. As contas não guardam dinheiro, documento nem
-- dado pessoal de terceiro; o "banco" é simulado e o professor já podia trocar
-- a senha de qualquer aluno a qualquer momento. O que a tabela muda é o
-- trabalho, não o poder: quem já podia redefinir agora também pode ler.
--
-- POR QUE TABELA SEPARADA E NÃO COLUNA EM user_profiles:
--
-- `user_profiles` é lido por todo mundo — a lista de usuários, o select de
-- responsável, o vínculo de RH. Uma coluna ali herdaria esse alcance e
-- dependeria de column-level grant pra não vazar. Tabela própria tem RLS
-- própria: uma policy de SELECT, e ela exige `role = 'admin'`.
--
-- CUIDADO COM auth_is_admin(): esse helper considera admin também CEO e
-- conselheiro, que no LogMax são ALUNOS. Usá-lo aqui daria a um aluno-CEO a
-- senha dos colegas. A policy abaixo checa `role = 'admin'` literal, e só.
--
-- Escrita é exclusiva do service_role (o endpoint /api/users). Não existe
-- policy de INSERT/UPDATE/DELETE — ninguém escreve pela API pública.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Cofre
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.senhas_visiveis (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  senha        text        NOT NULL,
  definida_em  timestamptz NOT NULL DEFAULT now(),
  definida_por uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.senhas_visiveis IS
  'Cofre didático: a senha em texto legível, anotada no momento em que o painel '
  'a define. Não recupera senha antiga — o hash do Auth é irreversível. '
  'Leitura restrita a role = admin (o professor).';

COMMENT ON COLUMN public.senhas_visiveis.senha IS
  'Texto legível. Só existe porque o ambiente é didático — ver o cabeçalho da '
  'migração 409 antes de replicar este padrão em qualquer outro lugar.';

COMMENT ON COLUMN public.senhas_visiveis.definida_por IS
  'Quem definiu. NULL quando esse usuário foi excluído depois.';

-- ─────────────────────────────────────────────
-- 2. RLS — um SELECT, para admin literal
-- ─────────────────────────────────────────────

ALTER TABLE public.senhas_visiveis ENABLE ROW LEVEL SECURITY;

-- `auth_user_role()` e não uma subconsulta em user_profiles: o helper é
-- SECURITY DEFINER, então não fica à mercê da policy de SELECT de
-- user_profiles (hoje `id = auth.uid() OR auth_is_admin() OR
-- auth_pode_filial(filial)`, migr. 193 — se um dia ela apertar, uma
-- subconsulta aqui passaria a devolver zero linhas e o cofre ficaria
-- ilegível para o próprio professor). De quebra, a versão da migr. 307
-- devolve NULL para quem tem `desligado_em` preenchido, então admin
-- desligado perde o cofre junto com o resto — que é o certo.
--
-- COALESCE porque `auth_user_role()` devolve NULL quando não há perfil.
-- Em USING, NULL já reprova a linha; o COALESCE está aqui para o leitor,
-- e para o dia em que esta expressão for copiada para um IF NOT.
DROP POLICY IF EXISTS senhas_visiveis_select_admin ON public.senhas_visiveis;
CREATE POLICY senhas_visiveis_select_admin ON public.senhas_visiveis
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_user_role() = 'admin', false));

-- Sem policy de escrita: INSERT/UPDATE/DELETE só pelo service_role, que
-- ignora RLS. O endpoint /api/users é o único caminho.

-- ─────────────────────────────────────────────
-- 3. Grants
-- ─────────────────────────────────────────────
-- O REVOKE inclui `authenticated`, e não só `anon`, de propósito. O Supabase
-- mantém ALTER DEFAULT PRIVILEGES concedendo ALL sobre tabelas novas do schema
-- public a anon/authenticated/service_role — ou seja, esta tabela JÁ NASCE com
-- INSERT/UPDATE/DELETE concedidos a quem estiver logado. Hoje a RLS barra
-- sozinha (não existe policy de escrita, e RLS sem policy é deny), mas isso é
-- uma camada só: bastaria alguém criar uma policy `FOR ALL` distraída e a
-- turma passaria a escrever no cofre. Zerar o grant deixa duas camadas.
-- `anon` sai nominalmente pelo mesmo motivo das RPCs (migr. 260).

REVOKE ALL ON TABLE public.senhas_visiveis FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.senhas_visiveis TO authenticated;
GRANT ALL    ON TABLE public.senhas_visiveis TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- 1. a policy existe e não é permissiva demais:
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE tablename = 'senhas_visiveis';
--   -- esperado: UMA linha, cmd = SELECT, qual citando auth_user_role().
--   -- Se aparecer qualquer linha com cmd = ALL ou qual = 'true', pare.
--
--   -- 2. ninguém além de admin escreve, e anon não lê:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'senhas_visiveis' ORDER BY grantee;
--   -- esperado: authenticated só com SELECT; service_role com tudo;
--   -- NENHUMA linha de anon.
--
--   -- 3. teste pela pele de um aluno (o que o F12 dele conseguiria):
--   --    no console do app, logado como colaborador/CEO/conselheiro:
--   --    await supabase.from('senhas_visiveis').select('*')
--   --    esperado: { data: [], error: null } — lista vazia, não erro.
--   --    await supabase.from('senhas_visiveis').insert({user_id:'<uid>',senha:'x'})
--   --    esperado: erro 42501 (permission denied).
--
--   -- 3. depois de resetar a senha de alguém pelo painel:
--   SELECT u.nome, s.senha, s.definida_em
--     FROM senhas_visiveis s JOIN user_profiles u ON u.id = s.user_id;
-- =================================================================
