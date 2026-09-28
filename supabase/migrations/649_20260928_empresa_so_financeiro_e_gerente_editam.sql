-- 649_20260928_empresa_so_financeiro_e_gerente_editam.sql
--
-- Formas de pagamento, Condições de pagamento e Projetos (módulo Empresa)
-- deixam de ser editáveis por qualquer aluno da filial. A 647 os tinha deixado
-- de fora porque o módulo Empresa é aberto a todo setor (sectorAccess); o
-- usuário decidiu que ABRIR a tela continua livre, mas GRAVAR fica com o
-- Financeiro e o gerente da filial (+ Matriz). Forma de pagamento muda o preço
-- do orçamento (migr. 568) — não é cadastro que o PDV ou o RH devam mexer.
--
-- A leitura não muda: Vendas › Orçamentos e a Conciliação leem formas_pagamento
-- pela policy *_select, que fica como está.
--
-- Mesma régua da 647. Nenhuma RPC grava nessas tabelas (docs/mapa).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

DROP POLICY IF EXISTS formas_pagamento_write ON public.formas_pagamento;
CREATE POLICY formas_pagamento_write ON public.formas_pagamento FOR ALL TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false))
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

DROP POLICY IF EXISTS condicoes_pagamento_write ON public.condicoes_pagamento;
CREATE POLICY condicoes_pagamento_write ON public.condicoes_pagamento FOR ALL TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false))
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

DROP POLICY IF EXISTS projetos_write ON public.projetos;
CREATE POLICY projetos_write ON public.projetos FOR ALL TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false))
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

NOTIFY pgrst, 'reload schema';
