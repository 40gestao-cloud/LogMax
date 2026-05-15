-- ============================================================
-- LogMax — Migração: colunas de link de propaganda em tarefas
-- Execute este script no SQL Editor do Supabase
-- ============================================================

ALTER TABLE marketing_tarefas
  ADD COLUMN IF NOT EXISTS link_propaganda text,
  ADD COLUMN IF NOT EXISTS status_link     text NOT NULL DEFAULT 'Sem Link',
  ADD COLUMN IF NOT EXISTS obs_link        text;
