-- =================================================================
-- LogMax — Artes de Promoção + Feedback por Setor
-- =================================================================
-- Marketing publica o link da arte (Canva, Drive, etc.) numa promoção
-- aprovada e envia para os demais setores. Gerentes + admin/CEO de
-- qualquer setor podem dar feedback (estrelas 1-5 + comentário opcional).
--
-- Tabelas:
--   - marketing_artes              : 1 arte por promoção (UNIQUE), substituível
--   - marketing_arte_feedback      : 1 feedback por usuário por arte (UPSERT)
--
-- Reaplica idempotentemente. Pré-requisitos:
--   - auth_user_role(), auth_user_setor(), auth_is_admin(), auth_in_setor()
--     (criados em 20260516_rls_hardening.sql)
--   - notificar_setor() (criado em 20260520_ti_e_notificacoes.sql)
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabela: marketing_artes
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_artes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id         uuid NOT NULL UNIQUE REFERENCES marketing_promocoes(id) ON DELETE CASCADE,
  -- Snapshots denormalizados pra que setores sem acesso a marketing_promocoes
  -- consigam ler o card da arte sem JOIN.
  nome_produto        text NOT NULL,
  descricao_promocao  text,
  preco_promocional   numeric(12,2),
  data_inicio         date,
  data_fim            date,
  -- Conteúdo
  arte_url            text NOT NULL,
  publicada_em        timestamptz NOT NULL DEFAULT now(),
  publicada_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_publicador     text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_arte_url_format CHECK (arte_url ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_artes_promocao_id   ON marketing_artes(promocao_id);
CREATE INDEX IF NOT EXISTS idx_artes_publicada_em  ON marketing_artes(publicada_em DESC);

-- Trigger pra atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION trg_marketing_artes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_artes_updated_at ON marketing_artes;
CREATE TRIGGER marketing_artes_updated_at
  BEFORE UPDATE ON marketing_artes
  FOR EACH ROW EXECUTE FUNCTION trg_marketing_artes_updated_at();

ALTER TABLE marketing_artes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "artes_read"   ON marketing_artes;
DROP POLICY IF EXISTS "artes_insert" ON marketing_artes;
DROP POLICY IF EXISTS "artes_update" ON marketing_artes;
DROP POLICY IF EXISTS "artes_delete" ON marketing_artes;

-- Read: todos os autenticados podem ver artes publicadas (gallery).
CREATE POLICY "artes_read" ON marketing_artes
  FOR SELECT TO authenticated USING (true);

-- Write: marketing + admin/CEO (auth_in_setor já dá admin pass-through).
CREATE POLICY "artes_insert" ON marketing_artes
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "artes_update" ON marketing_artes
  FOR UPDATE TO authenticated
  USING (auth_in_setor('marketing'))
  WITH CHECK (auth_in_setor('marketing'));

CREATE POLICY "artes_delete" ON marketing_artes
  FOR DELETE TO authenticated
  USING (auth_in_setor('marketing'));

-- ─────────────────────────────────────────────
-- 2. Tabela: marketing_arte_feedback
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_arte_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arte_id       uuid NOT NULL REFERENCES marketing_artes(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setor         text NOT NULL,
  role          text NOT NULL,
  nome_user     text,
  estrelas      smallint NOT NULL,
  comentario    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feedback_estrelas CHECK (estrelas BETWEEN 1 AND 5),
  CONSTRAINT chk_feedback_role     CHECK (role IN ('gerente','admin','ceo')),
  CONSTRAINT uq_feedback_arte_user UNIQUE (arte_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_arte_feedback_arte    ON marketing_arte_feedback(arte_id);
CREATE INDEX IF NOT EXISTS idx_arte_feedback_setor   ON marketing_arte_feedback(setor);
CREATE INDEX IF NOT EXISTS idx_arte_feedback_created ON marketing_arte_feedback(created_at DESC);

CREATE OR REPLACE FUNCTION trg_marketing_arte_feedback_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_arte_feedback_updated_at ON marketing_arte_feedback;
CREATE TRIGGER marketing_arte_feedback_updated_at
  BEFORE UPDATE ON marketing_arte_feedback
  FOR EACH ROW EXECUTE FUNCTION trg_marketing_arte_feedback_updated_at();

ALTER TABLE marketing_arte_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_read"   ON marketing_arte_feedback;
DROP POLICY IF EXISTS "feedback_insert" ON marketing_arte_feedback;
DROP POLICY IF EXISTS "feedback_update" ON marketing_arte_feedback;
DROP POLICY IF EXISTS "feedback_delete" ON marketing_arte_feedback;

-- Read: todos os autenticados veem (transparência inter-setores).
CREATE POLICY "feedback_read" ON marketing_arte_feedback
  FOR SELECT TO authenticated USING (true);

-- Insert: apenas gerente, admin ou CEO podem dar feedback, e o feedback
-- precisa ser do próprio usuário (auth.uid()).
CREATE POLICY "feedback_insert" ON marketing_arte_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND auth_user_role() IN ('gerente','admin','ceo')
  );

-- Update: somente o autor pode editar o próprio feedback.
CREATE POLICY "feedback_update" ON marketing_arte_feedback
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR auth_is_admin())
  WITH CHECK (user_id = auth.uid() OR auth_is_admin());

-- Delete: autor ou admin.
CREATE POLICY "feedback_delete" ON marketing_arte_feedback
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR auth_is_admin());

-- ─────────────────────────────────────────────
-- 3. RPC helper para upsert de feedback (idempotente)
-- ─────────────────────────────────────────────
-- Resolve setor/role/nome do profile no servidor para não confiar no cliente.
CREATE OR REPLACE FUNCTION dar_feedback_arte(
  p_arte_id    uuid,
  p_estrelas   integer,
  p_comentario text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_setor   text := auth_user_setor();
  v_role    text := auth_user_role();
  v_nome    text;
  v_id      uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF v_role NOT IN ('gerente','admin','ceo') THEN
    RAISE EXCEPTION 'Apenas gerentes, admin ou CEO podem dar feedback (role atual: %)', v_role;
  END IF;
  IF p_estrelas IS NULL OR p_estrelas NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Estrelas precisa estar entre 1 e 5';
  END IF;

  -- Tabela de perfis no LogMax é `user_profiles` (não `profiles`).
  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_user_id;

  INSERT INTO marketing_arte_feedback (
    arte_id, user_id, setor, role, nome_user, estrelas, comentario
  ) VALUES (
    p_arte_id, v_user_id, v_setor, v_role, v_nome, p_estrelas::smallint, p_comentario
  )
  ON CONFLICT (arte_id, user_id) DO UPDATE
    SET estrelas   = EXCLUDED.estrelas,
        comentario = EXCLUDED.comentario,
        -- Atualiza setor/role/nome no caso de o autor ter mudado de cargo
        -- entre o primeiro feedback e a edição atual.
        setor      = EXCLUDED.setor,
        role       = EXCLUDED.role,
        nome_user  = EXCLUDED.nome_user
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Remove assinaturas antigas (smallint) caso o script tenha sido aplicado
-- em projeto que rodou versão anterior — evita ambiguidade de overload.
DROP FUNCTION IF EXISTS dar_feedback_arte(uuid, smallint, text);
GRANT EXECUTE ON FUNCTION dar_feedback_arte(uuid, integer, text) TO authenticated;

-- ─────────────────────────────────────────────
-- 4. Trigger: limpa arte quando promoção é inativada (soft-delete)
-- ─────────────────────────────────────────────
-- O FK marketing_artes.promocao_id é ON DELETE CASCADE, mas o LogMax usa
-- soft delete (UPDATE ativo=false) em vez de DELETE. Sem este trigger, a
-- arte permanece visível na galeria mesmo após a promoção ter sido
-- "removida" no UI do marketing. Trigger só dispara na transição
-- true → false; reativação não recria a arte (já apagada).

CREATE OR REPLACE FUNCTION trg_marketing_promocoes_soft_delete_arte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.ativo = true AND NEW.ativo = false THEN
    DELETE FROM marketing_artes WHERE promocao_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_promocoes_soft_delete_arte ON marketing_promocoes;
CREATE TRIGGER marketing_promocoes_soft_delete_arte
  AFTER UPDATE OF ativo ON marketing_promocoes
  FOR EACH ROW EXECUTE FUNCTION trg_marketing_promocoes_soft_delete_arte();

-- ─────────────────────────────────────────────
-- 5. Realtime publication (sincroniza UI de marketing com feedback novo)
-- ─────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_artes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_artes;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketing_arte_feedback'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketing_arte_feedback;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT count(*) FROM marketing_artes;
--   -- enquanto logado como gerente:
--   -- SELECT dar_feedback_arte('<arte-id>', 5, 'Ficou ótima!');
-- =================================================================
