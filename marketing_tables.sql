-- ============================================================
-- LogMax — Módulo de Marketing
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- Tabela: propostas de preço promocional (Marketing → Financeiro)
CREATE TABLE IF NOT EXISTS marketing_promocoes (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id        uuid        REFERENCES produtos(id) ON DELETE SET NULL,
  nome_produto      text        NOT NULL,
  preco_atual       numeric(12,2) NOT NULL DEFAULT 0,
  preco_custo       numeric(12,2) NOT NULL DEFAULT 0,
  preco_promocional numeric(12,2) NOT NULL,
  data_inicio       date,
  data_fim          date,
  descricao         text,
  status            text        NOT NULL DEFAULT 'Aguardando Aprovação',
  observacao        text,
  nome_criador      text,
  criado_por        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);

-- Tabela: tarefas de marketing (Admin cria, time executa)
CREATE TABLE IF NOT EXISTS marketing_tarefas (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo       text        NOT NULL,
  descricao    text,
  prioridade   text        NOT NULL DEFAULT 'Média',
  prazo        date,
  status       text        NOT NULL DEFAULT 'Pendente',
  nome_criador text,
  criado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);

-- RLS: apenas usuários autenticados podem operar
ALTER TABLE marketing_promocoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_tarefas   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketing_promocoes_auth"
  ON marketing_promocoes FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "marketing_tarefas_auth"
  ON marketing_tarefas FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);
