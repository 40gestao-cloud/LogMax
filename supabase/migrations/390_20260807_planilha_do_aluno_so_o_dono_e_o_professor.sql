-- =================================================================
-- 390 — A planilha do aluno passa a ser lida só pelo dono e pelo professor.
--
-- A 389 abriu a leitura para o dono OU `auth_is_admin()`, escrevendo no
-- comentário "docente (admin/CEO/conselheiro)". A premissa não vale nesta
-- operação: desde a migração 146, `auth_is_admin()` é
--   admin | ceo | conselheiro | gerente com is_conselheiro
-- e nas turmas o CEO e os conselheiros são ALUNOS — é justamente o ponto do
-- exercício de governança. No projeto do curso de ERP isso dava cinco pessoas
-- com leitura sobre as planilhas dos dezenove colegas, sendo quatro delas
-- colegas de turma.
--
-- Não aparecia na tela (a UI sempre filtra pelo dono), mas a policy é o que
-- vale: o mesmo F12 das migrações 258/260/261 alcançava o resto.
--
-- Aqui o papel que interessa é o de PROFESSOR, e no LogMax ele é `admin` e só.
-- `auth_user_role() = 'admin'` em vez de `auth_is_admin()`, nos dois lugares
-- onde a 389 abriu: a leitura do objeto no storage e a da linha de metadado.
-- O COALESCE fica porque `auth_user_role()` devolve NULL para quem não tem
-- perfil, e `NULL OR ...` não barra em RLS.
--
-- Escrita não muda: já era só do dono, inclusive para o professor.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── Storage: leitura do arquivo ───────────────────────────────────
DROP POLICY IF EXISTS planilhas_turma_read ON storage.objects;
CREATE POLICY planilhas_turma_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'planilhas-turma'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR COALESCE(auth_user_role() = 'admin', false)
    )
  );

-- ── Metadados: leitura da linha ───────────────────────────────────
DROP POLICY IF EXISTS planilhas_trabalho_read ON public.planilhas_trabalho;
CREATE POLICY planilhas_trabalho_read ON public.planilhas_trabalho
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR COALESCE(auth_user_role() = 'admin', false)
  );

COMMENT ON TABLE public.planilhas_trabalho IS
  'Planilha de trabalho do aluno guardada no LogMax. O arquivo e do aluno, nao da filial: trocar de unidade nao faz perder o que ele fez. Le quem e dono e o professor (role admin) — CEO e conselheiro sao alunos e ficam de fora (migr. 390).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Nenhuma das duas policies de leitura menciona auth_is_admin:
-- SELECT tablename, policyname, qual FROM pg_policies
--  WHERE policyname IN ('planilhas_turma_read','planilhas_trabalho_read');
-- Esperado: 2 linhas, ambas com auth_user_role() = 'admin'.
--
-- 2) Quem lê tudo agora (esperado: só o professor):
-- SELECT count(*) FROM user_profiles WHERE role = 'admin';
--
-- 3) Logado como CEO ou conselheiro, sobre planilha de outro aluno:
-- SELECT count(*) FROM planilhas_trabalho WHERE user_id <> auth.uid();
-- Esperado: 0.
