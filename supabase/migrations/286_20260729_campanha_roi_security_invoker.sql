-- 286 — v_campanha_roi volta a rodar como quem consulta
--
-- Regressão introduzida ontem pela 280. Em Postgres, `CREATE OR REPLACE VIEW`
-- **não preserva** as reloptions da view: recriar sem repetir
-- `security_invoker` devolve a view ao default, que é SECURITY DEFINER — ela
-- passa a rodar com as permissões e o RLS de quem a criou, não de quem
-- consulta.
--
-- Foi exatamente o que a 198 tinha consertado em 2026-07-13, pelo mesmo
-- motivo: `v_campanha_roi` lê `vendas`, `marketing_campanhas` e
-- `marketing_cupons`, e como SECURITY DEFINER entrega receita de todas as
-- filiais a qualquer authenticated com o GRANT — furando o isolamento entre
-- unidades. A 280 mexeu na regra de atribuição de receita (assunto legítimo)
-- e levou a flag junto sem querer.
--
-- As outras 5 views com `security_invoker` (259) escaparam por cronologia: a
-- última recriação delas — migr. 240, em 22/07 — é anterior à 259. Não há o
-- que corrigir nelas hoje.
--
-- Prevenção, para a próxima vez: declarar a opção **dentro** do CREATE, como
-- as migrações 262/265 já fazem com `produtos_com_custo`:
--
--     CREATE OR REPLACE VIEW public.minha_view
--       WITH (security_invoker = true) AS SELECT ...
--
-- Assim a flag é parte da definição e não existe recriação que a perca. Um
-- `ALTER VIEW` separado depende de alguém lembrar dele.

BEGIN;

ALTER VIEW public.v_campanha_roi SET (security_invoker = true);

COMMIT;
