-- O caixa do dia não é público.
--
-- `dinheiro_das_vendas_do_caixa(filial, data)` é SECURITY DEFINER: ela soma as
-- vendas em dinheiro atravessando a RLS de `vendas` para dizer ao conferente
-- quanto tem de haver na gaveta. Quem pode perguntar isso é quem opera a
-- unidade — não a internet.
--
-- A migr. 562 tentou fechar com `REVOKE ALL ... FROM public`, e isso não basta:
-- o `public` ali é o pseudo-papel, mas o Supabase concede EXECUTE ao `anon`
-- NOMINALMENTE, por default privileges, no instante em que a função nasce.
-- Grant nominal só sai com revoke nominal. O advisor apanhou: sem login dava
-- para descobrir o faturamento em dinheiro de qualquer unidade em qualquer dia.
--
-- Nada muda para quem usa o sistema: `authenticated` e `service_role` seguem
-- com EXECUTE, que é como a tela de Controle de Caixa já chama.

BEGIN;

REVOKE ALL ON FUNCTION public.dinheiro_das_vendas_do_caixa(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dinheiro_das_vendas_do_caixa(text, date) TO authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.dinheiro_das_vendas_do_caixa(text, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa dinheiro_das_vendas_do_caixa — revoke não pegou.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.dinheiro_das_vendas_do_caixa(text, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated perdeu o EXECUTE — a conferência do caixa quebraria.';
  END IF;
END $$;

COMMIT;
