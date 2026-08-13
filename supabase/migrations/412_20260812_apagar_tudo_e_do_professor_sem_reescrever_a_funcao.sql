-- 412_20260812_apagar_tudo_e_do_professor_sem_reescrever_a_funcao.sql
--
-- A migr. 410 escondeu a Zona de Perigo de quem não é admin, e anotou que
-- esconder botão não fecha console: `resetar_dados_operacionais()` guarda
--
--   IF auth_user_role() NOT IN ('admin', 'ceo')
--
-- ou seja, um aluno-CEO ainda podia zerar a operação inteira pelo F12 com uma
-- linha. É a função mais destrutiva do sistema.
--
-- POR QUE NÃO TROCAR O `IF` DIRETAMENTE:
--
-- Mudar aquele guard exige CREATE OR REPLACE do corpo inteiro, e o corpo é a
-- lista de TRUNCATE — que foi reescrita pelas migrs. 141, 147, 377 e 395. Um
-- replace com corpo defasado corrigiria o guard e REVERTERIA a lista junto,
-- silenciosamente. Ninguém percebe até o dia em que o reset apagar a competição
-- que a 377 mandou preservar.
--
-- A SAÍDA: FECHAR A PORTA EM VEZ DE REESCREVER A SALA.
--
-- O que dá acesso à função não é o `IF` lá dentro — é o
-- `GRANT EXECUTE ... TO authenticated` da migr. 096. Tirando esse grant, o
-- PostgREST deixa de expor a função a qualquer usuário logado, e o guard
-- interno vira segunda camada em vez de única.
--
-- No lugar entra `resetar_dados_operacionais_admin()`: SECURITY DEFINER, exige
-- `role = 'admin'` literal e chama a original. Como DEFINER executa com os
-- privilégios do dono, a chamada interna funciona mesmo sem o grant público —
-- e `auth.uid()` continua sendo o do usuário real, então o guard antigo lá
-- dentro também roda e também aprova o admin. Duas camadas concordando.
--
-- O corpo da original não é tocado. A lista de TRUNCATE segue exatamente como
-- está no banco, seja ela qual for.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. A porta nova
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resetar_dados_operacionais_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
BEGIN
  -- `role = 'admin'` literal, jamais `auth_is_admin()`: esse helper hoje
  -- (migr. 307) inclui ceo, conselheiro e gerente-conselheiro, que são ALUNOS.
  -- COALESCE porque `auth_user_role()` devolve NULL para sessão sem perfil ou
  -- para usuário desligado, e `NULL IN (...)` é NULL — que num IF NOT não
  -- barra ninguém.
  IF NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Apenas o administrador pode apagar os dados operacionais.'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.resetar_dados_operacionais();
END;
$$;

COMMENT ON FUNCTION public.resetar_dados_operacionais_admin() IS
  'Única porta do APAGAR TUDO. Exige role = admin e delega para '
  'resetar_dados_operacionais(), cujo corpo (a lista de TRUNCATE) fica intocado.';

REVOKE ALL ON FUNCTION public.resetar_dados_operacionais_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resetar_dados_operacionais_admin() TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 2. A porta velha se fecha
-- ─────────────────────────────────────────────
-- Depois disto, chamar a original pelo SDK devolve 42501/PGRST202 para
-- qualquer usuário logado — inclusive admin, que passa a entrar pela nova.
-- service_role segue com acesso (endpoints e jobs), e o dono do projeto
-- continua podendo chamá-la no SQL Editor.

REVOKE ALL ON FUNCTION public.resetar_dados_operacionais() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resetar_dados_operacionais() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- 1. quem pode executar o quê:
--   SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE')
--     FROM pg_proc p
--     CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(rolname)
--    WHERE p.proname LIKE 'resetar_dados_operacionais%'
--    ORDER BY p.proname, r.rolname;
--   -- esperado: a original só com service_role = true;
--   --           a _admin com authenticated e service_role = true, anon false.
--
--   -- 2. pela pele de um aluno-CEO, no console do app:
--   await supabase.rpc('resetar_dados_operacionais')        // negado
--   await supabase.rpc('resetar_dados_operacionais_admin')  // 42501
--
--   -- 3. o corpo da original NÃO mudou (comparar antes/depois):
--   SELECT md5(prosrc) FROM pg_proc WHERE proname = 'resetar_dados_operacionais';
-- =================================================================
