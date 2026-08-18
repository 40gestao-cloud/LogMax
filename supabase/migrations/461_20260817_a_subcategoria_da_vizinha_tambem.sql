-- 461_20260817_a_subcategoria_da_vizinha_tambem.sql
--
-- A CATEGORIA ERA DA UNIDADE. A SUBCATEGORIA DELA, DE TODO MUNDO.
--
-- Rabo da migr. 460: ao fechar a leitura de `produtos`, `subcategorias_produto`
-- ficou sendo o único degrau aberto do catálogo. E o mais estranho é que a
-- própria tabela já sabia a regra — só não a aplicava na leitura:
--
--   subcategorias_write  (ALL)     EXISTS (categorias_produto c
--                                    WHERE c.id = categoria_id
--                                      AND auth_pode_filial(c.filial))
--   subcategorias_select (SELECT)  true
--
-- Escrever exigia ser da unidade dona da categoria; ler não exigia nada. Somado
-- ao fato de `categorias_produto` já filtrar por filial no SELECT, o resultado
-- era um degrau torto: o colaborador da MaxLook não enxergava a categoria
-- "Celulares" da TechMax, mas enxergava "Celulares › Seminovos" pendurada nela.
--
-- Não é dinheiro — subcategoria é nome, cor e ícone. É a régua: a mesma
-- pergunta respondida de dois jeitos na mesma tabela, que é o defeito que esta
-- auditoria vem fechando desde a primeira migração do dia.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A FILIAL VEM DA CATEGORIA PAI
--
-- `subcategorias_produto` não tem coluna `filial` e não precisa ter: ela pende
-- de uma categoria, que tem. É a mesma decisão que a migr. 454 tomou para a
-- lixeira — derivar do pai em vez de duplicar a coluna, e nunca deixar de fora
-- "porque não tem o campo".
--
-- A cláusula é cópia literal da que a policy de escrita já usa. Se um dia a
-- régua mudar, muda nos dois lugares ao mesmo tempo, porque são o mesmo texto.
--
-- O QUE NÃO ENTRA NESTA MIGRAÇÃO
--
-- Sobram 23 policies com `qual = 'true'` no schema, e elas ficam. Quase todas
-- são parametrização que precisa ser legível por todos para o sistema
-- funcionar — `formas_pagamento`, `rh_faixas`, `financeiro_config`,
-- `aula_config`, `blackout_config` — ou registro da Matriz, que é global por
-- natureza: `competicoes_matriz`, `mandatos`, `votacoes`.
--
-- `centros_custo` entrou nessa conta por engano quando levantei a lista, e sai
-- dela agora: a tabela **não tem** coluna `filial`. É compartilhada entre as
-- unidades de propósito (migr. 458 criou sete para todas), e quem lança uma
-- conta a pagar precisa escolher uma. Ali a leitura aberta é o desenho, não o
-- descuido.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 460.

BEGIN;

DROP POLICY IF EXISTS "subcategorias_select" ON public.subcategorias_produto;

CREATE POLICY "subcategorias_select" ON public.subcategorias_produto
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.categorias_produto c
     WHERE c.id = subcategorias_produto.categoria_id
       AND COALESCE(public.auth_pode_filial(c.filial), false)
  ));

COMMENT ON TABLE public.subcategorias_produto IS
  'Segundo nível do catálogo. Pende da categoria, e é dela que vem a unidade — leitura e escrita pela mesma régua desde a migr. 461.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. leitura e escrita respondendo à mesma pergunta — esperado: as duas
--   --    citando auth_pode_filial via categorias_produto
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'subcategorias_produto'
--      AND policyname LIKE 'subcategorias%' ORDER BY cmd;
--
--   -- 2. o catálogo inteiro fechado: nenhuma das três pontas aberta
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND qual = 'true'
--      AND tablename IN ('produtos', 'categorias_produto', 'subcategorias_produto');
--   -- esperado: zero linhas
--
--   -- 3. o que sobrou com leitura aberta no schema, para a próxima revisão.
--   --    Hoje: 23, todas parametrização ou registro global da Matriz.
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND qual = 'true' ORDER BY 1, 2;
--
-- O teste que vale a aula: como colaborador da MaxLook, procurar no filtro de
-- subcategorias alguma que a TechMax criou. Antes aparecia sem a categoria mãe
-- junto; agora não existe para ele.
-- =================================================================
