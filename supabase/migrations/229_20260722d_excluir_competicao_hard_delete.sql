-- =================================================================
-- excluir_competicao_matriz vira HARD DELETE.
--
-- Antes (migr. 219): soft-delete (ativo=false). Só que competições
-- inativas ficavam para sempre no banco ocupando espaço + poluindo
-- consultas. Como o botão "Excluir" na UI é usado só pra descartar
-- testes, faz mais sentido apagar de verdade — inclusive as tabelas
-- filhas (avaliacoes_matriz, competicao_votos, matriz_tarefas).
--
-- Também limpa as competições já soft-deletadas antes desta migração
-- (não fica lixo residual).
--
-- Idempotente (CREATE OR REPLACE + DELETE condicional).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.excluir_competicao_matriz(
  p_competicao_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existe boolean;
BEGIN
  IF auth_user_role() NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO pode excluir competição' USING ERRCODE = '42501';
  END IF;

  SELECT true INTO v_existe FROM competicoes_matriz WHERE id = p_competicao_id;
  IF v_existe IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM avaliacoes_matriz  WHERE competicao_id = p_competicao_id;
  DELETE FROM competicao_votos   WHERE competicao_id = p_competicao_id;
  DELETE FROM matriz_tarefas     WHERE competicao_id = p_competicao_id;
  DELETE FROM competicoes_matriz WHERE id = p_competicao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_competicao_matriz(uuid) TO authenticated;

-- Faxina: apaga tudo que já estava soft-deletado (ativo=false) + filhos.
DELETE FROM avaliacoes_matriz  WHERE competicao_id IN (SELECT id FROM competicoes_matriz WHERE ativo = false);
DELETE FROM competicao_votos   WHERE competicao_id IN (SELECT id FROM competicoes_matriz WHERE ativo = false);
DELETE FROM matriz_tarefas     WHERE competicao_id IN (SELECT id FROM competicoes_matriz WHERE ativo = false);
DELETE FROM competicoes_matriz WHERE ativo = false;

COMMIT;

NOTIFY pgrst, 'reload schema';
