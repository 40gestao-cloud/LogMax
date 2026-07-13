-- =================================================================
-- LogMax — Gerente vê/lança/edita tudo da própria filial (v2)
-- =================================================================
-- Segunda tentativa da regra "gerente vê tudo da própria filial". A
-- primeira (185, revertida pela 186) refatorou 31 policies e MISTUROU
-- duas mudanças no mesmo lugar: (a) adicionar bypass de gerente e
-- (b) adicionar `auth_pode_filial(filial)` em tabelas que não tinham.
-- A parte (b) quebrou colaboradores e viveu 24h em produção. Esta
-- migration só faz (a).
--
-- Helper: `auth_gerente_da(p_filial)` — true se o user autenticado é
-- role='gerente' E `user_profiles.filial = p_filial`. Combina com as
-- policies existentes via OR sem alterar mais nada.
--
-- Duas categorias de policies mexidas:
--
--   1. TABELAS que já usam `AND auth_pode_filial(filial)` (169/183/184):
--      troca `auth_in_setor(X) AND auth_pode_filial(filial)` por
--      `(auth_in_setor(X) OR auth_gerente_da(filial)) AND auth_pode_filial(filial)`.
--      Colaborador do setor certo passa igual; gerente da mesma filial
--      passa via o OR novo; admin passa via auth_is_admin embutido.
--
--   2. TABELAS só com gate de setor (sem auth_pode_filial):
--      troca `auth_in_setor(X)` por `auth_in_setor(X) OR auth_gerente_da(filial)`.
--      NÃO adiciono `auth_pode_filial` (foi isso que quebrou tudo antes).
--      Colaborador do setor X continua fazendo tudo que fazia antes;
--      gerente da mesma filial ganha acesso.
--
-- Filiais: split `write_admin_empresa` em INSERT/UPDATE/DELETE — gerente
-- passa a EDITAR a linha da própria filial, mas NÃO cria nem deleta
-- outras filiais (regra: só admin/CEO administra a lista de unidades).
--
-- Fora de escopo (RH sem coluna filial): funcionarios, ferias,
-- beneficios, treinamentos, folha_pagamento, ponto_eletronico —
-- gerente de RH já cobre via `auth_in_setor('rh')`; gerente de outro
-- setor não pega esses. Isolamento por filial ali é outra tarefa.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 0. Helper ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_gerente_da(p_filial text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth_user_role() = 'gerente' AND auth_user_filial() = p_filial;
$$;

GRANT EXECUTE ON FUNCTION public.auth_gerente_da(text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Tabelas com auth_pode_filial já ativo (169/183/184)
-- ═══════════════════════════════════════════════════════════════════

-- produtos.delete_produtos ← 169 + OR gerente
DROP POLICY IF EXISTS "delete_produtos" ON public.produtos;
CREATE POLICY "delete_produtos" ON public.produtos FOR DELETE TO authenticated
  USING ((auth_in_setor('compras', 'logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- clientes.write_clientes ← 169 + OR gerente
DROP POLICY IF EXISTS "write_clientes" ON public.clientes;
CREATE POLICY "write_clientes" ON public.clientes FOR ALL TO authenticated
  USING ((auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- fornecedores.write_fornecedores ← 183 + OR gerente
DROP POLICY IF EXISTS "write_fornecedores" ON public.fornecedores;
CREATE POLICY "write_fornecedores" ON public.fornecedores FOR ALL TO authenticated
  USING ((auth_in_setor('compras', 'financeiro', 'logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('compras', 'financeiro', 'logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- servicos.write_servicos ← 184 + OR gerente
DROP POLICY IF EXISTS "write_servicos" ON public.servicos;
CREATE POLICY "write_servicos" ON public.servicos FOR ALL TO authenticated
  USING ((auth_in_setor('logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- vendas.vendas_select / vendas_write ← 169 + OR gerente
DROP POLICY IF EXISTS "vendas_select" ON public.vendas;
DROP POLICY IF EXISTS "vendas_write" ON public.vendas;
CREATE POLICY "vendas_select" ON public.vendas FOR SELECT TO authenticated
  USING ((auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));
CREATE POLICY "vendas_write" ON public.vendas FOR ALL TO authenticated
  USING ((auth_in_setor('vendas') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('vendas') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- itens_venda ← 169 + OR gerente (herda filial via vendas)
DROP POLICY IF EXISTS "itens_select" ON public.itens_venda;
DROP POLICY IF EXISTS "itens_write" ON public.itens_venda;
CREATE POLICY "itens_select" ON public.itens_venda FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.vendas v
    WHERE v.id = itens_venda.venda_id
      AND (auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(v.filial))
      AND auth_pode_filial(v.filial)
  )
);
CREATE POLICY "itens_write" ON public.itens_venda FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendas v
      WHERE v.id = itens_venda.venda_id
        AND (auth_in_setor('vendas') OR auth_gerente_da(v.filial))
        AND auth_pode_filial(v.filial)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendas v
      WHERE v.id = itens_venda.venda_id
        AND (auth_in_setor('vendas') OR auth_gerente_da(v.filial))
        AND auth_pode_filial(v.filial)
    )
  );

-- contas_pagar.fin_select/fin_update/fin_delete ← 169 + OR gerente
DROP POLICY IF EXISTS "fin_select" ON public.contas_pagar;
DROP POLICY IF EXISTS "fin_update" ON public.contas_pagar;
DROP POLICY IF EXISTS "fin_delete" ON public.contas_pagar;
CREATE POLICY "fin_select" ON public.contas_pagar FOR SELECT TO authenticated
  USING ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));
CREATE POLICY "fin_update" ON public.contas_pagar FOR UPDATE TO authenticated
  USING ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON public.contas_pagar FOR DELETE TO authenticated
  USING ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- contas_receber ← 169 + OR gerente
DROP POLICY IF EXISTS "fin_select" ON public.contas_receber;
DROP POLICY IF EXISTS "fin_update" ON public.contas_receber;
DROP POLICY IF EXISTS "fin_delete" ON public.contas_receber;
CREATE POLICY "fin_select" ON public.contas_receber FOR SELECT TO authenticated
  USING ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));
CREATE POLICY "fin_update" ON public.contas_receber FOR UPDATE TO authenticated
  USING ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON public.contas_receber FOR DELETE TO authenticated
  USING ((auth_in_setor('financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- movimentacoes_estoque ← 169 + OR gerente
DROP POLICY IF EXISTS "mov_select" ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_update" ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_delete" ON public.movimentacoes_estoque;
CREATE POLICY "mov_select" ON public.movimentacoes_estoque FOR SELECT TO authenticated
  USING ((auth_in_setor('logistica', 'compras') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));
CREATE POLICY "mov_update" ON public.movimentacoes_estoque FOR UPDATE TO authenticated
  USING ((auth_in_setor('logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));
CREATE POLICY "mov_delete" ON public.movimentacoes_estoque FOR DELETE TO authenticated
  USING ((auth_in_setor('logistica') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- ═══════════════════════════════════════════════════════════════════
-- 2. Tabelas só com gate de setor (setor OR gerente da mesma filial)
-- ═══════════════════════════════════════════════════════════════════

-- requisicoes ← 010/044/100 + OR gerente
DROP POLICY IF EXISTS "compras_select" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_update" ON public.requisicoes;
DROP POLICY IF EXISTS "compras_delete" ON public.requisicoes;
CREATE POLICY "compras_select" ON public.requisicoes FOR SELECT TO authenticated
  USING (auth_in_setor('compras', 'logistica', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "compras_update" ON public.requisicoes FOR UPDATE TO authenticated
  USING (auth_in_setor('compras') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('compras') OR auth_gerente_da(filial));
CREATE POLICY "compras_delete" ON public.requisicoes FOR DELETE TO authenticated
  USING (auth_in_setor('compras') OR auth_gerente_da(filial));
-- compras_insert já é `WITH CHECK (true)` — não muda (qualquer setor pede compra)

-- aprovacoes_compras ← 100 + OR gerente
DROP POLICY IF EXISTS "compras_select" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_update" ON public.aprovacoes_compras;
DROP POLICY IF EXISTS "compras_delete" ON public.aprovacoes_compras;
CREATE POLICY "compras_select" ON public.aprovacoes_compras FOR SELECT TO authenticated
  USING (auth_in_setor('compras') OR auth_gerente_da(filial));
CREATE POLICY "compras_update" ON public.aprovacoes_compras FOR UPDATE TO authenticated
  USING (auth_in_setor('compras') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('compras') OR auth_gerente_da(filial));
CREATE POLICY "compras_delete" ON public.aprovacoes_compras FOR DELETE TO authenticated
  USING (auth_in_setor('compras') OR auth_gerente_da(filial));
-- compras_insert já é `WITH CHECK (status = 'Pendente')` — não muda

-- cotacoes ← 044 + OR gerente
DROP POLICY IF EXISTS "cot_select" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_insert" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_update" ON public.cotacoes;
DROP POLICY IF EXISTS "cot_delete" ON public.cotacoes;
CREATE POLICY "cot_select" ON public.cotacoes FOR SELECT TO authenticated
  USING (auth_in_setor('compras', 'logistica', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "cot_insert" ON public.cotacoes FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('compras', 'logistica') OR auth_gerente_da(filial));
CREATE POLICY "cot_update" ON public.cotacoes FOR UPDATE TO authenticated
  USING      (auth_in_setor('compras', 'logistica', 'financeiro') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('compras', 'logistica', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "cot_delete" ON public.cotacoes FOR DELETE TO authenticated
  USING (auth_in_setor('compras', 'logistica') OR auth_gerente_da(filial));

-- pedidos ← 044 + OR gerente
DROP POLICY IF EXISTS "compras_all" ON public.pedidos;
CREATE POLICY "compras_all" ON public.pedidos FOR ALL TO authenticated
  USING      (auth_in_setor('compras', 'logistica') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('compras', 'logistica') OR auth_gerente_da(filial));

-- recebimentos ← 010 + OR gerente
DROP POLICY IF EXISTS "compras_all" ON public.recebimentos;
CREATE POLICY "compras_all" ON public.recebimentos FOR ALL TO authenticated
  USING      (auth_in_setor('compras', 'logistica') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('compras', 'logistica') OR auth_gerente_da(filial));

-- notas_recebidas ← 010 + OR gerente
DROP POLICY IF EXISTS "compras_all" ON public.notas_recebidas;
CREATE POLICY "compras_all" ON public.notas_recebidas FOR ALL TO authenticated
  USING      (auth_in_setor('compras', 'financeiro') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('compras', 'financeiro') OR auth_gerente_da(filial));

-- requisicoes_estoque ← 010 + OR gerente
DROP POLICY IF EXISTS "logist_select" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON public.requisicoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON public.requisicoes_estoque;
CREATE POLICY "logist_select" ON public.requisicoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor('logistica') OR auth_gerente_da(filial));
CREATE POLICY "logist_update" ON public.requisicoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor('logistica') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('logistica') OR auth_gerente_da(filial));
CREATE POLICY "logist_delete" ON public.requisicoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor('logistica') OR auth_gerente_da(filial));
-- logist_insert já é `WITH CHECK (true)` — não muda

-- aprovacoes_estoque ← 100 + OR gerente
DROP POLICY IF EXISTS "logist_select" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON public.aprovacoes_estoque;
CREATE POLICY "logist_select" ON public.aprovacoes_estoque FOR SELECT TO authenticated
  USING (auth_in_setor('logistica') OR auth_gerente_da(filial));
CREATE POLICY "logist_update" ON public.aprovacoes_estoque FOR UPDATE TO authenticated
  USING (auth_in_setor('logistica') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('logistica') OR auth_gerente_da(filial));
CREATE POLICY "logist_delete" ON public.aprovacoes_estoque FOR DELETE TO authenticated
  USING (auth_in_setor('logistica') OR auth_gerente_da(filial));
-- logist_insert já é `WITH CHECK (status = 'Pendente')` — não muda

-- orcamentos ← 049 + OR gerente
DROP POLICY IF EXISTS "orc_select" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_insert" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_update" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_delete" ON public.orcamentos;
CREATE POLICY "orc_select" ON public.orcamentos FOR SELECT TO authenticated
  USING (auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "orc_insert" ON public.orcamentos FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('vendas') OR auth_gerente_da(filial));
CREATE POLICY "orc_update" ON public.orcamentos FOR UPDATE TO authenticated
  USING (auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "orc_delete" ON public.orcamentos FOR DELETE TO authenticated
  USING (auth_in_setor('vendas') OR auth_gerente_da(filial));

-- pedidos_venda ← 049 + OR gerente (pv_insert intocado — caminho da RPC)
DROP POLICY IF EXISTS "pv_select" ON public.pedidos_venda;
DROP POLICY IF EXISTS "pv_update" ON public.pedidos_venda;
DROP POLICY IF EXISTS "pv_delete" ON public.pedidos_venda;
CREATE POLICY "pv_select" ON public.pedidos_venda FOR SELECT TO authenticated
  USING (auth_in_setor('vendas', 'logistica', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "pv_update" ON public.pedidos_venda FOR UPDATE TO authenticated
  USING (auth_in_setor('vendas', 'logistica', 'financeiro') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('vendas', 'logistica', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "pv_delete" ON public.pedidos_venda FOR DELETE TO authenticated
  USING (auth_in_setor('vendas') OR auth_gerente_da(filial));

-- marketing_campanhas ← 083 + OR gerente (campanhas_read intocado)
DROP POLICY IF EXISTS "campanhas_insert" ON public.marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_update" ON public.marketing_campanhas;
DROP POLICY IF EXISTS "campanhas_delete" ON public.marketing_campanhas;
CREATE POLICY "campanhas_insert" ON public.marketing_campanhas FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing') OR auth_gerente_da(filial));
CREATE POLICY "campanhas_update" ON public.marketing_campanhas FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial));
CREATE POLICY "campanhas_delete" ON public.marketing_campanhas FOR DELETE TO authenticated
  USING (auth_in_setor('marketing') OR auth_gerente_da(filial));

-- marketing_cupons ← 083 + OR gerente
DROP POLICY IF EXISTS "cupons_insert" ON public.marketing_cupons;
DROP POLICY IF EXISTS "cupons_update" ON public.marketing_cupons;
DROP POLICY IF EXISTS "cupons_delete" ON public.marketing_cupons;
CREATE POLICY "cupons_insert" ON public.marketing_cupons FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing') OR auth_gerente_da(filial));
CREATE POLICY "cupons_update" ON public.marketing_cupons FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('marketing') OR auth_gerente_da(filial));
CREATE POLICY "cupons_delete" ON public.marketing_cupons FOR DELETE TO authenticated
  USING (auth_in_setor('marketing') OR auth_gerente_da(filial));

-- departamentos ← 010 + OR gerente
DROP POLICY IF EXISTS "rh_all" ON public.departamentos;
CREATE POLICY "rh_all" ON public.departamentos FOR ALL TO authenticated
  USING      (auth_in_setor('rh') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('rh') OR auth_gerente_da(filial));

-- cargos ← 010 + OR gerente
DROP POLICY IF EXISTS "rh_all" ON public.cargos;
CREATE POLICY "rh_all" ON public.cargos FOR ALL TO authenticated
  USING      (auth_in_setor('rh') OR auth_gerente_da(filial))
  WITH CHECK (auth_in_setor('rh') OR auth_gerente_da(filial));

-- ═══════════════════════════════════════════════════════════════════
-- 3. filiais — gerente pode EDITAR a própria filial (INSERT/DELETE só admin)
-- ═══════════════════════════════════════════════════════════════════

-- Nicho da linha vem de detalhes->>'nicho' (padrão da 179).
-- read_filiais já cobre gerente via auth_pode_filial (179) — não mexe.
DROP POLICY IF EXISTS "write_admin_empresa" ON public.filiais;
DROP POLICY IF EXISTS "filiais_insert" ON public.filiais;
DROP POLICY IF EXISTS "filiais_update" ON public.filiais;
DROP POLICY IF EXISTS "filiais_delete" ON public.filiais;

-- INSERT: só admin/CEO/conselheiro cria filial nova
CREATE POLICY "filiais_insert" ON public.filiais FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin());

-- UPDATE: admin/CEO/conselheiro sempre; gerente só a linha da própria filial
CREATE POLICY "filiais_update" ON public.filiais FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_gerente_da(COALESCE(detalhes->>'nicho', 'Matriz')))
  WITH CHECK (auth_is_admin() OR auth_gerente_da(COALESCE(detalhes->>'nicho', 'Matriz')));

-- DELETE: só admin/CEO/conselheiro
CREATE POLICY "filiais_delete" ON public.filiais FOR DELETE TO authenticated
  USING (auth_is_admin());

COMMIT;
