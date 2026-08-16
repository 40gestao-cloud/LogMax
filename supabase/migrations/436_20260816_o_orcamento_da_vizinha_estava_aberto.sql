-- 436_20260816_o_orcamento_da_vizinha_estava_aberto.sql
--
-- Reportado a partir da tela: operando a SuperMax, o Orçamento Anual oferecia
-- propor orçamento para as três unidades. A tela era só o sintoma visível; por
-- baixo, três tabelas com `filial` estavam com `SELECT USING (true)`.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LEITURA ABERTA EM TRÊS TABELAS DE DINHEIRO
--
--   orcamentos_periodo    o teto de verba proposto por cada unidade
--   orcamento_itens       a proposta rubrica a rubrica
--   prestacoes_contas     o que cada unidade prestou de contas
--   destinacoes_resultado quanto cada unidade guardou, reinvestiu e distribuiu
--
-- A ESCRITA nas quatro já estava correta — `auth_pode_filial(filial)` nas
-- policies de INSERT/UPDATE. Ninguém propunha orçamento em nome da vizinha. Mas
-- a leitura era livre para qualquer autenticado: um `select()` no console
-- devolvia o orçamento, a prestação de contas e a destinação de resultado das
-- outras duas unidades.
--
-- Numa operação que é competição entre as três, isso é a estratégia financeira
-- do concorrente — quanto ele pediu, no que vai gastar e quanto sobrou.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E ISTO EXPÕE UMA MEIA-CORREÇÃO MINHA, DA 431
--
-- A 431 fechou `apurar_resultado_periodo` e `orcamento_execucao` porque as duas
-- RPCs devolviam número de qualquer filial. Eu tratei a RPC e não olhei a
-- TABELA por baixo — que continuou aberta. Quem quisesse o mesmo dado não
-- precisava da RPC: bastava `from('orcamentos_periodo').select()`.
--
-- Lição: fechar a RPC não fecha o dado. RPC e RLS são duas portas para a mesma
-- sala, e auditar uma sem a outra dá falsa sensação de fechado.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A RÉGUA
--
-- `auth_pode_filial(filial)`, a mesma que a escrita destas tabelas já usava e a
-- mesma do resto do app: a unidade enxerga a própria; admin, CEO e conselheiro
-- enxergam todas (é `auth_is_admin()` por dentro), porque é o Conselho que
-- delibera orçamento e destinação — sem isso a Matriz não teria o que aprovar.
--
-- `orcamento_itens` não tem coluna `filial`: herda do pai, exatamente como a
-- policy de escrita dela já fazia.
--
-- FICA COMO ESTÁ, conferido no mesmo levantamento: `ciclos_avaliacao`,
-- `mandatos` e `matriz_tarefa_participantes` também são `SELECT USING(true)`,
-- mas são placar e organograma — existem para ser vistos pelas três unidades.
-- `produtos` idem, decisão didática registrada na 260/261 (expõe custo pela
-- API; a UI esconde).


BEGIN;

DROP POLICY IF EXISTS "orcamento_read" ON public.orcamentos_periodo;
CREATE POLICY "orcamento_read" ON public.orcamentos_periodo
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_pode_filial(filial), false));

DROP POLICY IF EXISTS "orcamento_item_read" ON public.orcamento_itens;
CREATE POLICY "orcamento_item_read" ON public.orcamento_itens
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orcamentos_periodo o
     WHERE o.id = orcamento_itens.orcamento_id
       AND COALESCE(public.auth_pode_filial(o.filial), false)
  ));

DROP POLICY IF EXISTS "prestacao_read" ON public.prestacoes_contas;
CREATE POLICY "prestacao_read" ON public.prestacoes_contas
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_pode_filial(filial), false));

DROP POLICY IF EXISTS "destinacao_read" ON public.destinacoes_resultado;
CREATE POLICY "destinacao_read" ON public.destinacoes_resultado
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_pode_filial(filial), false));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4 — espera 0)
--
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND cmd='SELECT' AND qual='true'
--      AND tablename IN ('orcamentos_periodo','orcamento_itens',
--                        'prestacoes_contas','destinacoes_resultado');
--
-- TESTE MANUAL (F12, colaborador de UMA filial):
--   from('orcamentos_periodo').select('filial')   → só a própria unidade
--   from('prestacoes_contas').select('filial')    → idem
--   from('destinacoes_resultado').select('filial')→ idem
--   Conselho em modo Matriz: Aprovações de Orçamento continua listando as três
-- ════════════════════════════════════════════════════════════════════════════
