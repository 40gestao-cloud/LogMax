-- =================================================================
-- LogMax — Coluna `filial` em contas_pagar e contas_receber
-- =================================================================
-- A operação multi-empresa (SuperMax, MaxLook, TechMax, Matriz) já estava
-- refletida em produtos / clientes / fornecedores / user_profiles / vendas
-- (ver 20260517_holding_filial.sql). Falta o Financeiro: as contas a pagar
-- e a receber precisam saber a qual empresa pertencem.
--
-- Default 'Matriz' nas linhas existentes — admin reatribui depois pela UI.
-- Idempotente (IF NOT EXISTS).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

ALTER TABLE contas_pagar   ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';
ALTER TABLE contas_receber ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'Matriz';

-- Índices: relatórios e dashboards costumam filtrar por filial.
CREATE INDEX IF NOT EXISTS idx_contas_pagar_filial   ON contas_pagar(filial);
CREATE INDEX IF NOT EXISTS idx_contas_receber_filial ON contas_receber(filial);

COMMIT;
