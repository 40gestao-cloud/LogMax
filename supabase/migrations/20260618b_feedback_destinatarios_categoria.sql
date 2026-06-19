-- =================================================================
-- Feedback Organizacional — destinatários por role + categoria obrigatória
-- =================================================================
-- Refino do canal:
--   1. `destinatarios_roles text[]`   — quem deve receber. Subconjunto
--      de {'ceo','gerente','colaborador'}. NOT NULL com CHECK de não-vazio.
--   2. `categoria` passa a ser NOT NULL (antes opcional).
--   3. RLS SELECT amplia: além de admin/CEO, qualquer usuário lê os
--      feedbacks endereçados à sua role (auth_user_role()). Anonimato
--      preservado — o que muda é a caixa de entrada, não a autoria.
--   4. RPC `enviar_feedback_anonimo` ganha p_destinatarios_roles e
--      passa a exigir categoria.
--
-- Backfill: linhas antigas (todas direcionadas implicitamente a admin/CEO)
-- recebem destinatarios_roles = ARRAY['ceo'] e categoria 'outro' se NULL.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Schema
-- ─────────────────────────────────────────────

ALTER TABLE feedbacks_organizacao
  ADD COLUMN IF NOT EXISTS destinatarios_roles text[];

-- Backfill antes de aplicar NOT NULL.
UPDATE feedbacks_organizacao
   SET destinatarios_roles = ARRAY['ceo']
 WHERE destinatarios_roles IS NULL;

UPDATE feedbacks_organizacao
   SET categoria = 'outro'
 WHERE categoria IS NULL;

-- Constraints. DROP IF EXISTS pra re-aplicação idempotente sem CONFLICT.
ALTER TABLE feedbacks_organizacao
  ALTER COLUMN destinatarios_roles SET NOT NULL,
  ALTER COLUMN destinatarios_roles SET DEFAULT '{}',
  ALTER COLUMN categoria SET NOT NULL;

ALTER TABLE feedbacks_organizacao
  DROP CONSTRAINT IF EXISTS chk_feedback_destinatarios;
ALTER TABLE feedbacks_organizacao
  ADD CONSTRAINT chk_feedback_destinatarios CHECK (
    cardinality(destinatarios_roles) > 0
    AND destinatarios_roles <@ ARRAY['ceo','gerente','colaborador']
  );

CREATE INDEX IF NOT EXISTS idx_feedbacks_org_destinatarios
  ON feedbacks_organizacao USING GIN (destinatarios_roles);

-- ─────────────────────────────────────────────
-- 2. RLS — leitura inclui destinatário pela role
-- ─────────────────────────────────────────────

DROP POLICY IF EXISTS "feedback_org_select" ON feedbacks_organizacao;

CREATE POLICY "feedback_org_select" ON feedbacks_organizacao
  FOR SELECT TO authenticated
  USING (
    auth_user_role() IN ('admin','ceo')
    OR auth_user_role() = ANY (destinatarios_roles)
  );

-- ─────────────────────────────────────────────
-- 3. RPC atualizada
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS enviar_feedback_anonimo(text, text);

CREATE OR REPLACE FUNCTION enviar_feedback_anonimo(
  p_texto                text,
  p_categoria            text,
  p_destinatarios_roles  text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_categoria text;
  v_dest      text[];
BEGIN
  IF p_texto IS NULL OR length(trim(p_texto)) < 5 THEN
    RAISE EXCEPTION 'Feedback muito curto (mínimo 5 caracteres).';
  END IF;

  v_categoria := NULLIF(trim(p_categoria), '');
  IF v_categoria IS NULL THEN
    RAISE EXCEPTION 'Categoria é obrigatória.';
  END IF;
  IF v_categoria NOT IN ('gestao','processos','clima','comunicacao','outro') THEN
    RAISE EXCEPTION 'Categoria inválida: %', v_categoria;
  END IF;

  -- Normaliza: remove duplicatas e valores inválidos.
  SELECT array_agg(DISTINCT r) INTO v_dest
    FROM unnest(p_destinatarios_roles) r
   WHERE r IN ('ceo','gerente','colaborador');

  IF v_dest IS NULL OR cardinality(v_dest) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um destinatário (CEO, Gerente ou Colaborador).';
  END IF;

  INSERT INTO feedbacks_organizacao (texto, categoria, destinatarios_roles)
  VALUES (trim(p_texto), v_categoria, v_dest);
END;
$$;

GRANT EXECUTE ON FUNCTION enviar_feedback_anonimo(text, text, text[]) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT enviar_feedback_anonimo(
--     'Sugestão de teste direcionada',
--     'processos',
--     ARRAY['ceo','gerente']
--   );
--   -- como gerente: vê o feedback acima
--   SELECT id, categoria, destinatarios_roles FROM feedbacks_organizacao
--    WHERE ativo = true ORDER BY created_at DESC LIMIT 3;
-- =================================================================
