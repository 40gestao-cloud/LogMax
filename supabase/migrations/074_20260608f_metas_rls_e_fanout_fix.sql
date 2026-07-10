-- =================================================================
-- Hotfix da migração 20260608e (Metas em 2 níveis)
-- =================================================================
-- Bugs detectados após code review:
--
-- 1. CEO (setor='all') não passa em `setor = ANY(auth_user_setores())`,
--    então CEO não vê metas/tarefas de outros setores. Inclusive não
--    vê o que acabou de criar (refetch pós-INSERT falha por RLS).
--
-- 2. Colaborador não tem SELECT em metas_estrategicas, então a UI dele
--    mostra "Meta: —" em vez do título da meta-pai da própria tarefa.
--
-- 3. criar_tarefa_tatica com meta global (setor=NULL) + admin/CEO + fan-out
--    cai em v_setor_alvo='all' e nenhum colaborador casa.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. RLS metas_estrategicas: CEO bypass + colaborador via tarefa
DROP POLICY IF EXISTS metas_estrategicas_read ON metas_estrategicas;
CREATE POLICY metas_estrategicas_read ON metas_estrategicas
  FOR SELECT TO authenticated USING (
    auth_is_admin()
    OR auth_user_role() = 'ceo'
    OR auth_in_setor('rh')
    OR (
      EXISTS (
        SELECT 1 FROM user_profiles up
         WHERE up.id = auth.uid() AND up.role = 'gerente'
      )
      AND (setor IS NULL OR setor = ANY(auth_user_setores()))
    )
  );

-- Policy adicional: colaborador lê metas que são pai de uma tarefa atribuída a ele.
-- Permite o join "tarefa → meta.descricao" na MetasView pro colaborador.
DROP POLICY IF EXISTS metas_estrategicas_read_via_tarefa ON metas_estrategicas;
CREATE POLICY metas_estrategicas_read_via_tarefa ON metas_estrategicas
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM tarefas_taticas t
       WHERE t.meta_estrategica_id = metas_estrategicas.id
         AND t.colaborador_id = auth.uid()
         AND COALESCE(t.ativo, true) = true
    )
  );

-- ─── 2. RLS tarefas_taticas: CEO bypass
DROP POLICY IF EXISTS tarefas_taticas_read ON tarefas_taticas;
CREATE POLICY tarefas_taticas_read ON tarefas_taticas
  FOR SELECT TO authenticated USING (
    colaborador_id = auth.uid()
    OR auth_is_admin()
    OR auth_user_role() = 'ceo'
    OR auth_in_setor('rh')
    OR (setor = ANY(auth_user_setores())
        AND EXISTS (
          SELECT 1 FROM user_profiles up
           WHERE up.id = auth.uid() AND up.role = 'gerente'
        ))
  );

-- ─── 3. criar_tarefa_tatica: admin/CEO + meta global + fan-out = todos colaboradores
CREATE OR REPLACE FUNCTION public.criar_tarefa_tatica(
  p_meta_estrategica_id uuid,
  p_descricao           text,
  p_colaborador_id      uuid,
  p_valor_bonificacao   numeric,
  p_data_inicio         date,
  p_data_fim            date
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_caller_role     text;
  v_caller_setores  text[];
  v_meta            metas_estrategicas%ROWTYPE;
  v_setor_alvo      text;             -- NULL = fan-out global (admin/CEO em meta global)
  v_ids             uuid[] := ARRAY[]::uuid[];
  v_id              uuid;
  v_colab           record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_caller_role, v_caller_setores
    FROM user_profiles WHERE id = v_uid;

  IF v_caller_role NOT IN ('admin','ceo','gerente') THEN
    RAISE EXCEPTION 'Sem permissão para criar tarefas táticas.';
  END IF;

  SELECT * INTO v_meta FROM metas_estrategicas
   WHERE id = p_meta_estrategica_id AND COALESCE(ativo,true) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta estratégica não encontrada.';
  END IF;
  IF v_meta.status <> 'Ativa' THEN
    RAISE EXCEPTION 'Meta estratégica não está ativa (status: %).', v_meta.status;
  END IF;

  IF p_valor_bonificacao < 0 THEN
    RAISE EXCEPTION 'Valor de bonificação não pode ser negativo.';
  END IF;
  IF p_valor_bonificacao > v_meta.limite_bonificacao_individual THEN
    RAISE EXCEPTION 'Valor R$ % excede o limite individual da meta (R$ %).',
      to_char(p_valor_bonificacao, 'FM999G999G990D00'),
      to_char(v_meta.limite_bonificacao_individual, 'FM999G999G990D00');
  END IF;

  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.';
  END IF;

  -- Determina setor alvo:
  --   meta.setor != NULL → trabalha naquele setor (gerente precisa estar nele)
  --   meta.setor = NULL  → fan-out global pra admin/CEO; gerente cai no próprio setor
  IF v_meta.setor IS NOT NULL THEN
    v_setor_alvo := v_meta.setor;
    IF v_caller_role = 'gerente' AND NOT (v_setor_alvo = ANY(v_caller_setores)) THEN
      RAISE EXCEPTION 'Gerente só pode atuar em tarefas do próprio setor.';
    END IF;
  ELSIF v_caller_role IN ('admin','ceo') THEN
    v_setor_alvo := NULL;   -- marca pra fan-out global
  ELSE
    SELECT setor INTO v_setor_alvo FROM user_profiles WHERE id = v_uid;
  END IF;

  IF p_colaborador_id IS NOT NULL THEN
    -- Caso 1: colaborador específico
    DECLARE
      v_alvo_setor text;
    BEGIN
      SELECT setor INTO v_alvo_setor FROM user_profiles
       WHERE id = p_colaborador_id AND COALESCE(ativo, true) = true;
      IF v_alvo_setor IS NULL THEN
        RAISE EXCEPTION 'Colaborador alvo não encontrado.';
      END IF;
      IF v_caller_role = 'gerente' AND NOT (v_alvo_setor = ANY(v_caller_setores)) THEN
        RAISE EXCEPTION 'Gerente só pode atribuir tarefa a colaboradores do próprio setor.';
      END IF;

      INSERT INTO tarefas_taticas
        (meta_estrategica_id, descricao, colaborador_id, setor, valor_bonificacao,
         data_inicio, data_fim, criada_por, status)
      VALUES
        (p_meta_estrategica_id, p_descricao, p_colaborador_id, v_alvo_setor, p_valor_bonificacao,
         p_data_inicio, p_data_fim, v_uid, 'Pendente')
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids, v_id);
    END;
  ELSE
    -- Caso 2: fan-out.
    --   v_setor_alvo NULL → todos os colaboradores ativos da empresa (admin/CEO + meta global)
    --   v_setor_alvo X    → colaboradores ativos com X em setores
    FOR v_colab IN
      SELECT id, setor FROM user_profiles
       WHERE COALESCE(ativo, true) = true
         AND role = 'colaborador'
         AND id <> v_uid
         AND (
           v_setor_alvo IS NULL
           OR v_setor_alvo = ANY(ARRAY[setor] || COALESCE(setores_extras, '{}'::text[]))
         )
    LOOP
      INSERT INTO tarefas_taticas
        (meta_estrategica_id, descricao, colaborador_id, setor, valor_bonificacao,
         data_inicio, data_fim, criada_por, status)
      VALUES
        (p_meta_estrategica_id, p_descricao, v_colab.id,
         COALESCE(v_setor_alvo, v_colab.setor),   -- snapshot do setor do alvo
         p_valor_bonificacao,
         p_data_inicio, p_data_fim, v_uid, 'Pendente')
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids, v_id);
    END LOOP;

    IF array_length(v_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Nenhum colaborador ativo encontrado %.',
        CASE WHEN v_setor_alvo IS NULL THEN 'na empresa'
             ELSE 'no setor "' || v_setor_alvo || '"' END;
    END IF;
  END IF;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_tarefa_tatica(uuid, text, uuid, numeric, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_tarefa_tatica(uuid, text, uuid, numeric, date, date) TO authenticated;

COMMIT;
