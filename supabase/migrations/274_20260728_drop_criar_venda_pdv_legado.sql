-- PDV: derruba a `criar_venda_pdv` de 2026-05-16, viva e chamável até hoje.
--
-- ACHADO (Etapa 3 do plano): o banco tem DUAS `criar_venda_pdv`. A tela usa a
-- de 10 argumentos. A original, de 7 argumentos (migr. 006), nunca foi
-- dropada — a 083 dropou a de 8 e esqueceu a de 7 — e segue com
-- `GRANT EXECUTE ... TO authenticated`. Qualquer usuário logado a alcança pelo
-- PostgREST, e o overload resolve por número de argumentos.
--
-- O que essa versão fóssil não tem, comparada à que a tela usa:
--
--   • `filial` — não conhece a coluna. A venda e a conta a receber nascem com
--     o DEFAULT: 'Matriz' em contas_receber. Vazamento de filial por omissão
--     de payload, que é exatamente o P8 do plano.
--   • validação de estoque — não checa saldo. A trava que a migr. 224 pôs na
--     versão nova não existe aqui; sobra só o trigger da 268, que estoura
--     depois da venda já ter sido montada.
--   • fuso do Acre (migr. 052) — datas em UTC.
--   • cupom (migr. 083), venda por peso (079), descrição de itens na conta a
--     receber (078), validação de totais (030), trava de concorrência (029).
--
-- Nenhuma chamada no código usa a assinatura de 7 argumentos: PDVView e
-- PDVViewSupermax passam os 10. Derrubá-la não quebra nada e fecha um caminho
-- de escrita que ignora metade das correções dos últimos dois meses.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

DROP FUNCTION IF EXISTS public.criar_venda_pdv(uuid, numeric, numeric, numeric, text, integer, jsonb);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO — deve sobrar exatamente uma, a de 10 argumentos
-- ════════════════════════════════════════════════════════════════════════════
--   SELECT oid::regprocedure AS assinatura, pronargs
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'criar_venda_pdv';
--
--   -- Vendas antigas gravadas pela versão fóssil (filial de fallback):
--   SELECT filial, count(*) FROM contas_receber GROUP BY 1;
-- ════════════════════════════════════════════════════════════════════════════
