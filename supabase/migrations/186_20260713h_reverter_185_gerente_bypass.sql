-- =================================================================
-- LogMax — REVERTE a 185_20260713g_gerente_ve_tudo_da_filial.sql
-- =================================================================
-- A 185 tentou dar "gerente vê tudo da própria filial" refatorando
-- 31 policies de uma vez, trocando `auth_in_setor(...)` por
-- `auth_in_setor_ou_gerente(...) AND auth_pode_filial(filial)`.
-- Isso quebrou dois fluxos importantes:
--
--   1. Editar requisição/orçamento/etc. de colaborador comum:
--      dbUpdate faz `.update().select().single()`. Se o novo USING
--      (com auth_pode_filial) bloqueia, 0 linhas afetadas, `.single()`
--      explode com "cannot coerce the result to a single JSON object".
--
--   2. INSERT cross-flow em requisicoes/aprovacoes/etc. que dependia
--      de policies mais permissivas passa a exigir auth_pode_filial
--      no WITH CHECK — se o front não passa `filial` no payload
--      (cai no DEFAULT 'SuperMax'), colaborador de outra unidade quebra.
--
-- Esta migration:
--   • Restaura TODAS as policies alteradas pela 185 ao estado que
--     tinham após a 184 (última estável antes do refactor).
--   • Dropa a função auth_in_setor_ou_gerente() criada pela 185.
--
-- Mantém intocado:
--   • Filiais (179), Pesquisas+Tarefas (182), ponto_qr_registros (181)
--     — resolveram o vazamento visual original, ninguém reclamou.
--   • Fornecedores (183) e Serviços (184) — mudanças pontuais,
--     dão acesso a logística (sem quebrar nada).
--
-- "Gerente vê tudo da própria filial" volta pra ser um problema aberto
-- — precisa de abordagem cirúrgica em migration separada (só SELECT,
-- não UPDATE/INSERT/DELETE).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Tabelas com auth_pode_filial (adicionado pela 169) — restaura 169
-- ═══════════════════════════════════════════════════════════════════

-- produtos.delete_produtos ← 169
DROP POLICY IF EXISTS "delete_produtos" ON public.produtos;
CREATE POLICY "delete_produtos" ON public.produtos FOR DELETE TO authenticated
  USING (auth_in_setor('compras', 'logistica') AND auth_pode_filial(filial));

-- clientes.write_clientes ← 169
DROP POLICY IF EXISTS "write_clientes" ON public.clientes;
CREATE POLICY "write_clientes" ON public.clientes FOR ALL TO authenticated
  USING (auth_in_setor('vendas', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('vendas', 'financeiro') AND auth_pode_filial(filial));

-- fornecedores.write_fornecedores ← 183 (que já era a versão pós-169 + logistica)
DROP POLICY IF EXISTS "write_fornecedores" ON public.fornecedores;
CREATE POLICY "write_fornecedores" ON public.fornecedores FOR ALL TO authenticated
  USING (auth_in_setor('compras', 'financeiro', 'logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('compras', 'financeiro', 'logistica') AND auth_pode_filial(filial));

-- servicos.write_servicos ← 184
DROP POLICY IF EXISTS "write_servicos" ON public.servicos;
CREATE POLICY "write_servicos" ON public.servicos FOR ALL TO authenticated
  USING (auth_in_setor('logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('logistica') AND auth_pode_filial(filial));

-- vendas.vendas_select / vendas_write ← 169
DROP POLICY IF EXISTS "vendas_select" ON public.vendas;
DROP POLICY IF EXISTS "vendas_write" ON public.vendas;
CREATE POLICY "vendas_select" ON public.vendas FOR SELECT TO authenticated
  USING (auth_in_setor('vendas', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "vendas_write" ON public.vendas FOR ALL TO authenticated
  USING (auth_in_setor('vendas') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('vendas') AND auth_pode_filial(filial));

-- itens_venda.itens_select / itens_write ← 169
DROP POLICY IF EXISTS "itens_select" ON public.itens_venda;
DROP POLICY IF EXISTS "itens_write" ON public.itens_venda;
CREATE POLICY "itens_select" ON public.itens_venda FOR SELECT TO authenticated USING (
  auth_in_setor('vendas', 'financeiro')
  AND EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
);
CREATE POLICY "itens_write" ON public.itens_venda FOR ALL TO authenticated
  USING (
    auth_in_setor('vendas')
    AND EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
  )
  WITH CHECK (
    auth_in_setor('vendas')
    AND EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
  );

-- contas_pagar.fin_select/fin_update/fin_delete ← 169 (fin_insert nunca foi alterado pela 185)
DROP POLICY IF EXISTS "fin_select" ON public.contas_pagar;
DROP POLICY IF EXISTS "fin_update" ON public.contas_pagar;
DROP POLICY IF EXISTS "fin_delete" ON public.contas_pagar;
CREATE POLICY "fin_select" ON public.contas_pagar FOR SELECT TO authenticated
  USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_update" ON public.contas_pagar FOR UPDATE TO authenticated
  USING (auth_in_setor('financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON public.contas_pagar FOR DELETE TO authenticated
  USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));

-- contas_receber.fin_select/fin_update/fin_delete ← 169
DROP POLICY IF EXISTS "fin_select" ON public.contas_receber;
DROP POLICY IF EXISTS "fin_update" ON public.contas_receber;
DROP POLICY IF EXISTS "fin_delete" ON public.contas_receber;
CREATE POLICY "fin_select" ON public.contas_receber FOR SELECT TO authenticated
  USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_update" ON public.contas_receber FOR UPDATE TO authenticated
  USING (auth_in_setor('financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON public.contas_receber FOR DELETE TO authenticated
  USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));

-- movimentacoes_estoque.mov_select/mov_update/mov_delete ← 169
DROP POLICY IF EXISTS "mov_select" ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_update" ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_delete" ON public.movimentacoes_estoque;
CREATE POLICY "mov_select" ON public.movimentacoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor('logistica', 'compras') AND auth_pode_filial(filial));
CREATE POLICY "mov_update" ON public.movimentacoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor('logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('logistica') AND auth_pode_filial(filial));
CREATE POLICY "mov_delete" ON public.movimentacoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor('logistica') AND auth_pode_filial(filial));

-- ═══════════════════════════════════════════════════════════════════
-- 2. Tabelas SEM auth_pode_filial (setor-only) — restaura estado 010/044/100/etc
-- ═══════════════════════════════════════════════════════════════════

-- requisicoes ← 044 (compras_select) + 100 (insert/update/delete)
DROP POLICY IF EXISTS "compras_select" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_insert" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_update" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_delete" ON public.requisicoes;
CREATE POLICY "compras_select" ON public.requisicoes FOR SELECT TO authenticated
  USING (auth_in_setor('compras', 'logistica', 'financeiro'));
CREATE POLICY "compras_insert" ON public.requisicoes FOR INSERT TO authenticated
  WITH CHECK (true);  -- qualquer setor pode pedir compra (010)
CREATE POLICY "compras_update" ON public.requisicoes FOR UPDATE TO authenticated
  USING (auth_in_setor('compras')) WITH CHECK (auth_in_setor('compras'));
CREATE POLICY "compras_delete" ON public.requisicoes FOR DELETE TO authenticated
  USING (auth_in_setor('compras'));

-- aprovacoes_compras ← 100
DROP POLICY IF EXISTS "compras_select" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_insert" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_update" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_delete" ON public.aprovacoes_compras;
CREATE POLICY "compras_select" ON public.aprovacoes_compras FOR SELECT TO authenticated
  USING (auth_in_setor('compras'));
CREATE POLICY "compras_insert" ON public.aprovacoes_compras FOR INSERT TO authenticated
  WITH CHECK (status = 'Pendente');
CREATE POLICY "compras_update" ON public.aprovacoes_compras FOR UPDATE TO authenticated
  USING (auth_in_setor('compras')) WITH CHECK (auth_in_setor('compras'));
CREATE POLICY "compras_delete" ON public.aprovacoes_compras FOR DELETE TO authenticated
  USING (auth_in_setor('compras'));

-- cotacoes ← 044
DROP POLICY IF EXISTS "cot_select" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_insert" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_update" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_delete" ON public.cotacoes;
CREATE POLICY "cot_select" ON public.cotacoes FOR SELECT TO authenticated
  USING (auth_in_setor('compras', 'logistica', 'financeiro'));
CREATE POLICY "cot_insert" ON public.cotacoes FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('compras', 'logistica'));
CREATE POLICY "cot_update" ON public.cotacoes FOR UPDATE TO authenticated
  USING      (auth_in_setor('compras', 'logistica', 'financeiro'))
  WITH CHECK (auth_in_setor('compras', 'logistica', 'financeiro'));
CREATE POLICY "cot_delete" ON public.cotacoes FOR DELETE TO authenticated
  USING (auth_in_setor('compras', 'logistica'));

-- pedidos ← 044
DROP POLICY IF EXISTS "compras_all" ON public.pedidos;
CREATE POLICY "compras_all" ON public.pedidos FOR ALL TO authenticated
  USING      (auth_in_setor('compras', 'logistica'))
  WITH CHECK (auth_in_setor('compras', 'logistica'));

-- recebimentos ← 010
DROP POLICY IF EXISTS "compras_all" ON public.recebimentos;
CREATE POLICY "compras_all" ON public.recebimentos FOR ALL TO authenticated
  USING      (auth_in_setor('compras', 'logistica'))
  WITH CHECK (auth_in_setor('compras', 'logistica'));

-- notas_recebidas ← 010
DROP POLICY IF EXISTS "compras_all" ON public.notas_recebidas;
CREATE POLICY "compras_all" ON public.notas_recebidas FOR ALL TO authenticated
  USING      (auth_in_setor('compras', 'financeiro'))
  WITH CHECK (auth_in_setor('compras', 'financeiro'));

-- requisicoes_estoque ← 010 + 100
DROP POLICY IF EXISTS "logist_select" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_insert" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON public.requisicoes_estoque;
CREATE POLICY "logist_select" ON public.requisicoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor('logistica'));
CREATE POLICY "logist_insert" ON public.requisicoes_estoque FOR INSERT TO authenticated
  WITH CHECK (true);  -- qualquer setor pode pedir (010)
CREATE POLICY "logist_update" ON public.requisicoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));
CREATE POLICY "logist_delete" ON public.requisicoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor('logistica'));

-- aprovacoes_estoque ← 100
DROP POLICY IF EXISTS "logist_select" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_insert" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON public.aprovacoes_estoque;
CREATE POLICY "logist_select" ON public.aprovacoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor('logistica'));
CREATE POLICY "logist_insert" ON public.aprovacoes_estoque FOR INSERT TO authenticated
  WITH CHECK (status = 'Pendente');
CREATE POLICY "logist_update" ON public.aprovacoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));
CREATE POLICY "logist_delete" ON public.aprovacoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor('logistica'));

-- orcamentos ← 049
DROP POLICY IF EXISTS "orc_select" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_insert" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_update" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_delete" ON public.orcamentos;
CREATE POLICY "orc_select" ON public.orcamentos FOR SELECT TO authenticated
  USING (auth_in_setor('vendas', 'financeiro'));
CREATE POLICY "orc_insert" ON public.orcamentos FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('vendas'));
CREATE POLICY "orc_update" ON public.orcamentos FOR UPDATE TO authenticated
  USING (auth_in_setor('vendas', 'financeiro'))
  WITH CHECK (auth_in_setor('vendas', 'financeiro'));
CREATE POLICY "orc_delete" ON public.orcamentos FOR DELETE TO authenticated
  USING (auth_in_setor('vendas'));

-- pedidos_venda ← 049 (pv_insert nunca foi alterado pela 185 — mantém intacto)
DROP POLICY IF EXISTS "pv_select" ON public.pedidos_venda;
DROP POLICY IF EXISTS "pv_update" ON public.pedidos_venda;
DROP POLICY IF EXISTS "pv_delete" ON public.pedidos_venda;
CREATE POLICY "pv_select" ON public.pedidos_venda FOR SELECT TO authenticated
  USING (auth_in_setor('vendas', 'logistica', 'financeiro'));
CREATE POLICY "pv_update" ON public.pedidos_venda FOR UPDATE TO authenticated
  USING (auth_in_setor('vendas', 'logistica', 'financeiro'))
  WITH CHECK (auth_in_setor('vendas', 'logistica', 'financeiro'));
CREATE POLICY "pv_delete" ON public.pedidos_venda FOR DELETE TO authenticated
  USING (auth_in_setor('vendas'));

-- marketing_campanhas ← 083 (campanhas_read nunca foi alterado — mantém intacto)
DROP POLICY IF EXISTS "campanhas_insert" ON public.marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_update" ON public.marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_delete" ON public.marketing_campanhas;
CREATE POLICY "campanhas_insert" ON public.marketing_campanhas FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing'));
CREATE POLICY "campanhas_update" ON public.marketing_campanhas FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing') OR auth_in_setor('financeiro'))
  WITH CHECK (auth_in_setor('marketing') OR auth_in_setor('financeiro'));
CREATE POLICY "campanhas_delete" ON public.marketing_campanhas FOR DELETE TO authenticated
  USING (auth_in_setor('marketing'));

-- marketing_cupons ← 083
DROP POLICY IF EXISTS "cupons_insert" ON public.marketing_cupons;
DROP POLICY IF EXISTS "cupons_update" ON public.marketing_cupons;
DROP POLICY IF EXISTS "cupons_delete" ON public.marketing_cupons;
CREATE POLICY "cupons_insert" ON public.marketing_cupons FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing'));
CREATE POLICY "cupons_update" ON public.marketing_cupons FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing'))
  WITH CHECK (auth_in_setor('marketing'));
CREATE POLICY "cupons_delete" ON public.marketing_cupons FOR DELETE TO authenticated
  USING (auth_in_setor('marketing'));

-- departamentos ← 010
DROP POLICY IF EXISTS "rh_all" ON public.departamentos;
CREATE POLICY "rh_all" ON public.departamentos FOR ALL TO authenticated
  USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));

-- cargos ← 010
DROP POLICY IF EXISTS "rh_all" ON public.cargos;
CREATE POLICY "rh_all" ON public.cargos FOR ALL TO authenticated
  USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));

-- ═══════════════════════════════════════════════════════════════════
-- 3. Drop do helper criado pela 185 (não mais usado)
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.auth_in_setor_ou_gerente(text[]);

COMMIT;
