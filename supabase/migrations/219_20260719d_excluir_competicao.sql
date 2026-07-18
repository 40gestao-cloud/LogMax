-- =================================================================
-- RPC excluir_competicao_matriz — admin/CEO apagam competição de teste.
--
-- Contexto: Central de Avaliação + Competição rodaram testes em produção
-- (turma usa dados reais). Sem forma de descartar uma competição criada
-- por engano ou só pra testar o fluxo — soft-delete (ativo=false),
-- mesmo padrão de encerrar_competicao_agora. Libera o slot único de
-- "em_andamento" pra criar a próxima de verdade.
--
-- Não cascateia pra avaliacoes_matriz/matriz_tarefas/competicao_votos:
-- essas tabelas só aparecem escopadas por competicao_id de uma
-- competição ativa, então ficam órfãs mas invisíveis (mesmo padrão já
-- aceito noutros soft-deletes do módulo).
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.excluir_competicao_matriz(
  p_competicao_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  -- Mesma régua de encerrar_competicao_agora: admin/CEO puros.
  IF auth_user_role() NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO pode excluir competição' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  UPDATE competicoes_matriz
     SET ativo = false, updated_at = now()
   WHERE id = p_competicao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_competicao_matriz(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- Como admin/CEO:
--   SELECT excluir_competicao_matriz('<id-da-competicao-de-teste>');
--   -- some da lista (carregarLista filtra .eq('ativo', true))
-- =================================================================
