-- 599 — Duas policies permissivas de leitura na mesma tabela viram uma
--
-- Quando a mesma tabela tem duas policies PERMISSIVE de SELECT para o mesmo
-- papel, o Postgres avalia as DUAS e une com OR. O resultado é o mesmo de uma
-- policy só escrita com OR, mas o trabalho é dobrado — e depois da 597/598,
-- que baratearam o miolo, essa duplicação passou a ser a maior sobra.
--
-- Medido na LogMax-ERP, em transação revertida, 150 leituras (3 rodadas × 5
-- perfis × 10 tabelas): 333,6 ms com os pares separados, 124,0 ms depois de
-- fundir. Contagem de linhas visíveis idêntica para todos os perfis — OR de
-- duas condições é exatamente o que o Postgres já fazia.
--
-- São 10 pares, cada um com duas regras que nasceram em migrações diferentes:
--   requisicoes            compras_select            + requisicoes_setor_select
--   requisicoes_estoque    logist_select             + requisicoes_estoque_setor_select
--   ponto_eletronico       ponto_rh_select           + ponto_self_select
--   metas_estrategicas     metas_estrategicas_read   + metas_estrategicas_read_via_tarefa
--   candidaturas           candidaturas_select       + candidaturas_select_propria
--   vagas                  vagas_select              + vagas_select_convidado
--   treinamento_inscricoes inscricoes_read           + inscricoes_self_read
--   beneficios_pendentes   *_auth_select             + *_pagador_select
--   pix_pendentes          *_auth_select             + *_pagador_select
--   cartao_pendentes       *_auth_select             + *_pagador_select
--
-- A fundida fica com o nome da primeira em ordem alfabética e ganha um
-- COMMENT ON POLICY dizendo o que absorveu — senão o nome passa a mentir sobre
-- o alcance da regra, e quem for editar daqui a seis meses não faz ideia de que
-- ali dentro moram duas intenções.
--
-- O que NÃO entra: os pares de UPDATE (beneficios_pendentes). Fundir escrita
-- exige casar USING com WITH CHECK — quando um dos lados é nulo, o Postgres usa
-- o USING no lugar, e errar isso abre escrita que ninguém pediu. Não é custo de
-- leitura, fica para uma migração própria se algum dia doer.
--
-- As policies RESTRICTIVE (`zz_*`, 412 delas) não entram nesta conta: elas são
-- unidas com AND e cada uma precisa continuar valendo por si.
--
-- Também fecha as 2 policies que escaparam da 597 por usarem `auth.role()`,
-- que não estava na lista de helpers de lá.

SET lock_timeout = '3s';

DO $migr$
DECLARE
  g           record;
  p           record;
  v_quais     text[];
  v_nomes     text[];
  v_fundidas  int := 0;
  i           int;
BEGIN
  FOR g IN
    SELECT tablename, roles
      FROM pg_policies
     WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
     GROUP BY tablename, roles
    HAVING count(*) > 1
     ORDER BY tablename
  LOOP
    v_quais := ARRAY[]::text[];
    v_nomes := ARRAY[]::text[];

    FOR p IN
      SELECT policyname, qual
        FROM pg_policies
       WHERE schemaname = 'public' AND tablename = g.tablename AND roles = g.roles
         AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
       ORDER BY policyname
    LOOP
      -- `qual` nulo numa policy de SELECT significa "sem restrição": o OR
      -- inteiro vira verdadeiro, e é isso que o Postgres já fazia.
      v_quais := v_quais || COALESCE('(' || p.qual || ')', '(true)');
      v_nomes := v_nomes || p.policyname;
    END LOOP;

    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING (%s)',
      v_nomes[1], g.tablename, array_to_string(v_quais, ' OR ')
    );
    FOR i IN 2 .. array_length(v_nomes, 1) LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_nomes[i], g.tablename);
    END LOOP;

    EXECUTE format(
      'COMMENT ON POLICY %I ON public.%I IS %L',
      v_nomes[1], g.tablename,
      'Migr. 599: absorveu ' || array_to_string(v_nomes[2:], ', ')
      || ' (eram policies PERMISSIVE de SELECT separadas; o Postgres avaliava todas e unia com OR — mesmo resultado, trabalho dobrado). Cada trecho do OR é uma das regras originais.'
    );

    v_fundidas := v_fundidas + 1;
  END LOOP;

  RAISE NOTICE '599: % tabelas com as policies de leitura fundidas', v_fundidas;
END
$migr$;

-- `auth.role()` ficou de fora da 597 porque não estava na lista de helpers.
-- Mesma ideia: calcular uma vez por consulta, não por linha.
DO $role$
DECLARE r record; v_qual text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual
      FROM pg_policies
     WHERE schemaname = 'public'
       AND qual ~ '(?<!SELECT )\mauth\.role\(\)'
  LOOP
    v_qual := regexp_replace(r.qual, '(?<!SELECT )\m(auth\.role\(\))', '(SELECT \1)', 'g');
    EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, v_qual);
  END LOOP;
END
$role$;

DO $guarda$
DECLARE v_sobrou int;
BEGIN
  SELECT count(*) INTO v_sobrou FROM (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
     GROUP BY tablename, roles HAVING count(*) > 1
  ) x;
  IF v_sobrou > 0 THEN
    RAISE EXCEPTION '599: ainda restam % tabelas com policy de leitura duplicada', v_sobrou;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND qual ~ '(?<!SELECT )\mauth\.role\(\)') THEN
    RAISE EXCEPTION '599: sobrou auth.role() cru em policy';
  END IF;
END
$guarda$;

RESET lock_timeout;
