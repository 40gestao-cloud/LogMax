-- =================================================================
-- LogMax — RLS por filial (isolamento real de dados entre unidades)
-- =================================================================
-- Contexto: até aqui a separação entre SuperMax/MaxLook/TechMax era
-- só client-side (`.eq('filial', ...)` no front, útil pra UX mas
-- irrelevante como segurança — qualquer usuário autenticado chama o
-- Supabase direto pelo browser com a anon key e ignora o filtro).
--
-- Regra de negócio confirmada:
--   • Admin, CEO e Conselheiro (role='conselheiro' OU role='gerente'
--     AND is_conselheiro=true) → acesso a todas as filiais.
--   • Gerente comum e Colaborador → só a própria filial, sem exceção.
--
-- Esta migration:
--   1. Corrige `auth_pode_filial()` (criada em 20260608d_caixa_por_filial
--      pra controle_caixa) — hoje dá bypass incondicional pra
--      role='gerente', o que contraria a regra acima. `auth_is_admin()`
--      já cobre admin/ceo/conselheiro (ver 20260704e_conselheiro_role),
--      então o fix é só remover a cláusula de gerente. Isso também
--      corrige de graça as policies de controle_caixa/caixa_bancos que
--      já reusam essa função.
--   2. Aplica `auth_pode_filial(filial)` nas 9 tabelas centrais que só
--      tinham gate por setor: produtos, clientes, fornecedores,
--      servicos, vendas, itens_venda, contas_pagar, contas_receber,
--      movimentacoes_estoque.
--
-- Exceção deliberada: `produtos` SELECT continua aberto (`true`) —
-- sustenta o Catálogo de Produtos (feature `CatalogoProdutosView`,
-- vitrine read-only holding-wide pra todos os setores, documentada
-- como intencional). Só INSERT/UPDATE/DELETE de produtos passam a
-- exigir `auth_pode_filial(filial)`.
--
-- itens_venda não tem coluna `filial` (e não precisa ganhar uma) — a
-- policy usa EXISTS contra `vendas` pra herdar o filial da venda-pai.
--
-- Execute no Supabase SQL Editor. Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Corrige auth_pode_filial (remove bypass de gerente comum) ──
CREATE OR REPLACE FUNCTION public.auth_pode_filial(p_filial text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  -- auth_is_admin() já cobre admin, CEO e conselheiro (puro ou
  -- gerente+is_conselheiro=true) — ver 20260704e_conselheiro_role.sql.
  -- Gerente comum e colaborador só passam se for a própria filial.
  SELECT
    auth_is_admin()
    OR auth_user_filial() = p_filial;
$$;

-- ─── 2. produtos — escrita travada por filial, leitura fica aberta (catálogo) ──
DROP POLICY IF EXISTS "write_produtos"  ON produtos;
DROP POLICY IF EXISTS "update_produtos" ON produtos;
DROP POLICY IF EXISTS "delete_produtos" ON produtos;

CREATE POLICY "write_produtos"  ON produtos FOR INSERT TO authenticated WITH CHECK (auth_pode_filial(filial));
CREATE POLICY "update_produtos" ON produtos FOR UPDATE TO authenticated USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));
CREATE POLICY "delete_produtos" ON produtos FOR DELETE TO authenticated USING (auth_in_setor('compras', 'logistica') AND auth_pode_filial(filial));

-- ─── 3. clientes ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "read_authenticated" ON clientes;
DROP POLICY IF EXISTS "write_clientes"     ON clientes;

CREATE POLICY "read_clientes"  ON clientes FOR SELECT TO authenticated USING (auth_pode_filial(filial));
CREATE POLICY "write_clientes" ON clientes FOR ALL    TO authenticated
  USING (auth_in_setor('vendas', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('vendas', 'financeiro') AND auth_pode_filial(filial));

-- ─── 4. fornecedores ─────────────────────────────────────────────
DROP POLICY IF EXISTS "read_authenticated" ON fornecedores;
DROP POLICY IF EXISTS "write_fornecedores" ON fornecedores;

CREATE POLICY "read_fornecedores"  ON fornecedores FOR SELECT TO authenticated USING (auth_pode_filial(filial));
CREATE POLICY "write_fornecedores" ON fornecedores FOR ALL    TO authenticated
  USING (auth_in_setor('compras', 'financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('compras', 'financeiro') AND auth_pode_filial(filial));

-- ─── 5. servicos ─────────────────────────────────────────────────
-- write_servicos já exige auth_is_admin() (só admin/ceo/conselheiro
-- escrevem) — esses sempre passam auth_pode_filial, então só o SELECT
-- precisa do gate novo.
DROP POLICY IF EXISTS "read_authenticated" ON servicos;

CREATE POLICY "read_servicos" ON servicos FOR SELECT TO authenticated USING (auth_pode_filial(filial));

-- ─── 6. vendas ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "vendas_select" ON vendas;
DROP POLICY IF EXISTS "vendas_write"  ON vendas;

CREATE POLICY "vendas_select" ON vendas FOR SELECT TO authenticated USING (auth_in_setor('vendas', 'financeiro') AND auth_pode_filial(filial));
CREATE POLICY "vendas_write"  ON vendas FOR ALL    TO authenticated
  USING (auth_in_setor('vendas') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('vendas') AND auth_pode_filial(filial));

-- ─── 7. itens_venda — sem coluna filial própria, herda de vendas ──
DROP POLICY IF EXISTS "itens_select" ON itens_venda;
DROP POLICY IF EXISTS "itens_write"  ON itens_venda;

CREATE POLICY "itens_select" ON itens_venda FOR SELECT TO authenticated USING (
  auth_in_setor('vendas', 'financeiro')
  AND EXISTS (SELECT 1 FROM vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
);
CREATE POLICY "itens_write" ON itens_venda FOR ALL TO authenticated
  USING (
    auth_in_setor('vendas')
    AND EXISTS (SELECT 1 FROM vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
  )
  WITH CHECK (
    auth_in_setor('vendas')
    AND EXISTS (SELECT 1 FROM vendas v WHERE v.id = itens_venda.venda_id AND auth_pode_filial(v.filial))
  );

-- ─── 8. contas_pagar ─────────────────────────────────────────────
DROP POLICY IF EXISTS "fin_select" ON contas_pagar;
DROP POLICY IF EXISTS "fin_insert" ON contas_pagar;
DROP POLICY IF EXISTS "fin_update" ON contas_pagar;
DROP POLICY IF EXISTS "fin_delete" ON contas_pagar;

CREATE POLICY "fin_select" ON contas_pagar FOR SELECT TO authenticated USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_insert" ON contas_pagar FOR INSERT TO authenticated WITH CHECK (auth_pode_filial(filial));  -- cross-flow (Pedido, Folha), mas sempre da filial de quem dispara
CREATE POLICY "fin_update" ON contas_pagar FOR UPDATE TO authenticated USING (auth_in_setor('financeiro') AND auth_pode_filial(filial)) WITH CHECK (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON contas_pagar FOR DELETE TO authenticated USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));

-- ─── 9. contas_receber ───────────────────────────────────────────
DROP POLICY IF EXISTS "fin_select" ON contas_receber;
DROP POLICY IF EXISTS "fin_insert" ON contas_receber;
DROP POLICY IF EXISTS "fin_update" ON contas_receber;
DROP POLICY IF EXISTS "fin_delete" ON contas_receber;

CREATE POLICY "fin_select" ON contas_receber FOR SELECT TO authenticated USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_insert" ON contas_receber FOR INSERT TO authenticated WITH CHECK (auth_pode_filial(filial));  -- cross-flow (PDV Fiado), mas sempre da filial de quem vende
CREATE POLICY "fin_update" ON contas_receber FOR UPDATE TO authenticated USING (auth_in_setor('financeiro') AND auth_pode_filial(filial)) WITH CHECK (auth_in_setor('financeiro') AND auth_pode_filial(filial));
CREATE POLICY "fin_delete" ON contas_receber FOR DELETE TO authenticated USING (auth_in_setor('financeiro') AND auth_pode_filial(filial));

-- ─── 10. movimentacoes_estoque ───────────────────────────────────
DROP POLICY IF EXISTS "mov_select" ON movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_insert" ON movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_update" ON movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_delete" ON movimentacoes_estoque;

CREATE POLICY "mov_select" ON movimentacoes_estoque FOR SELECT TO authenticated USING (auth_in_setor('logistica', 'compras') AND auth_pode_filial(filial));
CREATE POLICY "mov_insert" ON movimentacoes_estoque FOR INSERT TO authenticated WITH CHECK (auth_pode_filial(filial));  -- PDV, Recebimento, Aprovação — sempre da filial de quem dispara
CREATE POLICY "mov_update" ON movimentacoes_estoque FOR UPDATE TO authenticated USING (auth_in_setor('logistica') AND auth_pode_filial(filial)) WITH CHECK (auth_in_setor('logistica') AND auth_pode_filial(filial));
CREATE POLICY "mov_delete" ON movimentacoes_estoque FOR DELETE TO authenticated USING (auth_in_setor('logistica') AND auth_pode_filial(filial));

COMMIT;
