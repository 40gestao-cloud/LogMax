-- 646_20260928_financeiro_le_o_pedido_que_confere.sql
--
-- O Financeiro confere a nota contra o pedido (migr. 491) e, desde a 645, a
-- diferença vira custo — mas a policy de LEITURA de `pedidos` só deixava
-- Compras/Logística/gerente. Um aluno só do Financeiro via as contas de pedido
-- e nenhum pedido: o modal "Conferir nota" mostrava "Pedido: R$ 0,00" e
-- acusava divergência em toda nota (provado na Contabilidade/TechMax: 31
-- contas de pedido visíveis, 0 pedidos).
--
-- Só leitura. Escrever em pedido continua de Compras/Logística/gerente
-- (compras_update, migr. 642).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

DROP POLICY IF EXISTS compras_select ON public.pedidos;
CREATE POLICY compras_select ON public.pedidos
  FOR SELECT TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text, 'financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

NOTIFY pgrst, 'reload schema';
