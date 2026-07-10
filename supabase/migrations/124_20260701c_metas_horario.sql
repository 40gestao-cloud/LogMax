-- Adiciona hora_inicio e hora_fim em metas_estrategicas e tarefas_taticas
BEGIN;

ALTER TABLE metas_estrategicas
  ADD COLUMN IF NOT EXISTS hora_inicio time,
  ADD COLUMN IF NOT EXISTS hora_fim    time;

ALTER TABLE tarefas_taticas
  ADD COLUMN IF NOT EXISTS hora_inicio time,
  ADD COLUMN IF NOT EXISTS hora_fim    time;

-- criar_meta_estrategica
CREATE OR REPLACE FUNCTION public.criar_meta_estrategica(
  p_titulo                        text,
  p_descricao                     text,
  p_setor                         text,
  p_bonificacao_equipe            numeric,
  p_limite_bonificacao_individual numeric,
  p_data_inicio                   date,
  p_data_fim                      date,
  p_hora_inicio                   time DEFAULT NULL,
  p_hora_fim                      time DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN RAISE EXCEPTION 'Apenas admin/CEO.'; END IF;
  IF btrim(p_titulo) = '' THEN RAISE EXCEPTION 'Título obrigatório.'; END IF;
  IF p_bonificacao_equipe < 0 OR p_limite_bonificacao_individual < 0 THEN
    RAISE EXCEPTION 'Valores de bonificação não podem ser negativos.';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.';
  END IF;

  INSERT INTO metas_estrategicas
    (titulo, descricao, setor, bonificacao_equipe, limite_bonificacao_individual,
     data_inicio, data_fim, hora_inicio, hora_fim, criada_por, status)
  VALUES
    (btrim(p_titulo), COALESCE(btrim(p_descricao),''),
     NULLIF(p_setor,''), p_bonificacao_equipe, p_limite_bonificacao_individual,
     p_data_inicio, p_data_fim, p_hora_inicio, p_hora_fim, v_uid, 'Rascunho')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.criar_meta_estrategica(text,text,text,numeric,numeric,date,date,time,time) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_meta_estrategica(text,text,text,numeric,numeric,date,date,time,time) TO authenticated;

-- editar_meta_estrategica
CREATE OR REPLACE FUNCTION public.editar_meta_estrategica(
  p_meta_id                       uuid,
  p_titulo                        text,
  p_descricao                     text,
  p_setor                         text,
  p_bonificacao_equipe            numeric,
  p_limite_bonificacao_individual numeric,
  p_data_inicio                   date,
  p_data_fim                      date,
  p_hora_inicio                   time DEFAULT NULL,
  p_hora_fim                      time DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN RAISE EXCEPTION 'Apenas admin/CEO.'; END IF;

  SELECT status INTO v_status FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo,true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  IF v_status NOT IN ('Rascunho','Em Produção','Pausada') THEN
    RAISE EXCEPTION 'Meta Encerrada não pode ser editada.';
  END IF;
  IF btrim(p_titulo) = '' THEN RAISE EXCEPTION 'Título obrigatório.'; END IF;
  IF p_bonificacao_equipe < 0 OR p_limite_bonificacao_individual < 0 THEN
    RAISE EXCEPTION 'Valores de bonificação não podem ser negativos.';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.';
  END IF;
  IF p_limite_bonificacao_individual > 0 AND EXISTS (
    SELECT 1 FROM tarefas_taticas
     WHERE meta_estrategica_id = p_meta_id AND COALESCE(ativo,true) = true
       AND valor_bonificacao > p_limite_bonificacao_individual
  ) THEN
    RAISE EXCEPTION 'Existem tarefas táticas com valor acima do novo limite individual.';
  END IF;

  UPDATE metas_estrategicas
     SET titulo                       = btrim(p_titulo),
         descricao                     = COALESCE(btrim(p_descricao),''),
         setor                         = NULLIF(p_setor,''),
         bonificacao_equipe            = p_bonificacao_equipe,
         limite_bonificacao_individual = p_limite_bonificacao_individual,
         data_inicio                   = p_data_inicio,
         data_fim                      = p_data_fim,
         hora_inicio                   = p_hora_inicio,
         hora_fim                      = p_hora_fim
   WHERE id = p_meta_id;
END;
$$;
REVOKE ALL ON FUNCTION public.editar_meta_estrategica(uuid,text,text,text,numeric,numeric,date,date,time,time) FROM public;
GRANT EXECUTE ON FUNCTION public.editar_meta_estrategica(uuid,text,text,text,numeric,numeric,date,date,time,time) TO authenticated;

-- criar_tarefa_tatica
CREATE OR REPLACE FUNCTION public.criar_tarefa_tatica(
  p_meta_estrategica_id uuid,
  p_titulo              text,
  p_descricao           text,
  p_colaborador_id      uuid,
  p_valor_bonificacao   numeric,
  p_data_inicio         date,
  p_data_fim            date,
  p_hora_inicio         time DEFAULT NULL,
  p_hora_fim            time DEFAULT NULL
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_caller_role     text;
  v_caller_setores  text[];
  v_meta            metas_estrategicas%ROWTYPE;
  v_setor_alvo      text;
  v_ids             uuid[] := ARRAY[]::uuid[];
  v_id              uuid;
  v_colab           record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role, ARRAY[setor]||COALESCE(setores_extras,'{}'::text[])
    INTO v_caller_role, v_caller_setores FROM user_profiles WHERE id=v_uid;
  IF v_caller_role NOT IN ('admin','ceo','gerente') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF btrim(p_titulo) = '' THEN RAISE EXCEPTION 'Título obrigatório.'; END IF;

  SELECT * INTO v_meta FROM metas_estrategicas
   WHERE id=p_meta_estrategica_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta estratégica não encontrada.'; END IF;
  IF v_meta.status NOT IN ('Em Produção','Rascunho') THEN
    RAISE EXCEPTION 'Meta precisa estar Em Produção ou Rascunho (status: %).', v_meta.status;
  END IF;
  IF p_valor_bonificacao < 0 THEN RAISE EXCEPTION 'Valor não pode ser negativo.'; END IF;
  IF v_meta.limite_bonificacao_individual > 0
     AND p_valor_bonificacao > v_meta.limite_bonificacao_individual THEN
    RAISE EXCEPTION 'Valor excede o limite individual da meta.';
  END IF;
  IF p_data_fim < p_data_inicio THEN RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.'; END IF;

  IF v_meta.setor IS NOT NULL THEN
    v_setor_alvo := v_meta.setor;
    IF v_caller_role='gerente' AND NOT (v_setor_alvo=ANY(v_caller_setores)) THEN
      RAISE EXCEPTION 'Gerente só pode atuar no próprio setor.';
    END IF;
  ELSIF v_caller_role IN ('admin','ceo') THEN
    v_setor_alvo := NULL;
  ELSE
    SELECT setor INTO v_setor_alvo FROM user_profiles WHERE id=v_uid;
  END IF;

  IF p_colaborador_id IS NOT NULL THEN
    DECLARE v_alvo_setor text; BEGIN
      SELECT setor INTO v_alvo_setor FROM user_profiles
       WHERE id=p_colaborador_id AND COALESCE(ativo,true)=true;
      IF v_alvo_setor IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
      IF v_caller_role='gerente' AND NOT (v_alvo_setor=ANY(v_caller_setores)) THEN
        RAISE EXCEPTION 'Gerente só pode atribuir ao próprio setor.';
      END IF;
      INSERT INTO tarefas_taticas
        (meta_estrategica_id,titulo,descricao,colaborador_id,setor,valor_bonificacao,
         data_inicio,data_fim,hora_inicio,hora_fim,criada_por,status,situacao)
      VALUES
        (p_meta_estrategica_id,btrim(p_titulo),COALESCE(btrim(p_descricao),''),
         p_colaborador_id,v_alvo_setor,p_valor_bonificacao,
         p_data_inicio,p_data_fim,p_hora_inicio,p_hora_fim,v_uid,'Pendente','Rascunho')
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids,v_id);
    END;
  ELSE
    FOR v_colab IN
      SELECT id,setor FROM user_profiles
       WHERE COALESCE(ativo,true)=true AND role='colaborador' AND id<>v_uid
         AND (v_setor_alvo IS NULL
              OR v_setor_alvo=ANY(ARRAY[setor]||COALESCE(setores_extras,'{}'::text[])))
    LOOP
      INSERT INTO tarefas_taticas
        (meta_estrategica_id,titulo,descricao,colaborador_id,setor,valor_bonificacao,
         data_inicio,data_fim,hora_inicio,hora_fim,criada_por,status,situacao)
      VALUES
        (p_meta_estrategica_id,btrim(p_titulo),COALESCE(btrim(p_descricao),''),
         v_colab.id,COALESCE(v_setor_alvo,v_colab.setor),p_valor_bonificacao,
         p_data_inicio,p_data_fim,p_hora_inicio,p_hora_fim,v_uid,'Pendente','Rascunho')
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids,v_id);
    END LOOP;
    IF array_length(v_ids,1) IS NULL THEN
      RAISE EXCEPTION 'Nenhum colaborador ativo encontrado.';
    END IF;
  END IF;

  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.criar_tarefa_tatica(uuid,text,text,uuid,numeric,date,date,time,time) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_tarefa_tatica(uuid,text,text,uuid,numeric,date,date,time,time) TO authenticated;

COMMIT;
