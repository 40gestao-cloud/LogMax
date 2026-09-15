-- 597 — A RLS pergunta "quem é você" uma vez por consulta, não uma vez por linha
--
-- Em 15/09 a logmax-contabilidade respondeu 504 em tudo, login incluído, com
-- o banco sem lock nem conexão esgotada: o PostgREST cancelava por
-- statement timeout. `aprovacoes_compras` (184 linhas) levava 380 ms em média
-- por leitura, e `requisicoes` (188 linhas) até 470 ms.
--
-- Causa: as helpers `auth_*` são SQL SECURITY DEFINER com SET search_path —
-- o planner não consegue inlinar, e cada chamada troca contexto de segurança.
-- Escritas cruas na policy (`auth_in_setor(...)`, `NOT auth_desligado()`),
-- elas rodam de novo para CADA linha, e cada uma chama outras por dentro
-- (`auth_is_admin` → `auth_user_role` + EXISTS, `auth_blackout` → três). Numa
-- tabela de 184 linhas eram milhares de consultas a `user_profiles` para
-- responder uma pergunta cuja resposta não muda dentro da consulta.
--
-- A correção é mecânica e não muda o que ninguém enxerga: a chamada sem
-- dependência de linha vira `(SELECT auth_x())`, que o Postgres calcula uma
-- vez só (InitPlan) e reaproveita. Todas as `auth_*` são STABLE, então o
-- valor dentro da consulta é o mesmo por definição.
--
-- O que é embrulhado:
--   - chamadas sem argumento das helpers listadas abaixo;
--   - `auth.uid()`;
--   - `auth_in_setor(VARIADIC ARRAY['x'::text, ...])` — só com literais.
-- O que fica como está: chamada que recebe coluna (`auth_pode_filial(filial)`,
-- `auth_gerente_da(filial)`, `auth_opera_loja(p.filial)`). Depende da linha,
-- não dá para calcular uma vez. Ela fica mais barata mesmo assim, porque o
-- resto da expressão já não roda por linha.
--
-- Idempotente: o lookbehind `(?<!SELECT )` não embrulha de novo o que já está
-- embrulhado — o texto que o Postgres devolve de `(SELECT auth_x())` é
-- `( SELECT auth_x() AS auth_x)`.
--
-- Validado em transação revertida na LogMax-ERP antes de aplicar: 741
-- policies reescritas; contagem de linhas visíveis de todas as tabelas com RLS
-- idêntica antes e depois para 5 perfis (admin, gerente, colaboradores de
-- financeiro, logística e RH); leitura de aprovacoes_compras 393→109 ms,
-- requisicoes 1094→227 ms, varredura inteira 23→11 s; segunda passada não
-- mudaria nada. Tirando o embrulho, o texto volta ao original em todas, menos
-- 13 que usam `= ANY (auth_user_setores())`: nelas sobra o cast `::text[]`
-- sobre um valor que já é text[] — mesmo significado.
--
-- Trava: ALTER POLICY pede lock exclusivo na tabela. `lock_timeout` curto faz
-- a migração falhar inteira, sem efeito, se uma tabela estiver ocupada — em
-- vez de enfileirar e congelar a turma enquanto espera.

SET lock_timeout = '3s';

DO $migr$
DECLARE
  r          record;
  v_qual     text;
  v_check    text;
  v_sql      text;
  v_alteradas int := 0;
  -- Só helpers STABLE de identidade/contexto, sem argumento, que devolvem
  -- valor escalar.
  c_sem_arg  constant text :=
    '(?<!SELECT )\m(auth_(?:blackout|desligado|is_admin|is_conselho|is_service_role|registra_frequencia|user_filial|user_role|user_setor)\(\))';
  -- As que devolvem text[] precisam do cast: `setor = ANY ((SELECT f()))` o
  -- Postgres lê como ANY(subconsulta) — linhas de text[] comparadas com text,
  -- erro 42883. `((SELECT f())::text[])` volta a ser um array só.
  c_array    constant text :=
    '(?<!SELECT )\m(auth_(?:aula_setores|user_setores)\(\))';
  c_uid      constant text := '(?<!SELECT )\m(auth\.uid\(\))';
  c_setor    constant text := '(?<!SELECT )\m(auth_in_setor\(VARIADIC ARRAY\[(?:''[^'']*''::text(?:, )?)+\]\))';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
     ORDER BY tablename, policyname
  LOOP
    v_qual  := r.qual;
    v_check := r.with_check;

    IF v_qual IS NOT NULL THEN
      v_qual := regexp_replace(v_qual, c_sem_arg, '(SELECT \1)', 'g');
      v_qual := regexp_replace(v_qual, c_array,   '((SELECT \1)::text[])', 'g');
      v_qual := regexp_replace(v_qual, c_uid,     '(SELECT \1)', 'g');
      v_qual := regexp_replace(v_qual, c_setor,   '(SELECT \1)', 'g');
    END IF;
    IF v_check IS NOT NULL THEN
      v_check := regexp_replace(v_check, c_sem_arg, '(SELECT \1)', 'g');
      v_check := regexp_replace(v_check, c_array,   '((SELECT \1)::text[])', 'g');
      v_check := regexp_replace(v_check, c_uid,     '(SELECT \1)', 'g');
      v_check := regexp_replace(v_check, c_setor,   '(SELECT \1)', 'g');
    END IF;

    IF v_qual IS NOT DISTINCT FROM r.qual AND v_check IS NOT DISTINCT FROM r.with_check THEN
      CONTINUE;
    END IF;

    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF v_qual IS DISTINCT FROM r.qual THEN
      v_sql := v_sql || format(' USING (%s)', v_qual);
    END IF;
    IF v_check IS DISTINCT FROM r.with_check THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;

    EXECUTE v_sql;
    v_alteradas := v_alteradas + 1;
  END LOOP;

  RAISE NOTICE '597: % policies passaram a calcular a identidade uma vez por consulta', v_alteradas;
END
$migr$;

RESET lock_timeout;
