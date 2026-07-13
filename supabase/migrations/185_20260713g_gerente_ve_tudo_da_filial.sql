-- =================================================================
-- LogMax — Gerente vê tudo da própria filial (regra de negócio)
-- =================================================================
-- Contexto: regra confirmada pelo usuário — "Gerentes das filiais devem
-- ter acesso a tudo da sua filial". Hoje isso só valia pra
-- `controle_caixa` (20260709c_caixa_gerente_acesso, único lugar que já
-- fazia `auth_in_setor(...) OR auth_user_role() = 'gerente'`). Em toda
-- outra tabela setor-restrita, um gerente cujo `setor` não bate com o
-- setor dono do dado fica tão travado quanto um colaborador comum —
-- só admin/CEO/conselheiro (via auth_is_admin()) enxergavam tudo.
-- Sintoma relatado: colaborador de Marketing lança campanha, aparece
-- pra admin/CEO/conselheiro mas não pro gerente da própria filial.
--
-- Esta migration faz DUAS coisas:
--
--   1. Helper novo `auth_in_setor_ou_gerente(...)` — mesmo contrato de
--      `auth_in_setor`, mas qualquer role='gerente' passa direto
--      (independente do setor dele). Fica só um lugar pra manter essa
--      regra em vez de repetir `OR auth_user_role() = 'gerente'` em
--      dezenas de policies. NÃO mexe em `auth_in_setor` (usado também
--      em tabelas sem gate de filial — RH sem coluna filial, TI etc. —
--      onde dar bypass geral pra gerente vazaria pra OUTRAS filiais).
--
--   2. Aplica `auth_in_setor_ou_gerente(...) AND auth_pode_filial(filial)`
--      em duas categorias de tabela:
--
--      a) Já tinham auth_pode_filial mas não tinham bypass de gerente:
--         produtos(delete), clientes, fornecedores, servicos, vendas,
--         itens_venda, contas_pagar, contas_receber, movimentacoes_estoque.
--
--      b) Já tinham coluna `filial` (adicionada em 20260703h/i/g_..._filial
--         e 20260704d_marketing_compras_filial) mas a RLS NUNCA foi
--         atualizada pra usá-la — mesma classe do bug de Filiais
--         (20260713_filiais_rls_nicho): requisicoes, aprovacoes_compras,
--         cotacoes, pedidos, recebimentos, notas_recebidas,
--         requisicoes_estoque, aprovacoes_estoque, orcamentos,
--         pedidos_venda, marketing_campanhas, marketing_cupons,
--         departamentos, cargos.
--
-- Fora de escopo (sem coluna filial, exigiria schema+front novos):
-- funcionarios, ferias, beneficios, treinamentos, folha_pagamento,
-- ponto_eletronico — RH continua setor-only, sem isolamento por
-- filial nenhum (nem pra colaborador comum). Flagar separado se quiser
-- fechar esse gap também.
--
-- INSERTs "abertos pra qualquer setor" (requisição, aprovação) mantêm
-- abertos por setor mas passam a exigir auth_pode_filial(filial) — evita
-- alguém criar um registro fingindo ser de outra unidade.
-- pedidos_venda.pv_insert fica intocado (comentário original já deixa
-- explícito que é caminho da RPC converter_orcamento_em_pedido).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 0. Helper ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_in_setor_ou_gerente(VARIADIC setors text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth_in_setor(VARIADIC setors) OR auth_user_role() = 'gerente';
$$;

GRANT EXECUTE ON FUNCTION public.auth_in_setor_ou_gerente(text[]) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Tabelas que já tinham auth_pode_filial — só falta o bypass
-- ═══════════════════════════════════════════════════════════════════

-- produtos
DROP POLICY IF EXISTS "delete_produtos" ON public.produtos;
CREATE POLICY "delete_produtos" ON public.produtos FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'logistica') AND auth_pode_filial(filial));

-- clientes
DROP POLICY IF EXISTS "write_clientes" ON public.clientes;
CREATE POLICY "write_clientes" ON public.clientes FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('vendas', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('vendas', 'financeiro') AND auth_pode_filial(filial));

-- fornecedores
DROP POLICY IF EXISTS "write_fornecedores" ON public.fornecedores;
CREATE POLICY "write_fornecedores" ON public.fornecedores FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'financeiro', 'logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('compras', 'financeiro', 'logistica') AND auth_pode_filial(filial));

-- servicos
DROP POLICY IF EXISTS "write_servicos" ON public.servicos;
CREATE POLICY "write_servicos" ON public.servicos FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));

-- vendas
DROP POLICY IF EXISTS "vendas_select" ON public.vendas;
DROP POLICY IF EXISTS "vendas_write" ON public.vendas;
CREATE POLICY "vendas_select" ON public.vendas FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('vendas', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "vendas_write" ON public.vendas FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('vendas') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('vendas') AND auth_pode_filial(filial));

-- itens_venda (herda filial via venda_id)
DROP POLICY IF EXISTS "itens_select" ON public.itens_venda;
DROP POLICY IF EXISTS "itens_write" ON public.itens_venda;
CREATE POLICY "itens_select" ON public.itens_venda FOR SELECT TO authenticated USING (
  auth_in_setor_ou_gerente('vendas', 'financeiro')
  AND EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
);
CREATE POLICY "itens_write" ON public.itens_venda FOR ALL TO authenticated
  USING (
    auth_in_setor_ou_gerente('vendas')
    AND EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
  )
  WITH CHECK (
    auth_in_setor_ou_gerente('vendas')
    AND EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
  );

-- contas_pagar (fin_insert continua aberto pra qualquer setor — cross-flow Pedido/Folha)
DROP POLICY IF EXISTS "fin_select" ON public.contas_pagar;
DROP POLICY IF EXISTS "fin_update" ON public.contas_pagar;
DROP POLICY IF EXISTS "fin_delete" ON public.contas_pagar;
CREATE POLICY "fin_select" ON public.contas_pagar FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_update" ON public.contas_pagar FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON public.contas_pagar FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial));

-- contas_receber (fin_insert continua aberto — cross-flow PDV Fiado)
DROP POLICY IF EXISTS "fin_select" ON public.contas_receber;
DROP POLICY IF EXISTS "fin_update" ON public.contas_receber;
DROP POLICY IF EXISTS "fin_delete" ON public.contas_receber;
CREATE POLICY "fin_select" ON public.contas_receber FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_update" ON public.contas_receber FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON public.contas_receber FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('financeiro') AND auth_pode_filial(filial));

-- movimentacoes_estoque (mov_insert continua aberto — cross-flow PDV/Recebimento)
DROP POLICY IF EXISTS "mov_select" ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_update" ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_delete" ON public.movimentacoes_estoque;
CREATE POLICY "mov_select" ON public.movimentacoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('logistica', 'compras') AND auth_pode_filial(filial));
CREATE POLICY "mov_update" ON public.movimentacoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));
CREATE POLICY "mov_delete" ON public.movimentacoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));

-- ═══════════════════════════════════════════════════════════════════
-- 2. Tabelas com coluna `filial` mas RLS nunca atualizada (gap novo)
-- ═══════════════════════════════════════════════════════════════════

-- requisicoes (compras_insert fica aberto a qualquer setor, mas preso à própria filial)
DROP POLICY IF EXISTS "compras_select" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_insert" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_update" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_delete" ON public.requisicoes;
CREATE POLICY "compras_select" ON public.requisicoes FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'logistica', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "compras_insert" ON public.requisicoes FOR INSERT TO authenticated
  WITH CHECK (auth_pode_filial(filial));
CREATE POLICY "compras_update" ON public.requisicoes FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('compras') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('compras') AND auth_pode_filial(filial));
CREATE POLICY "compras_delete" ON public.requisicoes FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('compras') AND auth_pode_filial(filial));

-- aprovacoes_compras (compras_insert continua exigindo status='Pendente')
DROP POLICY IF EXISTS "compras_select" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_insert" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_update" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_delete" ON public.aprovacoes_compras;
CREATE POLICY "compras_select" ON public.aprovacoes_compras FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('compras') AND auth_pode_filial(filial));
CREATE POLICY "compras_insert" ON public.aprovacoes_compras FOR INSERT TO authenticated
  WITH CHECK (status = 'Pendente' AND auth_pode_filial(filial));
CREATE POLICY "compras_update" ON public.aprovacoes_compras FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('compras') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('compras') AND auth_pode_filial(filial));
CREATE POLICY "compras_delete" ON public.aprovacoes_compras FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('compras') AND auth_pode_filial(filial));

-- cotacoes
DROP POLICY IF EXISTS "cot_select" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_insert" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_update" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_delete" ON public.cotacoes;
CREATE POLICY "cot_select" ON public.cotacoes FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'logistica', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "cot_insert" ON public.cotacoes FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor_ou_gerente('compras', 'logistica') AND auth_pode_filial(filial));
CREATE POLICY "cot_update" ON public.cotacoes FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'logistica', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('compras', 'logistica', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "cot_delete" ON public.cotacoes FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'logistica') AND auth_pode_filial(filial));

-- pedidos
DROP POLICY IF EXISTS "compras_all" ON public.pedidos;
CREATE POLICY "compras_all" ON public.pedidos FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('compras', 'logistica') AND auth_pode_filial(filial));

-- recebimentos
DROP POLICY IF EXISTS "compras_all" ON public.recebimentos;
CREATE POLICY "compras_all" ON public.recebimentos FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('compras', 'logistica') AND auth_pode_filial(filial));

-- notas_recebidas
DROP POLICY IF EXISTS "compras_all" ON public.notas_recebidas;
CREATE POLICY "compras_all" ON public.notas_recebidas FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('compras', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('compras', 'financeiro') AND auth_pode_filial(filial));

-- requisicoes_estoque (logist_insert fica aberto a qualquer setor, preso à filial)
DROP POLICY IF EXISTS "logist_select" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_insert" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON public.requisicoes_estoque;
CREATE POLICY "logist_select" ON public.requisicoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));
CREATE POLICY "logist_insert" ON public.requisicoes_estoque FOR INSERT TO authenticated
  WITH CHECK (auth_pode_filial(filial));
CREATE POLICY "logist_update" ON public.requisicoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));
CREATE POLICY "logist_delete" ON public.requisicoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));

-- aprovacoes_estoque
DROP POLICY IF EXISTS "logist_select" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_insert" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON public.aprovacoes_estoque;
CREATE POLICY "logist_select" ON public.aprovacoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));
CREATE POLICY "logist_insert" ON public.aprovacoes_estoque FOR INSERT TO authenticated
  WITH CHECK (status = 'Pendente' AND auth_pode_filial(filial));
CREATE POLICY "logist_update" ON public.aprovacoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));
CREATE POLICY "logist_delete" ON public.aprovacoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('logistica') AND auth_pode_filial(filial));

-- orcamentos
DROP POLICY IF EXISTS "orc_select" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_insert" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_update" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_delete" ON public.orcamentos;
CREATE POLICY "orc_select" ON public.orcamentos FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('vendas', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "orc_insert" ON public.orcamentos FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor_ou_gerente('vendas') AND auth_pode_filial(filial));
CREATE POLICY "orc_update" ON public.orcamentos FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('vendas', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('vendas', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "orc_delete" ON public.orcamentos FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('vendas') AND auth_pode_filial(filial));

-- pedidos_venda (pv_insert fica intocado — caminho da RPC converter_orcamento_em_pedido)
DROP POLICY IF EXISTS "pv_select" ON public.pedidos_venda;
DROP POLICY IF EXISTS "pv_update" ON public.pedidos_venda;
DROP POLICY IF EXISTS "pv_delete" ON public.pedidos_venda;
CREATE POLICY "pv_select" ON public.pedidos_venda FOR SELECT TO authenticated
  USING (auth_in_setor_ou_gerente('vendas', 'logistica', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "pv_update" ON public.pedidos_venda FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('vendas', 'logistica', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('vendas', 'logistica', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "pv_delete" ON public.pedidos_venda FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('vendas') AND auth_pode_filial(filial));

-- marketing_campanhas (campanhas_read fica aberto — decisão de design documentada em 083)
DROP POLICY IF EXISTS "campanhas_insert" ON public.marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_update" ON public.marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_delete" ON public.marketing_campanhas;
CREATE POLICY "campanhas_insert" ON public.marketing_campanhas FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor_ou_gerente('marketing') AND auth_pode_filial(filial));
CREATE POLICY "campanhas_update" ON public.marketing_campanhas FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('marketing', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('marketing', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "campanhas_delete" ON public.marketing_campanhas FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('marketing') AND auth_pode_filial(filial));

-- marketing_cupons (cupons_read fica aberto — PDV precisa ler o código aplicado)
DROP POLICY IF EXISTS "cupons_insert" ON public.marketing_cupons;
DROP POLICY IF EXISTS "cupons_update" ON public.marketing_cupons;
DROP POLICY IF EXISTS "cupons_delete" ON public.marketing_cupons;
CREATE POLICY "cupons_insert" ON public.marketing_cupons FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor_ou_gerente('marketing') AND auth_pode_filial(filial));
CREATE POLICY "cupons_update" ON public.marketing_cupons FOR UPDATE TO authenticated
  USING (auth_in_setor_ou_gerente('marketing') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('marketing') AND auth_pode_filial(filial));
CREATE POLICY "cupons_delete" ON public.marketing_cupons FOR DELETE TO authenticated
  USING (auth_in_setor_ou_gerente('marketing') AND auth_pode_filial(filial));

-- departamentos (rh_all nunca teve gate de filial, mesmo já tendo a coluna)
DROP POLICY IF EXISTS "rh_all" ON public.departamentos;
CREATE POLICY "rh_all" ON public.departamentos FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('rh') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('rh') AND auth_pode_filial(filial));

-- cargos (idem)
DROP POLICY IF EXISTS "rh_all" ON public.cargos;
CREATE POLICY "rh_all" ON public.cargos FOR ALL TO authenticated
  USING (auth_in_setor_ou_gerente('rh') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor_ou_gerente('rh') AND auth_pode_filial(filial));

COMMIT;
