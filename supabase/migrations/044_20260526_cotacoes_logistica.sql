-- =================================================================
-- Cotações e Pedidos: Logística entra como par operacional de Compras.
--
-- Contexto:
--   `SETOR_MODS.logistica` na home já inclui 'compras' (Requisições +
--   Pedidos aparecem como acesso rápido pra Logística). Recebimentos e
--   movimentações de estoque já são compartilhados via
--   `auth_in_setor('compras','logistica')`. Cotações e pedidos ficaram
--   amarrados só a 'compras', o que escondia o botão "Nova Cotação"
--   pra Logística (e o INSERT teria sido bloqueado pelo RLS de qualquer
--   forma).
--
-- Mudança:
--   - cotacoes: INSERT/UPDATE/DELETE passam a aceitar 'logistica'
--     além de 'compras' (UPDATE também mantém 'financeiro' pro fluxo
--     de aprovação). SELECT ganha 'logistica' além de 'compras' e
--     'financeiro'.
--   - pedidos: policy `compras_all` passa a aceitar 'logistica'.
--   - requisicoes: SELECT (`compras_select`) ganha 'logistica' pra que
--     Logística consiga listar requisições aprovadas ao criar cotação.
--     UPDATE/DELETE ficam restritos a 'compras' (fluxo de aprovação
--     da requisição permanece responsabilidade do gerente de Compras).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. cotacoes
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cot_select" ON cotacoes;
DROP POLICY IF EXISTS "cot_insert" ON cotacoes;
DROP POLICY IF EXISTS "cot_update" ON cotacoes;
DROP POLICY IF EXISTS "cot_delete" ON cotacoes;

CREATE POLICY "cot_select" ON cotacoes
  FOR SELECT TO authenticated
  USING (auth_in_setor('compras', 'logistica', 'financeiro'));

CREATE POLICY "cot_insert" ON cotacoes
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('compras', 'logistica'));

CREATE POLICY "cot_update" ON cotacoes
  FOR UPDATE TO authenticated
  USING      (auth_in_setor('compras', 'logistica', 'financeiro'))
  WITH CHECK (auth_in_setor('compras', 'logistica', 'financeiro'));

CREATE POLICY "cot_delete" ON cotacoes
  FOR DELETE TO authenticated
  USING (auth_in_setor('compras', 'logistica'));

-- ─────────────────────────────────────────────────────────────────
-- 2. pedidos — Logística gera pedido a partir de cotação aprovada.
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "compras_all" ON pedidos;
CREATE POLICY "compras_all" ON pedidos
  FOR ALL TO authenticated
  USING      (auth_in_setor('compras', 'logistica'))
  WITH CHECK (auth_in_setor('compras', 'logistica'));

-- ─────────────────────────────────────────────────────────────────
-- 3. requisicoes — Logística precisa SELECT pra listar aprovadas
--    no formulário de Nova Cotação. UPDATE/DELETE seguem com Compras.
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "compras_select" ON requisicoes;
CREATE POLICY "compras_select" ON requisicoes
  FOR SELECT TO authenticated
  USING (auth_in_setor('compras', 'logistica', 'financeiro'));

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como usuário com setor='logistica':
--   SELECT auth_in_setor('compras','logistica');  -- true
--   -- consegue criar:
--   INSERT INTO cotacoes (requisicao_id, fornecedor_id, valor, prazo, status)
--     VALUES (...) RETURNING id;
--   -- consegue gerar pedido a partir de cotação aprovada:
--   INSERT INTO pedidos (cotacao_id, ...) VALUES (...);
-- =================================================================
