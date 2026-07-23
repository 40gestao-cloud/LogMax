-- =================================================================
-- RPC atualizar_competicao — edita nome/descricao/datas de uma
-- competição já criada. Admin/CEO apenas. Bloqueia edição depois que
-- a competição foi encerrada (snapshot já congelado). Trigger
-- competicao_sync_ciclo_matriz cuida de propagar mudanças pro ciclo
-- da Avaliação de Filial automaticamente.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.atualizar_competicao(
  p_competicao_id uuid,
  p_nome          text,
  p_data_inicio   date,
  p_data_fim      date,
  p_descricao     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT auth_is_admin() THEN
    RAISE EXCEPTION 'Apenas admin/CEO edita competição' USING ERRCODE = '42501';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'Data fim anterior ao início' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(TRIM(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Nome obrigatório' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Competição encerrada não pode ser editada' USING ERRCODE = 'P0001';
  END IF;

  UPDATE competicoes_matriz
     SET nome        = TRIM(p_nome),
         descricao   = NULLIF(TRIM(p_descricao), ''),
         data_inicio = p_data_inicio,
         data_fim    = p_data_fim
   WHERE id = p_competicao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_competicao(uuid, text, date, date, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
