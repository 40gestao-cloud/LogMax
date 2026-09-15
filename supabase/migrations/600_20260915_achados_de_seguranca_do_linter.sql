-- 600 — Achados de segurança do linter do Supabase, um a um
--
-- Item 5 do levantamento de 15/09. Nenhum destes causou a queda daquele dia;
-- são pendências que o linter aponta e que ninguém tinha lido até agora. Cada
-- um foi conferido antes: o que se mostrou intencional ficou como está, com o
-- motivo escrito.
--
-- 1) VIEW `v_promocao_vigente` era SECURITY DEFINER (nível ERROR no linter)
--    Roda com os poderes do dono, ou seja, ignora a RLS de quem lê. Ela já se
--    protege sozinha no WHERE (auth_is_service_role OR auth_pode_filial), mas
--    depender só disso é apostar que ninguém vai editar o WHERE sem perceber.
--    Conferido na LogMax-ERP com uma promoção vigente criada e desfeita na
--    mesma transação: 6 perfis (admin e colaboradores de MaxLook) enxergam a
--    MESMA linha com o invoker ligado. A função que ela chama por dentro
--    (`promocao_vigente_do_produto`) é SECURITY DEFINER e continua sendo — é
--    ela que dá acesso a `marketing_promocoes` para quem não é do marketing.
--
-- 2) 33 funções minhas sem `search_path` fixo (WARN)
--    Sem isso, quem chama escolhe em qual schema os nomes são resolvidos. Já
--    mordeu aqui antes: função de gatilho sem search_path derrubou o DELETE de
--    usuário com "Database error deleting user". As 31 restantes que o linter
--    aponta são do pg_trgm (extensão instalada no schema public) e não são
--    nossas para alterar. Nenhuma das minhas é usada em índice — conferido —,
--    então fixar o caminho não invalida nada.
--
-- 3) `anon` podia executar `_assert_capital_holding()` (WARN)
--    É a guarda interna das operações de capital, chamada só de dentro de
--    outras funções SECURITY DEFINER (aprovar_emprestimo, conceder_mutuo_capital,
--    distribuir_lucro_filial, estornar_aporte_capital, negar_emprestimo) — lá
--    dentro o papel é o do dono, então revogar do `anon` não atrapalha.
--    O QUE FICA ABERTO AO `anon`, DE PROPÓSITO:
--      - `get_vitrine_publica` — a vitrine da loja online é pública;
--      - `confirmar_pix_pendente`, `confirmar_cartao_pendente`,
--        `reservar_cobranca`, `liberar_cobranca`, `consultar_status_cobranca`,
--        `renotificar_pix_pago` — a página `/simulador-pagamento` roda sem
--        login (App.tsx a renderiza antes da autenticação) e o MaxPay, que é
--        repositório irmão, fala por elas. Fechar aqui quebraria os dois;
--      - as helpers `auth_*` — as policies das tabelas que o `anon` lê (vitrine)
--        chamam essas funções, e a avaliação acontece com o papel de quem lê.
--        Revogar derruba a loja online com "permission denied for function".
--
-- 4) `documento_sequencias` e `produtos_codigo_reserva`: RLS ligada, zero
--    policies (INFO). É intencional — são numeradores, escritos só por RPC
--    SECURITY DEFINER. Mas `documento_sequencias` ainda tinha GRANT de SELECT,
--    INSERT e UPDATE para `anon` e `authenticated`, herdado de antes da RLS.
--    Hoje não abre nada (sem policy, a RLS recusa), mas é uma armadilha para a
--    primeira policy que alguém criar ali. Os GRANTs saem e o comentário na
--    tabela explica a intenção.
--
-- FORA DESTA MIGRAÇÃO, e por quê:
--   - "Leaked password protection desligada": é chave do Auth, não do banco, e
--     ligar passa a recusar senha que já vazou na internet. Num ambiente onde o
--     professor cria as contas da turma, isso é decisão de quem dá a aula.
--   - "Extension pg_trgm in public": mover extensão de schema é operação de
--     risco (índices GIN dependem dela) para um ganho de organização.

SET lock_timeout = '3s';

-- 1) A view passa a respeitar a RLS de quem lê.
ALTER VIEW public.v_promocao_vigente SET (security_invoker = on);

-- 2) search_path fixo nas funções que são nossas (extensão fica de fora).
DO $sp$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS assinatura
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proconfig IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid AND d.deptype = 'e'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.assinatura);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '600: search_path fixado em % funções', n;
END
$sp$;

-- 3) Guarda interna deixa de ser chamável por quem não fez login.
REVOKE EXECUTE ON FUNCTION public._assert_capital_holding() FROM anon;

-- 4) Numeradores: sem porta pela API, com a intenção escrita.
REVOKE ALL ON TABLE public.documento_sequencias FROM anon, authenticated;

COMMENT ON TABLE public.documento_sequencias IS
  'Numerador de documentos. RLS ligada SEM policy de propósito: ninguém lê nem escreve pela API — só as RPCs SECURITY DEFINER que emitem número. Não criar policy aqui sem antes decidir quem pode consumir sequência.';
COMMENT ON TABLE public.produtos_codigo_reserva IS
  'Reserva de código de produto (migr. 481). RLS ligada SEM policy de propósito: só as RPCs SECURITY DEFINER de reserva tocam nesta tabela.';

DO $guarda$
DECLARE v int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'v_promocao_vigente'
       AND c.reloptions::text ~ 'security_invoker=(on|true)'
  ) THEN
    RAISE EXCEPTION '600: v_promocao_vigente continua sem security_invoker';
  END IF;

  SELECT count(*) INTO v
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proconfig IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  IF v > 0 THEN
    RAISE EXCEPTION '600: % funções nossas continuam sem search_path', v;
  END IF;

  IF has_function_privilege('anon', 'public._assert_capital_holding()', 'EXECUTE') THEN
    RAISE EXCEPTION '600: anon ainda executa _assert_capital_holding';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'documento_sequencias'
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION '600: documento_sequencias ainda tem GRANT para anon/authenticated';
  END IF;
END
$guarda$;

RESET lock_timeout;
