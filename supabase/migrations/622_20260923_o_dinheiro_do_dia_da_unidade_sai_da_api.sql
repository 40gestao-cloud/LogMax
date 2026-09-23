-- 622 — O dinheiro do dia da unidade sai da API.
--
-- `dinheiro_das_vendas_do_caixa(filial, data)` é SECURITY DEFINER, não confere
-- quem chama e estava com EXECUTE para `authenticated`: qualquer aluno logado,
-- de qualquer unidade, perguntava pela API quanto a SuperMax vendeu em dinheiro
-- em qualquer dia — atravessando a RLS de `vendas`. A migr. 588 tirou o `anon`
-- e manteve o `authenticated` dizendo que a tela de Controle de Caixa chamava a
-- função; não chamava (nem naquela época nem hoje — nenhum `rpc(...)` no front,
-- no MaxBank ou no MaxPay).
--
-- Desde a migr. 621 nem as RPCs do caixa a usam: a conta é por caixa, em
-- `dinheiro_do_caixa(id)`, que nasce fechada para todos os papéis. Sem ninguém
-- que chame, apagar é mais limpo que revogar — função que não existe não tem
-- grant para voltar aberto. A definição fica no histórico (migr. 562/588).

BEGIN;

-- Trava: se alguma função, view ou policy ainda citar o nome, não apaga.
DO $$
DECLARE v_quem text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_quem FROM (
    SELECT 'função ' || p.proname AS x
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname <> 'dinheiro_das_vendas_do_caixa'
       AND p.prosrc ILIKE '%dinheiro_das_vendas_do_caixa%'
    UNION ALL
    SELECT 'view ' || c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND pg_get_viewdef(c.oid) ILIKE '%dinheiro_das_vendas_do_caixa%'
    UNION ALL
    SELECT 'policy ' || polname
      FROM pg_policy
     WHERE COALESCE(pg_get_expr(polqual, polrelid), '') ILIKE '%dinheiro_das_vendas_do_caixa%'
        OR COALESCE(pg_get_expr(polwithcheck, polrelid), '') ILIKE '%dinheiro_das_vendas_do_caixa%'
  ) t;
  IF v_quem IS NOT NULL THEN
    RAISE EXCEPTION 'dinheiro_das_vendas_do_caixa ainda é usada por: % — não apago.', v_quem;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.dinheiro_das_vendas_do_caixa(text, date);

COMMIT;
