-- =================================================================
-- 343 — Conselheiro pode excluir a PRÓPRIA avaliação de um item.
--
-- Contexto:
--   A UI passou a avaliar por modal (nota + comentário juntos) e
--   precisa de "excluir minha avaliação". Não dava pra fazer isso com
--   `avaliar_item_matriz` mandando tudo NULL: a constraint
--   `chk_algo_avaliado` (migr. 210) exige decisao OU nota OU comentario
--   preenchido, então o wipe estouraria erro.
--
--   Escrita direta na tabela também está fechada — as policies
--   aval_matriz_insert/update/delete são USING(false) desde a 210,
--   tudo passa por RPC.
--
-- Decisões:
--   • Soft delete (ativo=false), não DELETE: preserva rastro de quem
--     avaliou o quê e libera o índice único parcial
--     (competicao_id,item_tipo,item_id,avaliador_id) WHERE ativo=true
--     pra pessoa avaliar de novo depois.
--   • Só a própria linha (avaliador_id = auth.uid()). Ninguém apaga
--     avaliação alheia — nem admin, que aqui é moderador e não julga.
--   • Mesmos gates de escrita da 246: Matriz + CEO/conselheiro,
--     competição em_andamento e, pra item de tarefa, tarefa aberta.
--
-- Não altera placar: calcular_placar_competicao já filtra ativo=true,
-- então a nota removida sai da média do Top 3 na hora.
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.remover_avaliacao_matriz(
  p_competicao_id uuid,
  p_item_tipo     text,
  p_item_id       uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_role     text;
  v_filial   text;
  v_is_cons  boolean;
  v_tstatus  text;
  v_afetadas int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_is_cons
    FROM public.user_profiles WHERE id = v_user_id;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role = 'ceo' OR v_role = 'conselheiro'
             OR (v_role = 'gerente' AND COALESCE(v_is_cons, false)))
  THEN
    RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competicoes_matriz
     WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  IF p_item_tipo LIKE 'tarefa\_%' THEN
    SELECT t.status INTO v_tstatus
      FROM public.matriz_tarefa_participantes p
      JOIN public.matriz_tarefas t ON t.id = p.tarefa_id
     WHERE p.id = p_item_id AND p.ativo = true AND t.ativo = true;
    IF v_tstatus IS NULL THEN
      RAISE EXCEPTION 'Participante ou tarefa não encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus = 'encerrada' THEN
      RAISE EXCEPTION 'Tarefa encerrada — reabra pra alterar notas' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.avaliacoes_matriz
     SET ativo = false, updated_at = now()
   WHERE competicao_id = p_competicao_id
     AND item_tipo     = p_item_tipo
     AND item_id       = p_item_id
     AND avaliador_id  = v_user_id
     AND ativo         = true;

  GET DIAGNOSTICS v_afetadas = ROW_COUNT;
  IF v_afetadas = 0 THEN
    RAISE EXCEPTION 'Você não tem avaliação registrada neste item' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remover_avaliacao_matriz(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remover_avaliacao_matriz(uuid, text, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
