-- =================================================================
-- RPC enviar_feedback_anonimo — caminho oficial pra inserir feedback.
--
-- O dbInsert do front (.insert(...).select().single()) exige SELECT
-- na linha inserida pra trazer ela de volta. Colaboradores não têm
-- SELECT em feedbacks_organizacao (RLS permite só admin/CEO ler).
-- Resultado: o INSERT em si passa, mas o RETURNING falha e o PostgREST
-- responde com "new row violates row-level security policy" — erro
-- misleading.
--
-- Solução: RPC SECURITY DEFINER (roda como owner, bypassa RLS) que:
--   1. valida texto >= 5 caracteres
--   2. valida categoria (whitelist)
--   3. INSERT sem retornar nada (RETURNS void)
--
-- Anonimato técnico mantido — auth.uid() não é gravado em lugar nenhum.
-- A função é GRANT EXECUTE TO authenticated, então qualquer logado chama.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION enviar_feedback_anonimo(
  p_texto     text,
  p_categoria text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_categoria text;
BEGIN
  IF p_texto IS NULL OR length(trim(p_texto)) < 5 THEN
    RAISE EXCEPTION 'Feedback muito curto (mínimo 5 caracteres).';
  END IF;

  v_categoria := NULLIF(trim(p_categoria), '');
  IF v_categoria IS NOT NULL
     AND v_categoria NOT IN ('gestao','processos','clima','comunicacao','outro') THEN
    RAISE EXCEPTION 'Categoria inválida: %', v_categoria;
  END IF;

  INSERT INTO feedbacks_organizacao (texto, categoria)
  VALUES (trim(p_texto), v_categoria);
END;
$$;

GRANT EXECUTE ON FUNCTION enviar_feedback_anonimo(text, text) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como qualquer authenticated:
--   SELECT enviar_feedback_anonimo('Sugestão de teste anônimo', 'processos');
--   -- como admin/CEO:
--   SELECT count(*) FROM feedbacks_organizacao WHERE ativo = true;
-- =================================================================
