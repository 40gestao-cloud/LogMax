-- 641_20260928_search_path_das_funcoes_de_percentual.sql
--
-- O linter voltou a apontar `function_search_path_mutable` em duas funções
-- nascidas depois da 600: `ir_aplicacao_pct` (aplicações, migr. 604) e
-- `pct_br`. Nenhuma é SECURITY DEFINER, então o risco é pequeno, mas a régua
-- da casa é toda função com `search_path` fixo. ALTER em vez de reescrever:
-- o corpo não muda.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

ALTER FUNCTION public.ir_aplicacao_pct(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.pct_br(numeric)           SET search_path = public, pg_temp;
