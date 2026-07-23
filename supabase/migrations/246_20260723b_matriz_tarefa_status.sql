-- =================================================================
-- Tarefa da Matriz ganha status aberta/encerrada + edição.
--
-- Antes: uma tarefa só podia ser criada ou removida (soft delete). As
-- notas do conselho ficavam eternamente abertas até a competição toda
-- encerrar — dava pra alterar nota depois de "concluída" a atividade.
--
-- Agora:
--   - status text: 'aberta' | 'encerrada'
--   - encerrar_matriz_tarefa / reabrir_matriz_tarefa (admin/CEO)
--   - atualizar_matriz_tarefa (nome/descricao/data)
--   - adicionar_matriz_participante / remover_matriz_participante
--   - avaliar_item_matriz recusa nota em tarefa encerrada
--
-- Todas as edições exigem status='aberta'. Reabrir volta pra aberta.
-- Excluir (remover_matriz_tarefa) segue funcionando em qualquer status.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- 1. Colunas de status ────────────────────────────────────────────
ALTER TABLE public.matriz_tarefas
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aberta',
  ADD COLUMN IF NOT EXISTS encerrada_em timestamptz,
  ADD COLUMN IF NOT EXISTS encerrada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.matriz_tarefas
  DROP CONSTRAINT IF EXISTS matriz_tarefas_status_check;
ALTER TABLE public.matriz_tarefas
  ADD CONSTRAINT matriz_tarefas_status_check CHECK (status IN ('aberta','encerrada'));

CREATE INDEX IF NOT EXISTS idx_matriz_tarefas_status
  ON public.matriz_tarefas (competicao_id, status) WHERE ativo = true;

-- 2. Helper: valida que caller é admin/CEO na Matriz ──────────────
CREATE OR REPLACE FUNCTION public._assert_matriz_admin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_role text; v_filial text;
BEGIN
  SELECT role, filial INTO v_role, v_filial
    FROM user_profiles WHERE id = auth.uid();
  IF v_filial IS DISTINCT FROM 'Matriz' OR v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO da Matriz' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- 3. RPC atualizar_matriz_tarefa ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.atualizar_matriz_tarefa(
  p_tarefa_id uuid,
  p_nome      text,
  p_descricao text,
  p_data      date
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM _assert_matriz_admin();
  IF COALESCE(TRIM(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Nome obrigatório' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM matriz_tarefas
   WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra antes de editar' USING ERRCODE = 'P0001';
  END IF;

  UPDATE matriz_tarefas
     SET nome        = TRIM(p_nome),
         descricao   = NULLIF(TRIM(p_descricao), ''),
         data        = p_data,
         updated_at  = now()
   WHERE id = p_tarefa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_matriz_tarefa(uuid, text, text, date) TO authenticated;

-- 4. RPC encerrar / reabrir ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.encerrar_matriz_tarefa(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  PERFORM _assert_matriz_admin();
  SELECT status INTO v_status FROM matriz_tarefas
   WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN RETURN; END IF;

  UPDATE matriz_tarefas
     SET status = 'encerrada',
         encerrada_em = now(),
         encerrada_por = auth.uid(),
         updated_at = now()
   WHERE id = p_tarefa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.encerrar_matriz_tarefa(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reabrir_matriz_tarefa(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  PERFORM _assert_matriz_admin();
  SELECT status INTO v_status FROM matriz_tarefas
   WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'aberta' THEN RETURN; END IF;

  UPDATE matriz_tarefas
     SET status = 'aberta',
         encerrada_em = NULL,
         encerrada_por = NULL,
         updated_at = now()
   WHERE id = p_tarefa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reabrir_matriz_tarefa(uuid) TO authenticated;

-- 5. RPCs de participantes (admin/CEO, exige tarefa aberta) ──────
CREATE OR REPLACE FUNCTION public.adicionar_matriz_participante(
  p_tarefa_id      uuid,
  p_funcionario_id uuid,
  p_nome           text,
  p_filial         text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_id     uuid;
BEGIN
  PERFORM _assert_matriz_admin();
  IF p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Filial inválida: %', p_filial USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM matriz_tarefas
   WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra antes de mexer em participantes' USING ERRCODE = 'P0001';
  END IF;

  -- Reativar participante inativo do mesmo funcionário, se houver
  UPDATE matriz_tarefa_participantes
     SET ativo = true, nome_snapshot = COALESCE(p_nome, nome_snapshot), filial = p_filial
   WHERE tarefa_id = p_tarefa_id
     AND funcionario_id = p_funcionario_id
     AND ativo = false
   RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO matriz_tarefa_participantes (tarefa_id, funcionario_id, nome_snapshot, filial)
  VALUES (p_tarefa_id, p_funcionario_id, COALESCE(p_nome, ''), p_filial)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adicionar_matriz_participante(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remover_matriz_participante(p_participante_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tarefa uuid;
  v_status text;
BEGIN
  PERFORM _assert_matriz_admin();

  SELECT p.tarefa_id, t.status
    INTO v_tarefa, v_status
    FROM matriz_tarefa_participantes p
    JOIN matriz_tarefas t ON t.id = p.tarefa_id
   WHERE p.id = p_participante_id AND p.ativo = true AND t.ativo = true;
  IF v_tarefa IS NULL THEN
    RAISE EXCEPTION 'Participante não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra antes de mexer em participantes' USING ERRCODE = 'P0001';
  END IF;

  UPDATE matriz_tarefa_participantes SET ativo = false WHERE id = p_participante_id;
  -- Notas do conselho pra esse participante somem do placar junto
  UPDATE avaliacoes_matriz SET ativo = false
   WHERE item_id = p_participante_id
     AND item_tipo LIKE 'tarefa_%';
END;
$$;

GRANT EXECUTE ON FUNCTION public.remover_matriz_participante(uuid) TO authenticated;

-- 6. avaliar_item_matriz — recusa nota em tarefa encerrada ───────
CREATE OR REPLACE FUNCTION public.avaliar_item_matriz(
  p_competicao_id  uuid,
  p_filial_avaliada text,
  p_item_tipo      text,
  p_item_id        uuid,
  p_decisao        text DEFAULT NULL,
  p_nota           numeric DEFAULT NULL,
  p_comentario     text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role    text;
  v_filial  text;
  v_is_cons boolean;
  v_id      uuid;
  v_tstatus text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_is_cons
  FROM public.user_profiles WHERE id = v_user_id;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role = 'ceo' OR v_role = 'conselheiro' OR (v_role='gerente' AND v_is_cons))
  THEN
    RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competicoes_matriz
    WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  -- Tarefa da Matriz precisa estar aberta pra receber nota
  IF p_item_tipo LIKE 'tarefa\_%' THEN
    SELECT t.status INTO v_tstatus
      FROM matriz_tarefa_participantes p
      JOIN matriz_tarefas t ON t.id = p.tarefa_id
     WHERE p.id = p_item_id AND p.ativo = true AND t.ativo = true;
    IF v_tstatus IS NULL THEN
      RAISE EXCEPTION 'Participante ou tarefa não encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus = 'encerrada' THEN
      RAISE EXCEPTION 'Tarefa encerrada — reabra pra alterar notas' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.avaliacoes_matriz (
    competicao_id, filial_avaliada, item_tipo, item_id,
    avaliador_id, decisao, nota, comentario
  )
  VALUES (
    p_competicao_id, p_filial_avaliada, p_item_tipo, p_item_id,
    v_user_id, p_decisao, p_nota, p_comentario
  )
  ON CONFLICT (competicao_id, item_tipo, item_id, avaliador_id)
    WHERE ativo = true
  DO UPDATE SET
    decisao    = EXCLUDED.decisao,
    nota       = EXCLUDED.nota,
    comentario = EXCLUDED.comentario,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.avaliar_item_matriz(uuid,text,text,uuid,text,numeric,text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
