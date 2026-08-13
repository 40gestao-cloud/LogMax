-- 410_20260812_o_modulo_de_usuarios_e_leitura_para_a_turma.sql
--
-- Gestão de usuário é do professor. A tela já foi para leitura e o
-- `/api/users` já recusa quem não é `role = 'admin'` — mas nenhum dos dois
-- alcança o console do navegador.
--
-- A policy `up_update_own_or_admin` (migr. 010) permite UPDATE quando
-- `id = auth.uid() OR auth_is_admin()`. E `auth_is_admin()` hoje (migr. 307)
-- é admin OU ceo OU conselheiro OU gerente com `is_conselheiro` — quatro
-- cargos, três deles ALUNOS. Ou seja, um aluno-CEO escreve na linha de
-- qualquer colega direto do F12:
--
--   supabase.from('user_profiles').update({ funcionario_id: X }).eq('id', <colega>)
--
-- O trigger da migr. 258 já barra os campos que dão privilégio (role, setor,
-- setores_extras, filial, is_conselheiro, pode_acessar_usuarios, criado_por).
-- Sobra o resto — `nome`, `email`, `foto_url`, `funcionario_id` — que não é
-- escalada de privilégio, mas é a identidade do colega e o vínculo dele com a
-- ficha de RH, e disso saem folha e ponto.
--
-- Esta migração fecha o resto: UPDATE em user_profiles passa a ser a PRÓPRIA
-- linha ou admin literal.
--
-- O QUE NÃO QUEBRA:
--
-- - `/api/users` usa service_role, que ignora RLS.
-- - `atualizar_foto_usuario` (migr. 125) e as RPCs de desligamento (307) são
--   SECURITY DEFINER — passam por cima da policy, como sempre passaram.
-- - `id = auth.uid()` continua ali: quem mexe na própria linha segue mexendo.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

DROP POLICY IF EXISTS "up_update_own_or_admin" ON public.user_profiles;

CREATE POLICY "up_update_own_or_admin" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING      (id = auth.uid() OR COALESCE(public.auth_user_role() = 'admin', false))
  WITH CHECK (id = auth.uid() OR COALESCE(public.auth_user_role() = 'admin', false));

COMMENT ON POLICY "up_update_own_or_admin" ON public.user_profiles IS
  'A própria linha, ou admin literal. NÃO trocar por auth_is_admin(): esse '
  'helper inclui ceo/conselheiro/gerente-conselheiro, que são alunos.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- PENDÊNCIA CONHECIDA — NÃO RESOLVIDA AQUI
--
-- `resetar_dados_operacionais()` (o APAGAR TUDO, migr. 395) guarda
--   IF auth_user_role() NOT IN ('admin', 'ceo')
-- ou seja, um aluno-CEO pode zerar a operação inteira pelo F12, mesmo agora
-- que o botão sumiu da tela dele. Trocar isso exige CREATE OR REPLACE do
-- corpo inteiro da função, e o corpo tem de ser COPIADO DO BANCO, não deste
-- repositório — replace com corpo defasado reverteria a lista de TRUNCATE
-- junto com o guard, e é a função mais destrutiva do sistema.
--
-- Como conferir o que está no ar:
--   SELECT prosrc FROM pg_proc WHERE proname = 'resetar_dados_operacionais';
-- =================================================================

-- =================================================================
-- VERIFICAÇÃO
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE tablename = 'user_profiles' AND cmd = 'UPDATE';
--   -- esperado: qual citando auth_user_role(), NÃO auth_is_admin().
--
--   -- pela pele de um aluno-CEO, no console do app:
--   await supabase.from('user_profiles')
--     .update({ nome: 'teste' }).eq('id', '<uid de um colega>')
--   -- esperado: 0 linhas afetadas (a policy não deixa a linha entrar no
--   -- escopo do UPDATE — PostgREST devolve lista vazia, não erro).
-- =================================================================
