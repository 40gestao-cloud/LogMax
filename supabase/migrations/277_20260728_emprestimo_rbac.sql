-- Capital: aprovar empréstimo deixa de ser operação aberta a qualquer usuário.
--
-- ACHADO (Etapa 4 do plano): `aprovar_emprestimo` e `negar_emprestimo` são
-- SECURITY DEFINER, têm `GRANT EXECUTE ... TO authenticated` e **nenhuma
-- checagem de permissão**. O único `auth_` no corpo é `auth.uid()`, usado
-- para registrar quem aprovou — não para decidir se pode.
--
-- A tela (MatrizCapitalView) só aparece para admin/CEO. O banco não sabe
-- disso. Pelo F12, qualquer colaborador aprova o próprio empréstimo — e como
-- a taxa de juros e o número de parcelas são PARÂMETROS, aprova com a taxa
-- que quiser. `aprovar_emprestimo` ainda injeta o valor no capital da filial,
-- que é justamente o caminho que fura o bloqueio de capital estourado
-- (`origem = 'emprestimo'`, por design). O gate que autoriza esse furo era
-- uma tela.
--
-- Zero empréstimos registrados até agora nas 4 turmas — o buraco nunca foi
-- usado. Fechar antes que seja.
--
-- Junto, duas validações que faltavam: `p_num_parcelas` entrava direto num
-- ROUND(total / parcelas) — zero divide por zero — e `p_taxa_juros` aceitava
-- valor negativo, que viraria empréstimo com desconto.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- Guard reutilizável: quem decide sobre capital da holding
-- ────────────────────────────────────────────────────────────────────────────
-- Espelha a régua da tela: admin e CEO. Conselheiro julga competição, não
-- aprova crédito.

CREATE OR REPLACE FUNCTION public._assert_capital_holding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.auth_is_service_role() OR auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF public.auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin ou CEO decidem sobre empréstimos entre filiais.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_capital_holding() FROM public;

-- ────────────────────────────────────────────────────────────────────────────
-- Guard nas duas pontas da decisão
-- ────────────────────────────────────────────────────────────────────────────
-- Injeta a chamada no início do corpo das funções existentes, preservando o
-- resto. Reaplicar é seguro: só injeta onde ainda não existe.

DO $inject$
DECLARE
  r     record;
  v_def text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('aprovar_emprestimo', 'negar_emprestimo')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    IF v_def LIKE '%_assert_capital_holding%' THEN
      RAISE NOTICE '[277] % já tem guard, pulando.', r.proname;
      CONTINUE;
    END IF;

    v_def := regexp_replace(
      v_def,
      '(\nBEGIN\r?\n)',
      E'\\1  PERFORM public._assert_capital_holding();\n',
      ''
    );

    EXECUTE v_def;
    RAISE NOTICE '[277] guard injetado em %.', r.proname;
  END LOOP;
END;
$inject$;

-- ────────────────────────────────────────────────────────────────────────────
-- Sanidade dos parâmetros de aprovação
-- ────────────────────────────────────────────────────────────────────────────
-- Não dá para validar por CHECK: os valores chegam como argumentos. O trigger
-- olha o resultado gravado, que é onde o estrago apareceria.

CREATE OR REPLACE FUNCTION public.emprestimo_valida_condicoes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Aprovado' THEN
    IF COALESCE(NEW.num_parcelas, 0) < 1 THEN
      RAISE EXCEPTION 'Empréstimo aprovado precisa de ao menos 1 parcela.'
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(NEW.taxa_juros, 0) < 0 THEN
      RAISE EXCEPTION 'Taxa de juros não pode ser negativa.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emprestimo_valida_condicoes ON public.emprestimos_filial;
CREATE TRIGGER trg_emprestimo_valida_condicoes
  BEFORE INSERT OR UPDATE ON public.emprestimos_filial
  FOR EACH ROW EXECUTE FUNCTION public.emprestimo_valida_condicoes();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--   -- As duas funções devem ter o guard:
--   SELECT proname, pg_get_functiondef(oid) ILIKE '%_assert_capital_holding%' AS tem_guard
--     FROM pg_proc WHERE proname IN ('aprovar_emprestimo','negar_emprestimo');
--
--   -- Teste (logado como colaborador, em turma de teste):
--   --   SELECT aprovar_emprestimo('<id>', 0, 1);
--   --   -- esperado: 42501.
--
--   -- Sonda geral, que é o que achou este caso: RPCs SECURITY DEFINER
--   -- executáveis por authenticated e sem nenhum guard no corpo.
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosecdef
--      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
--      AND pg_get_functiondef(p.oid) NOT ILIKE '%_assert_rpc%'
--      AND pg_get_functiondef(p.oid) NOT ILIKE '%_assert_capital%'
--      AND pg_get_functiondef(p.oid) NOT ILIKE '%auth_is_admin%'
--      AND pg_get_functiondef(p.oid) NOT ILIKE '%auth_in_setor%'
--      AND pg_get_functiondef(p.oid) NOT ILIKE '%auth_gerente_da%'
--      AND pg_get_functiondef(p.oid) NOT ILIKE '%_maxbank_pode%'
--    ORDER BY 1;
-- ════════════════════════════════════════════════════════════════════════════
