-- ============================================================
-- LogMax — Tabela genérica de Tarefas (por módulo)
-- Execute este script no SQL Editor do Supabase
-- ============================================================
--
-- Submódulo "Tarefas" disponível em cada um dos módulos:
--   empresa, compras, estoque, financeiro, rh, vendas
--
-- Admin e CEO criam/excluem; demais usuários do setor avançam status.
-- Marketing permanece em marketing_tarefas (mantém link de propaganda).
-- ============================================================

CREATE TABLE IF NOT EXISTS tarefas (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  modulo       text        NOT NULL
                 CHECK (modulo IN ('empresa','compras','estoque','financeiro','rh','vendas')),
  titulo       text        NOT NULL,
  descricao    text,
  prioridade   text        NOT NULL DEFAULT 'Média'
                 CHECK (prioridade IN ('Alta','Média','Baixa')),
  prazo        date,
  status       text        NOT NULL DEFAULT 'Pendente'
                 CHECK (status IN ('Pendente','Ciente','Em Andamento','Concluído')),
  nome_criador text,
  criado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tarefas_modulo_idx     ON tarefas (modulo);
CREATE INDEX IF NOT EXISTS tarefas_status_idx     ON tarefas (status);
CREATE INDEX IF NOT EXISTS tarefas_created_at_idx ON tarefas (created_at DESC);

ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tarefas_auth" ON tarefas;
CREATE POLICY "tarefas_auth"
  ON tarefas FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);
