-- =================================================================
-- LogMax — Marketing: Calendário Editorial
-- =================================================================
-- Agenda de posts: cada linha é uma peça planejada pra publicar num
-- canal específico (Instagram Feed, Status, WhatsApp, Facebook, etc.),
-- numa data, atribuída a um responsável, com fluxo de status:
--
--   Rascunho → Agendado → Publicado
--                       ↘ Cancelado
--
-- Diferente de `marketing_tarefas` (que é briefing/produção) e de
-- `marketing_promocoes` (que é desconto sobre produto), o calendário é
-- planejamento editorial puro: o quê, onde, quando, quem.
--
-- Vinculação opcional a uma promoção: quando o post divulga uma campanha
-- ativa, `promocao_id` aponta pra ela e a UI pode pre-fill o conteúdo.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS marketing_calendario (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text        NOT NULL,
  -- Canal de divulgação. CHECK aberto pra permitir adicionar 'TikTok',
  -- 'YouTube Shorts' etc. sem migração — a UI normaliza os valores via
  -- dropdown e o servidor aceita qualquer string não-vazia.
  canal           text        NOT NULL,
  -- Data + hora de publicação. timestamptz pra que o calendário respeite
  -- o fuso do Acre nas conversões.
  data_post       timestamptz NOT NULL,
  -- Responsável é livre — o gerente pode atribuir a qualquer membro do
  -- time. Quando o autor da peça é o próprio criador, o cliente passa
  -- nome_responsavel = nome do criador.
  responsavel_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_responsavel text,
  status          text        NOT NULL DEFAULT 'Rascunho',
  conteudo        text,
  link_arte       text,
  -- Vinculação opcional a promoção (snapshot leve via FK).
  promocao_id     uuid        REFERENCES marketing_promocoes(id) ON DELETE SET NULL,
  -- Audit
  nome_criador    text,
  criado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ativo           boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_calendario_status CHECK (status IN ('Rascunho','Agendado','Publicado','Cancelado')),
  CONSTRAINT chk_calendario_canal_nao_vazio CHECK (length(trim(canal)) > 0),
  CONSTRAINT chk_calendario_link_format
    CHECK (link_arte IS NULL OR link_arte ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_calendario_data_post   ON marketing_calendario(data_post) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_calendario_canal       ON marketing_calendario(canal)     WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_calendario_status      ON marketing_calendario(status)    WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_calendario_responsavel ON marketing_calendario(responsavel_id) WHERE responsavel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendario_created_at  ON marketing_calendario(created_at DESC);

CREATE OR REPLACE FUNCTION trg_marketing_calendario_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_calendario_updated_at ON marketing_calendario;
CREATE TRIGGER marketing_calendario_updated_at
  BEFORE UPDATE ON marketing_calendario
  FOR EACH ROW EXECUTE FUNCTION trg_marketing_calendario_updated_at();

ALTER TABLE marketing_calendario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendario_read"   ON marketing_calendario;
DROP POLICY IF EXISTS "calendario_insert" ON marketing_calendario;
DROP POLICY IF EXISTS "calendario_update" ON marketing_calendario;
DROP POLICY IF EXISTS "calendario_delete" ON marketing_calendario;

-- Read: todos autenticados podem ver o calendário (RH/Financeiro tb se
-- benefíciam de saber quando algo vai pro ar — facilita coordenação).
CREATE POLICY "calendario_read" ON marketing_calendario
  FOR SELECT TO authenticated USING (true);

-- Write: marketing + admin/CEO. Responsável pode atualizar o próprio
-- registro pra avançar status (ex.: marcar como Publicado).
CREATE POLICY "calendario_insert" ON marketing_calendario
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "calendario_update" ON marketing_calendario
  FOR UPDATE TO authenticated
  USING (
    auth_in_setor('marketing')
    OR responsavel_id = auth.uid()
  )
  WITH CHECK (
    auth_in_setor('marketing')
    OR responsavel_id = auth.uid()
  );

CREATE POLICY "calendario_delete" ON marketing_calendario
  FOR DELETE TO authenticated
  USING (auth_in_setor('marketing'));

-- Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_calendario'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_calendario;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT count(*) FROM marketing_calendario;
--   -- como gerente de marketing:
--   --   INSERT INTO marketing_calendario (titulo, canal, data_post)
--   --     VALUES ('Post lançamento', 'Instagram Feed', '2026-06-20 18:00-05');
-- =================================================================
