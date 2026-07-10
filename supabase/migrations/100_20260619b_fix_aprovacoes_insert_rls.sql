-- =================================================================
-- Fix: requisição criada mas não aparece em "Minhas Aprovações"
-- =================================================================
-- Causa: RequisicoesView (compras) e RequisicoesEstoqueView fazem 2
-- INSERTs em sequência — primeiro na requisição, depois na tabela
-- de aprovações pendentes.
--
-- A policy de `requisicoes` / `requisicoes_estoque` aceita INSERT de
-- qualquer setor (`WITH CHECK true` — "qualquer um pode pedir compra").
-- MAS as policies de `aprovacoes_compras` / `aprovacoes_estoque` exigem
-- `auth_in_setor('compras')` / `auth_in_setor('logistica')` no WITH CHECK
-- (eram `compras_all` / `logist_all` cobrindo SELECT+INSERT+UPDATE+DELETE).
--
-- Resultado: colaborador de setor não-compras (ou não-logistica) consegue
-- criar a requisição, mas o INSERT da aprovação é bloqueado pela RLS.
-- O `.select().single()` do `dbInsert` falha silenciosamente (single row
-- não retorna porque o INSERT foi negado), e a requisição fica órfã —
-- visível em "Requisições" mas invisível em "Minhas Aprovações" (porque
-- não há linha de aprovação para listar).
--
-- Fix:
--   1) Quebra `compras_all` (e `logist_all`) em SELECT/INSERT/UPDATE/DELETE.
--   2) Abre o INSERT pra qualquer authenticated, restrito a status='Pendente'
--      (consistente com o padrão já usado em `requisicoes`).
--   3) Aprovar/negar (UPDATE) e listar (SELECT) continuam restritos ao
--      setor responsável (compras/logistica) + admin/CEO via auth_in_setor.
--   4) Backfill: cria linha 'Pendente' em `aprovacoes_compras` /
--      `aprovacoes_estoque` para toda requisição pendente ativa que está
--      órfã.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. aprovacoes_compras ─────────────────────────────────────────
DROP POLICY IF EXISTS "compras_all"    ON aprovacoes_compras;
DROP POLICY IF EXISTS "compras_select" ON aprovacoes_compras;
DROP POLICY IF EXISTS "compras_insert" ON aprovacoes_compras;
DROP POLICY IF EXISTS "compras_update" ON aprovacoes_compras;
DROP POLICY IF EXISTS "compras_delete" ON aprovacoes_compras;

CREATE POLICY "compras_select" ON aprovacoes_compras
  FOR SELECT TO authenticated
  USING (auth_in_setor('compras'));

-- INSERT aberto: qualquer setor que pôde criar a requisição também precisa
-- criar a aprovação pendente correspondente. Restringe status='Pendente'
-- pra evitar que não-aprovador insira já como Aprovado/Negado direto.
CREATE POLICY "compras_insert" ON aprovacoes_compras
  FOR INSERT TO authenticated
  WITH CHECK (status = 'Pendente');

CREATE POLICY "compras_update" ON aprovacoes_compras
  FOR UPDATE TO authenticated
  USING (auth_in_setor('compras'))
  WITH CHECK (auth_in_setor('compras'));

CREATE POLICY "compras_delete" ON aprovacoes_compras
  FOR DELETE TO authenticated
  USING (auth_in_setor('compras'));

-- ─── 2. aprovacoes_estoque ─────────────────────────────────────────
DROP POLICY IF EXISTS "logist_all"    ON aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_select" ON aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_insert" ON aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON aprovacoes_estoque;

CREATE POLICY "logist_select" ON aprovacoes_estoque
  FOR SELECT TO authenticated
  USING (auth_in_setor('logistica'));

CREATE POLICY "logist_insert" ON aprovacoes_estoque
  FOR INSERT TO authenticated
  WITH CHECK (status = 'Pendente');

CREATE POLICY "logist_update" ON aprovacoes_estoque
  FOR UPDATE TO authenticated
  USING (auth_in_setor('logistica'))
  WITH CHECK (auth_in_setor('logistica'));

CREATE POLICY "logist_delete" ON aprovacoes_estoque
  FOR DELETE TO authenticated
  USING (auth_in_setor('logistica'));

-- ─── 3. Backfill: aprovações pendentes para requisições órfãs ──────
INSERT INTO aprovacoes_compras (requisicao_id, status)
SELECT r.id, 'Pendente'
FROM requisicoes r
LEFT JOIN aprovacoes_compras ac
  ON ac.requisicao_id = r.id AND ac.status = 'Pendente'
WHERE r.status = 'Pendente'
  AND r.ativo  = true
  AND ac.id IS NULL;

INSERT INTO aprovacoes_estoque (requisicao_estoque_id, status)
SELECT r.id, 'Pendente'
FROM requisicoes_estoque r
LEFT JOIN aprovacoes_estoque ae
  ON ae.requisicao_estoque_id = r.id AND ae.status = 'Pendente'
WHERE r.status = 'Pendente'
  AND r.ativo  = true
  AND ae.id IS NULL;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1) As policies de aprovacoes_compras agora devem ser 4 (não 1):
--    SELECT polname, cmd FROM pg_policies
--     WHERE tablename = 'aprovacoes_compras' ORDER BY polname;
--    -- compras_select (r), compras_insert (a), compras_update (w), compras_delete (d)
--
-- 2) Backfill: requisições pendentes órfãs devem ter virado 0.
--    SELECT count(*) FROM requisicoes r
--      LEFT JOIN aprovacoes_compras ac
--        ON ac.requisicao_id = r.id AND ac.status = 'Pendente'
--     WHERE r.status='Pendente' AND r.ativo=true AND ac.id IS NULL;
--    -- 0
--
-- 3) Cria uma requisição nova como colaborador qualquer e confere
--    se aparece em "Minhas Aprovações" (logado como compras/admin/CEO).
-- =================================================================
