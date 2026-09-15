-- 598 — auth_pode_filial(filial) e auth_gerente_da(filial) deixam de rodar por linha
--
-- Continuação da 597. Lá ficou de fora toda chamada que recebe coluna, porque
-- depende da linha e não dá para calcular uma vez só. Mas o que depende da
-- linha é só a comparação com a filial — "quem é você" continua igual durante
-- a consulta inteira. Na contabilidade, depois da 597, `requisicoes` ainda
-- levava 82 ms para 188 linhas: cada linha chamava auth_pode_filial e
-- auth_gerente_da, SECURITY DEFINER sem inline, e cada uma chamava mais duas
-- por dentro.
--
-- A policy passa a trazer o corpo das duas funções escrito no lugar, com a
-- parte que não depende da linha embrulhada em (SELECT ...):
--
--   auth_pode_filial(X)  →  ((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = X))
--   auth_gerente_da(X)   →  (((SELECT auth_user_role()) = 'gerente'::text) AND ((SELECT auth_user_filial()) = X))
--
-- É exatamente o corpo atual das funções (migr. 20260704e / 179-187), então o
-- resultado é o mesmo inclusive com NULL: filial nula ou usuário sem perfil dão
-- o mesmo NULL de antes, e os COALESCE(..., false) em volta seguem valendo.
--
-- O PREÇO: as policies deixam de seguir a função. Quem mudar o corpo de
-- auth_pode_filial ou auth_gerente_da daqui pra frente precisa reescrever a
-- expansão nas policies também — por isso o COMMENT ON FUNCTION no fim, que
-- aparece para quem abrir a função. As funções continuam existindo e valendo
-- para RPC e para quem escrever policy nova; policy nova com a chamada crua
-- funciona, só volta a ser lenta, e rodar esta migração de novo a expande.
--
-- Validado em transação revertida na LogMax-ERP antes de aplicar:
--   - fórmula expandida × função original, 8 perfis (admin, conselheiro, dois
--     gerentes, colaboradores e um uid sem perfil) × filiais SuperMax, TechMax,
--     MaxLook, Matriz, inexistente e NULL: nenhuma divergência, NULL incluído;
--   - 196 policies reescritas; contagem de linhas visíveis de todas as tabelas
--     com RLS idêntica antes e depois para 7 perfis;
--   - varredura inteira 14,2 s → 1,4 s; aprovacoes_compras 167 → 10 ms,
--     requisicoes 326 → 19 ms, frequencia_trabalho 326 → 11 ms.

SET lock_timeout = '3s';

DO $migr$
DECLARE
  r           record;
  v_qual      text;
  v_check     text;
  v_sql       text;
  v_alteradas int := 0;
  -- Argumento: coluna simples ou qualificada (filial, p.filial, filial_nova),
  -- ou função de uma coluna — frequencia_trabalho e justificativas_falta usam
  -- auth_pode_filial(funcionario_filial(funcionario_id)). A função interna
  -- continua por linha (depende do funcionário); só a identidade sai dela.
  c_pode      constant text := '\mauth_pode_filial\(([a-z_]+(?:\.[a-z_]+)?|[a-z_]+\([a-z_]+(?:\.[a-z_]+)?\))\)';
  c_gerente   constant text := '\mauth_gerente_da\(([a-z_]+(?:\.[a-z_]+)?|[a-z_]+\([a-z_]+(?:\.[a-z_]+)?\))\)';
  e_pode      constant text := '((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = \1))';
  e_gerente   constant text := '(((SELECT auth_user_role()) = ''gerente''::text) AND ((SELECT auth_user_filial()) = \1))';
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
      v_qual := regexp_replace(v_qual, c_pode,    e_pode,    'g');
      v_qual := regexp_replace(v_qual, c_gerente, e_gerente, 'g');
    END IF;
    IF v_check IS NOT NULL THEN
      v_check := regexp_replace(v_check, c_pode,    e_pode,    'g');
      v_check := regexp_replace(v_check, c_gerente, e_gerente, 'g');
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

  -- Chamada com argumento que não é coluna simples ficaria para trás calada.
  -- Melhor a migração falhar e alguém olhar.
  --
  -- Exceção consciente: `filiais` usa COALESCE((detalhes ->> 'nicho'), 'Matriz')
  -- como argumento em 4 policies. A tabela tem uma linha por unidade — chamada
  -- por linha ali não custa nada, e uma regex para expressão arbitrária custaria
  -- em confiança o que não devolve em tempo. Ficam como estão.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename <> 'filiais'
       AND coalesce(qual, '') || coalesce(with_check, '') ~ '\mauth_(pode_filial|gerente_da)\('
  ) THEN
    RAISE EXCEPTION '598: sobrou chamada de auth_pode_filial/auth_gerente_da com argumento que a expansão não reconhece';
  END IF;

  RAISE NOTICE '598: % policies com a filial comparada contra identidade calculada uma vez', v_alteradas;
END
$migr$;

COMMENT ON FUNCTION public.auth_pode_filial(text) IS
  'Corpo EXPANDIDO nas policies desde a migr. 598 (performance: evita chamada por linha). '
  'Mudou este corpo? Reescreva a expansão nas policies: ((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = X)).';
COMMENT ON FUNCTION public.auth_gerente_da(text) IS
  'Corpo EXPANDIDO nas policies desde a migr. 598 (performance: evita chamada por linha). '
  'Mudou este corpo? Reescreva a expansão nas policies: (((SELECT auth_user_role()) = ''gerente'') AND ((SELECT auth_user_filial()) = X)).';

RESET lock_timeout;
