-- 308 — O corte de acesso da 307 estava incompleto. Esta fecha.
--
-- ACHADO, ao auditar a 307 antes de aplicá-la. A 307 envenena quatro funções
-- (`auth_user_role`, `auth_user_filial`, `auth_user_setores`, `auth_is_admin`)
-- e afirma que isso derruba a escrita do desligado "em praticamente tudo".
-- A primeira metade é verdade — 173 das 228 policies de escrita passam por
-- elas e colapsam. A conclusão era otimista: sobram 55, e nem todas são
-- inofensivas.
--
-- Três vazamentos distintos:
--
--   1. POLICIES QUE LEEM user_profiles DIRETO, com subquery inline em vez das
--      funções. Não há como interceptá-las envenenando helper: elas não
--      chamam helper nenhum. São ~20, e incluem `caixa_bancos`,
--      `capital_config`, `capital_filial`, `emprestimos_filial`, `votacoes`,
--      `requerimentos`, `redes_sociais_links` e `metricas_redes_sociais` —
--      tudo escrita de admin/CEO/gerente, exatamente o perfil de quem tem mais
--      a estragar depois de desligado.
--
--   2. TRÊS FUNÇÕES AUXILIARES que também leem user_profiles direto e ficaram
--      de fora da lista das quatro:
--        auth_registra_frequencia()  — 4 policies. Desligado do RH seguiria
--                                      lançando ponto de qualquer um.
--        max_work_is_docente()       — 6 policies (Max Show).
--        auth_user_setor()           — 0 policies hoje, mas existe e é usada
--                                      por código; corrigida por simetria.
--
--   3. POLICIES ESCOPADAS POR auth.uid() — "as minhas coisas". O desligado
--      continuaria pedindo férias (`ferias_self_ins`), marcando o próprio
--      ponto (`ponto_self_insert`), abrindo chamado de TI, dando "ciente" em
--      aviso da Matriz, votando e mandando feedback. O requisito era "não
--      lança nem edita nada"; isto é lançar.
--
-- POR QUE POLICY RESTRICTIVE, e não 55 policies reescritas à mão. Uma policy
-- RESTRICTIVE entra em AND com todas as permissivas da tabela, sem precisar
-- conhecer o que elas dizem. Uma linha por tabela substitui a reescrita de 55
-- expressões — e reescrever expressão de policy à mão foi como a produção
-- ganhou os 45 `USING(true)` que a 180 encontrou. Também vale para o que eu
-- não vi: qualquer policy permissiva existente nessas tabelas passa a estar
-- coberta, tenha eu listado ela aqui ou não.
--
-- SÓ ESCRITA. Não há RESTRICTIVE para SELECT de propósito: o desligado precisa
-- carregar a tela para receber o aviso e precisa abrir a própria rescisão. A
-- leitura já encolheu sozinha pelo efeito das quatro funções da 307.
--
-- SÓ `authenticated`. O papel `anon` fica de fora — é ele que escreve nos
-- fluxos públicos (loja online, simulador de pagamento, pix/cartão pendentes),
-- e `auth_desligado()` seria falso para ele de qualquer forma.
--
-- E UM QUARTO, achado por último e mais grave que os três: `_assert_rpc`
-- não barrava perfil com setor NULL. Está na seção 0 — vale a leitura mesmo
-- para quem não se importa com desligamento, porque é buraco antigo.
--
-- O QUE ESTA MIGRAÇÃO NÃO ALCANÇA: RPCs `SECURITY DEFINER` que não chamam
-- `_assert_rpc` passam por cima de RLS por definição, então nem as policies da
-- seção 2 nem o guard da seção 0 as tocam. As de carteira (`transferir_pix_maxbank`,
-- `debitar_maxbank_salario`, `debitar_maxbank_beneficios`) ficam abertas de
-- propósito — o saldo é dinheiro da pessoa, e a rescisão foi creditada
-- justamente ali; travar seria confiscar. As demais estão listadas no rodapé.
--
-- IDEMPOTENTE. Depende da 306 e da 307. Aplicar nos 4 projetos de turma.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. `_assert_rpc` não barrava ninguém quando os setores davam NULL
--
-- ACHADO GRAVE, e anterior ao desligamento — só apareceu porque o desligado é
-- o primeiro perfil a produzir NULL ali. O guard era:
--
--     IF NOT public.auth_in_setor(VARIADIC p_setores) THEN RAISE EXCEPTION
--
-- `auth_in_setor` devolve `auth_is_admin() OR (auth_user_setores() && setors)`.
-- Quando `auth_user_setores()` é NULL, a expressão inteira vira NULL — e
-- `IF NOT NULL THEN` é FALSO, não verdadeiro. O RAISE não dispara e a RPC
-- executa. Ou seja: perfil sem setor resolvível PASSA por todo guard de RPC do
-- sistema, que é o oposto do que o arquivo diz fazer.
--
-- Em RLS o mesmo NULL nega corretamente (policy só deixa passar em TRUE), e é
-- por isso que ninguém tropeçou nisto antes: o buraco só existe do lado das
-- RPCs. Sem este COALESCE, o desligado passaria por `_assert_rpc` em todas as
-- RPCs do projeto, e as policies da seção 2 seriam a única linha de defesa.
--
-- Vale para qualquer perfil com `setor` nulo, desligado ou não.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._assert_rpc(VARIADIC p_setores text[] DEFAULT '{}'::text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- Vínculo encerrado não opera nada, nem o que o setor dele permitiria.
  IF public.auth_desligado() THEN
    RAISE EXCEPTION 'Seu vínculo com a organização foi encerrado — esta ação não está mais disponível.'
      USING ERRCODE = '42501';
  END IF;

  IF array_length(p_setores, 1) IS NULL THEN
    RETURN;
  END IF;

  -- COALESCE: ver o cabeçalho desta seção. Sem ele, NULL vira permissão.
  IF NOT COALESCE(public.auth_in_setor(VARIADIC p_setores), false) THEN
    RAISE EXCEPTION 'Permissão insuficiente para esta operação.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. As três funções que escaparam
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_user_setor()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT setor FROM public.user_profiles
   WHERE id = auth.uid() AND desligado_em IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.auth_registra_frequencia()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles u
     WHERE u.id = auth.uid()
       AND u.desligado_em IS NULL
       AND (
         u.role IN ('admin', 'ceo', 'conselheiro', 'gerente')
         OR u.setor = 'rh'
         OR 'rh' = ANY(COALESCE(u.setores_extras, ARRAY[]::text[]))
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.max_work_is_docente()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id = auth.uid()
       AND desligado_em IS NULL
       AND (role IN ('admin', 'ceo') OR is_conselheiro = true)
  );
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A trava geral: desligado não escreve em tabela nenhuma do schema public
--
-- Três policies por tabela (INSERT/UPDATE/DELETE) porque `FOR ALL` arrastaria
-- o SELECT junto — e aí a tela não carregaria para mostrar o aviso.
--
-- `user_profiles` fica FORA: o UPDATE ali já é barrado pelo trigger de privesc
-- da 258 nos campos que importam, e travar a tabela inteira impediria a pessoa
-- de trocar a própria foto de perfil, que não é lançamento de nada.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r      record;
  v_cmd  text;
  v_nome text;
  v_n    int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity            -- só tabelas com RLS ligada
       AND c.relname <> 'user_profiles'
     ORDER BY c.relname
  LOOP
    FOREACH v_cmd IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      v_nome := 'zz_desligado_bloqueia_' || lower(v_cmd);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_nome, r.relname);

      -- INSERT só aceita WITH CHECK; UPDATE e DELETE usam USING. Escrever os
      -- dois no INSERT é erro de sintaxe, não detalhe de estilo.
      IF v_cmd = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
             WITH CHECK (NOT public.auth_desligado())', v_nome, r.relname);
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated
             USING (NOT public.auth_desligado())', v_nome, r.relname, v_cmd);
      END IF;

      v_n := v_n + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Policies restritivas de desligamento criadas: %', v_n;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- 1. Cobertura: toda tabela com RLS tem as três? Deve devolver zero linhas.
--   SELECT c.relname, count(p.policyname) AS restritivas
--     FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--     LEFT JOIN pg_policies p
--            ON p.tablename = c.relname
--           AND p.policyname LIKE 'zz_desligado_bloqueia_%'
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
--      AND c.relname <> 'user_profiles'
--    GROUP BY c.relname
--   HAVING count(p.policyname) <> 3;
--
--   -- 2. Nenhuma função de RBAC pode ter ficado sem o filtro:
--   SELECT proname FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND prosrc LIKE '%user_profiles%'
--      AND (proname LIKE 'auth\_%' OR proname LIKE '%is_docente%')
--      AND prosrc NOT LIKE '%desligado_em%';
--   -- Esperado: só auth_desligado (que procura o oposto) e as que não
--   -- decidem permissão.
--
--   -- 3. RPCs SECURITY DEFINER que não passam por _assert_rpc nem por helper
--   --    de RBAC — a lista que esta migração NÃO cobre. Trigger function não
--   --    conta (não é chamável direto); olhe as que a UI chama.
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.prosecdef
--      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
--      AND p.prorettype <> 'trigger'::regtype
--      AND p.prosrc !~ '_assert_rpc|auth_in_setor|auth_pode_filial|auth_is_admin|auth_user_role|auth_gerente_da'
--    ORDER BY 1;
--
-- ────────────────────────────────────────────────────────────────────────────
-- TESTE DE FUMAÇA, com um usuário de mentira. Vale a pena antes da turma:
--
--   -- desliga
--   SELECT demitir_funcionario('<func_id>', 'Sem justa causa', 'teste');
--   -- entra com o login dele e tenta QUALQUER escrita: deve falhar.
--   -- Depois desfaz:
--   SELECT readmitir_funcionario('<func_id>', 'teste');
-- ────────────────────────────────────────────────────────────────────────────
