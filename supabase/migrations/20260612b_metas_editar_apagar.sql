-- =================================================================
-- Metas estratégicas — editar + apagar (soft-delete cascade)
-- =================================================================
-- Reqs:
--   • Admin/CEO devem poder editar uma meta criada (corrigir descrição,
--     setor, valores, datas) enquanto a meta ainda está Ativa.
--   • Admin/CEO devem poder apagar uma meta criada — o soft-delete
--     CASCATEIA pras tarefas táticas vinculadas (que os gerentes criaram),
--     pra elas sumirem da UI junto.
--   • Bloqueia se a meta já distribuiu bonificação (status='Concluida') ou
--     se alguma tarefa tática vinculada já foi aprovada (já creditou
--     carteira). Nesses casos o caminho é "Cancelar" (sem soft-delete).
--
-- IDEMPOTENTE. Rodar APÓS 20260608e_metas_estrategicas_taticas.sql.
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- editar_meta_estrategica
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_meta_estrategica(
  p_meta_id                       uuid,
  p_descricao                     text,
  p_setor                         text,   -- '' ou NULL = todos
  p_bonificacao_equipe            numeric,
  p_limite_bonificacao_individual numeric,
  p_data_inicio                   date,
  p_data_fim                      date
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO podem editar metas estratégicas.';
  END IF;

  SELECT status INTO v_status FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo, true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  IF v_status <> 'Ativa' THEN
    RAISE EXCEPTION 'Só metas Ativas podem ser editadas (status: %).', v_status;
  END IF;

  IF p_descricao IS NULL OR btrim(p_descricao) = '' THEN
    RAISE EXCEPTION 'Descrição obrigatória.';
  END IF;
  IF p_bonificacao_equipe < 0 OR p_limite_bonificacao_individual < 0 THEN
    RAISE EXCEPTION 'Valores de bonificação não podem ser negativos.';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.';
  END IF;

  -- Se existem tarefas táticas com valor acima do novo limite individual,
  -- bloqueia — senão a edição quebraria a invariante valor <= limite.
  IF p_limite_bonificacao_individual > 0 AND EXISTS (
    SELECT 1 FROM tarefas_taticas
     WHERE meta_estrategica_id = p_meta_id
       AND COALESCE(ativo, true) = true
       AND valor_bonificacao > p_limite_bonificacao_individual
  ) THEN
    RAISE EXCEPTION 'Existem tarefas táticas com valor acima do novo limite individual.';
  END IF;

  UPDATE metas_estrategicas
     SET descricao                     = btrim(p_descricao),
         setor                         = NULLIF(p_setor, ''),
         bonificacao_equipe            = p_bonificacao_equipe,
         limite_bonificacao_individual = p_limite_bonificacao_individual,
         data_inicio                   = p_data_inicio,
         data_fim                      = p_data_fim
   WHERE id = p_meta_id;
END;
$$;

REVOKE ALL ON FUNCTION public.editar_meta_estrategica(uuid, text, text, numeric, numeric, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.editar_meta_estrategica(uuid, text, text, numeric, numeric, date, date) TO authenticated;

-- -----------------------------------------------------------------
-- apagar_meta_estrategica — soft-delete cascade
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apagar_meta_estrategica(p_meta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_role             text;
  v_status           text;
  v_tarefas_apagadas integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO podem apagar metas estratégicas.';
  END IF;

  SELECT status INTO v_status FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo, true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;

  IF v_status = 'Concluida' THEN
    RAISE EXCEPTION 'Meta já concluída (bonificação distribuída). Não pode apagar.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tarefas_taticas
     WHERE meta_estrategica_id = p_meta_id
       AND status = 'Aprovada'
       AND COALESCE(ativo, true) = true
  ) THEN
    RAISE EXCEPTION 'Há tarefas táticas já aprovadas (com bonificação paga). Cancele a meta em vez de apagar.';
  END IF;

  -- Cascade soft-delete: tarefas táticas vinculadas somem pros gerentes/colaboradores.
  UPDATE tarefas_taticas
     SET ativo = false
   WHERE meta_estrategica_id = p_meta_id
     AND COALESCE(ativo, true) = true;
  GET DIAGNOSTICS v_tarefas_apagadas = ROW_COUNT;

  UPDATE metas_estrategicas
     SET ativo = false
   WHERE id = p_meta_id;

  RETURN jsonb_build_object(
    'meta_id', p_meta_id,
    'tarefas_apagadas', v_tarefas_apagadas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apagar_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.apagar_meta_estrategica(uuid) TO authenticated;

COMMIT;
