-- =================================================================
-- LogMax — Metas: criação RESTRITA a Admin/CEO
-- =================================================================
-- Decisão de produto: gerentes não criam mais metas (estratégicas nem
-- táticas). Só admin/CEO criam. Gerente continua:
--   • LENDO metas/tarefas do próprio setor (RLS read inalterada)
--   • APROVANDO tarefas de colaboradores (aprovar_tarefa_tatica
--     mantém 'gerente do setor' como autorizado)
--   • GERENCIANDO (vendo status, dashboard)
--
-- Motivação: antes ambos níveis tinham criadores diferentes, causando
-- confusão sobre quem é "dono" da meta. Centralizar criação em admin/CEO
-- esclarece a hierarquia: meta estratégica e tática viram artefatos da
-- diretoria; gerente é executor/aprovador.
--
-- Mudança única: `criar_tarefa_tatica` agora rejeita gerente.
-- `criar_meta_estrategica` já era admin/CEO desde sempre.
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.criar_tarefa_tatica(
  p_meta_estrategica_id uuid,
  p_descricao           text,
  p_colaborador_id      uuid,    -- NULL = todos do setor (fan-out)
  p_valor_bonificacao   numeric,
  p_data_inicio         date,
  p_data_fim            date
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_caller_role     text;
  v_meta            metas_estrategicas%ROWTYPE;
  v_setor_alvo      text;
  v_ids             uuid[] := ARRAY[]::uuid[];
  v_id              uuid;
  v_colab           record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT role INTO v_caller_role FROM user_profiles WHERE id = v_uid;

  -- Restringido a admin/CEO. Gerente não cria mais.
  IF v_caller_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas Admin e CEO podem criar tarefas táticas.'
      USING ERRCODE = '42501';
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

  -- Setor alvo: vem da meta. Se a meta não tem setor (=todas), exige
  -- p_colaborador_id pra evitar fan-out global acidental.
  v_setor_alvo := v_meta.setor;

  IF v_setor_alvo IS NULL AND p_colaborador_id IS NULL THEN
    RAISE EXCEPTION 'Meta sem setor exige colaborador específico (fan-out global não permitido).'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_colaborador_id IS NOT NULL THEN
    -- Caso 1: colaborador específico.
    DECLARE
      v_alvo_setor text;
    BEGIN
      SELECT setor INTO v_alvo_setor FROM user_profiles
       WHERE id = p_colaborador_id AND COALESCE(ativo, true) = true;
      IF v_alvo_setor IS NULL THEN
        RAISE EXCEPTION 'Colaborador alvo não encontrado.';
      END IF;

      INSERT INTO tarefas_taticas
        (meta_estrategica_id, descricao, colaborador_id, setor, valor_bonificacao,
         data_inicio, data_fim, criada_por, status)
      VALUES
        (p_meta_estrategica_id, p_descricao, p_colaborador_id,
         COALESCE(v_setor_alvo, v_alvo_setor), p_valor_bonificacao,
         p_data_inicio, p_data_fim, v_uid, 'Pendente')
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids, v_id);
    END;
  ELSE
    -- Caso 2: fan-out — todos colaboradores ativos do setor da meta.
    FOR v_colab IN
      SELECT id FROM user_profiles
       WHERE COALESCE(ativo, true) = true
         AND role = 'colaborador'
         AND v_setor_alvo = ANY(ARRAY[setor] || COALESCE(setores_extras, '{}'::text[]))
         AND id <> v_uid
    LOOP
      INSERT INTO tarefas_taticas
        (meta_estrategica_id, descricao, colaborador_id, setor, valor_bonificacao,
         data_inicio, data_fim, criada_por, status)
      VALUES
        (p_meta_estrategica_id, p_descricao, v_colab.id, v_setor_alvo,
         p_valor_bonificacao, p_data_inicio, p_data_fim, v_uid, 'Pendente')
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids, v_id);
    END LOOP;

    IF array_length(v_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Nenhum colaborador ativo encontrado no setor "%".', v_setor_alvo;
    END IF;
  END IF;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_tarefa_tatica(uuid, text, uuid, numeric, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_tarefa_tatica(uuid, text, uuid, numeric, date, date) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como gerente:
--   --   SELECT criar_tarefa_tatica('<meta-id>', 'desc', '<colab-id>', 100, '2026-06-15', '2026-06-30');
--   --   -- deve retornar erro 42501 "Apenas Admin e CEO podem criar tarefas táticas."
--   -- como admin/ceo: funciona normal.
-- =================================================================
