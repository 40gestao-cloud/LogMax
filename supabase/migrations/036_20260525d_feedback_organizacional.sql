-- =================================================================
-- Feedback Organizacional Anônimo.
--
-- Canal livre pra colaboradores e gerentes mandarem feedback à diretoria.
-- Apenas admin/CEO leem; quem envia não fica registrado em lugar nenhum
-- (anonimato técnico — não há coluna autor_id).
--
-- Diferente do `feedback_colaborador` em `avaliacoes` (que é tipado, ligado
-- a uma avaliação específica de uma pessoa, e tem o vínculo do avaliador
-- preservado pra anti-spam). Este é um "caixinha de sugestões" cross-cutting.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS feedbacks_organizacao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  texto       text NOT NULL,
  categoria   text,                                  -- 'gestao','processos','clima','comunicacao','outro' (NULL = sem categoria)
  ativo       boolean NOT NULL DEFAULT true,         -- soft-delete (padrão do projeto)
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT chk_feedback_texto_nao_vazio CHECK (length(trim(texto)) >= 5),
  CONSTRAINT chk_feedback_categoria CHECK (
    categoria IS NULL OR categoria IN ('gestao','processos','clima','comunicacao','outro')
  )
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_org_created_at ON feedbacks_organizacao(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_org_categoria  ON feedbacks_organizacao(categoria) WHERE categoria IS NOT NULL;

ALTER TABLE feedbacks_organizacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_org_insert" ON feedbacks_organizacao;
DROP POLICY IF EXISTS "feedback_org_select" ON feedbacks_organizacao;
DROP POLICY IF EXISTS "feedback_org_modify" ON feedbacks_organizacao;
DROP POLICY IF EXISTS "feedback_org_delete" ON feedbacks_organizacao;

-- Qualquer usuário autenticado pode enviar. Sem WHERE — o sistema não
-- conhece a identidade do autor (não há autor_id no schema).
CREATE POLICY "feedback_org_insert" ON feedbacks_organizacao
  FOR INSERT TO authenticated WITH CHECK (true);

-- Só admin/CEO leem.
CREATE POLICY "feedback_org_select" ON feedbacks_organizacao
  FOR SELECT TO authenticated
  USING (auth_user_role() IN ('admin', 'ceo'));

-- Só admin pode soft-delete (moderação de feedback abusivo).
CREATE POLICY "feedback_org_modify" ON feedbacks_organizacao
  FOR UPDATE TO authenticated
  USING (auth_is_admin())
  WITH CHECK (auth_is_admin());

-- Hard delete bloqueado pra preservar histórico (use soft-delete via UPDATE ativo=false).
CREATE POLICY "feedback_org_delete" ON feedbacks_organizacao
  FOR DELETE TO authenticated USING (false);

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como colaborador: INSERT deve funcionar
--   INSERT INTO feedbacks_organizacao (texto, categoria)
--     VALUES ('Sugestão de teste', 'processos');
--
--   -- como admin/CEO: SELECT retorna tudo
--   SELECT * FROM feedbacks_organizacao WHERE ativo = true;
--
--   -- como colaborador: SELECT volta vazio (RLS bloqueia)
-- =================================================================
