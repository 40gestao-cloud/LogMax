-- =================================================================
-- Ciclo de vida de Metas e Tarefas
-- =================================================================
-- Metas estratégicas ganham novos status:
--   Rascunho → Em Produção → Pausada → Encerrada (pode reabrir)
-- Pool distribuído vira coluna separada (pool_distribuido).
--
-- Tarefas táticas ganham coluna situacao (ciclo de vida):
--   Rascunho → Em Produção → Pausada → Encerrada (pode reabrir)
-- O status de aprovação (Pendente/Concluida/Aprovada/Rejeitada) fica intocado.
--
-- Idempotente. Rodar após 20260615_metas_apenas_admin_ceo.sql.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. metas_estrategicas — novo status + pool_distribuido
-- =================================================================

-- Remove check antigo (se existir)
ALTER TABLE metas_estrategicas DROP CONSTRAINT IF EXISTS metas_estrategicas_status_check;

-- Migra valores existentes
UPDATE metas_estrategicas SET status = 'Em Produção'
  WHERE status = 'Ativa';
UPDATE metas_estrategicas SET status = 'Encerrada'
  WHERE status IN ('Concluida', 'Cancelada');

-- Novo check
ALTER TABLE metas_estrategicas
  ADD CONSTRAINT metas_estrategicas_status_check
  CHECK (status IN ('Rascunho','Em Produção','Pausada','Encerrada'));

-- Novo default para criações futuras
ALTER TABLE metas_estrategicas ALTER COLUMN status SET DEFAULT 'Rascunho';

-- Flag de pool pago
ALTER TABLE metas_estrategicas
  ADD COLUMN IF NOT EXISTS pool_distribuido boolean NOT NULL DEFAULT false;

-- Marca pool_distribuido pras metas que já eram Concluidas
UPDATE metas_estrategicas
  SET pool_distribuido = true
  WHERE status = 'Encerrada' AND concluida_em IS NOT NULL;

-- =================================================================
-- 2. tarefas_taticas — coluna situacao (ciclo de vida)
-- =================================================================

ALTER TABLE tarefas_taticas
  ADD COLUMN IF NOT EXISTS situacao text NOT NULL DEFAULT 'Em Produção'
  CHECK (situacao IN ('Rascunho','Em Produção','Pausada','Encerrada'));

-- Novas tarefas criadas a partir de agora ficam como Rascunho por padrão
ALTER TABLE tarefas_taticas ALTER COLUMN situacao SET DEFAULT 'Rascunho';

-- =================================================================
-- 3. RLS — esconde Rascunho de gerentes e colaboradores
-- =================================================================

-- metas_estrategicas: admin/CEO vê tudo; gerente só vê não-Rascunho do setor
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
      AND status <> 'Rascunho'
      AND (setor IS NULL OR setor = ANY(auth_user_setores()))
    )
  );

-- Colaborador lê metas-pai de tarefas Em Produção atribuídas a ele
DROP POLICY IF EXISTS metas_estrategicas_read_via_tarefa ON metas_estrategicas;
CREATE POLICY metas_estrategicas_read_via_tarefa ON metas_estrategicas
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM tarefas_taticas t
       WHERE t.meta_estrategica_id = metas_estrategicas.id
         AND t.colaborador_id = auth.uid()
         AND t.situacao = 'Em Produção'
         AND COALESCE(t.ativo, true) = true
    )
  );

-- tarefas_taticas: colaborador só vê situacao Em Produção/Pausada/Encerrada (nunca Rascunho)
DROP POLICY IF EXISTS tarefas_taticas_read ON tarefas_taticas;
CREATE POLICY tarefas_taticas_read ON tarefas_taticas
  FOR SELECT TO authenticated USING (
    auth_is_admin()
    OR auth_user_role() = 'ceo'
    OR auth_in_setor('rh')
    OR (
      setor = ANY(auth_user_setores())
      AND EXISTS (
        SELECT 1 FROM user_profiles up
         WHERE up.id = auth.uid() AND up.role = 'gerente'
      )
    )
    OR (
      colaborador_id = auth.uid()
      AND situacao <> 'Rascunho'
    )
  );

-- =================================================================
-- 4. RPCs — metas_estrategicas
-- =================================================================

-- criar_meta_estrategica: começa como Rascunho
CREATE OR REPLACE FUNCTION public.criar_meta_estrategica(
  p_descricao                     text,
  p_setor                         text,
  p_bonificacao_equipe            numeric,
  p_limite_bonificacao_individual numeric,
  p_data_inicio                   date,
  p_data_fim                      date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO podem criar metas estratégicas.';
  END IF;
  IF p_bonificacao_equipe < 0 OR p_limite_bonificacao_individual < 0 THEN
    RAISE EXCEPTION 'Valores de bonificação não podem ser negativos.';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.';
  END IF;

  INSERT INTO metas_estrategicas
    (descricao, setor, bonificacao_equipe, limite_bonificacao_individual,
     data_inicio, data_fim, criada_por, status)
  VALUES
    (p_descricao, NULLIF(p_setor,''), p_bonificacao_equipe, p_limite_bonificacao_individual,
     p_data_inicio, p_data_fim, v_uid, 'Rascunho')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_meta_estrategica(text,text,numeric,numeric,date,date) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_meta_estrategica(text,text,numeric,numeric,date,date) TO authenticated;

-- publicar_meta_estrategica: Rascunho | Pausada → Em Produção
CREATE OR REPLACE FUNCTION public.publicar_meta_estrategica(p_meta_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN RAISE EXCEPTION 'Apenas admin/CEO.'; END IF;

  SELECT status INTO v_status FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  IF v_status NOT IN ('Rascunho','Pausada') THEN
    RAISE EXCEPTION 'Meta precisa estar em Rascunho ou Pausada (atual: %).', v_status;
  END IF;

  UPDATE metas_estrategicas SET status = 'Em Produção' WHERE id = p_meta_id;
END;
$$;
REVOKE ALL ON FUNCTION public.publicar_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.publicar_meta_estrategica(uuid) TO authenticated;

-- pausar_meta_estrategica: Em Produção → Pausada
CREATE OR REPLACE FUNCTION public.pausar_meta_estrategica(p_meta_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN RAISE EXCEPTION 'Apenas admin/CEO.'; END IF;

  SELECT status INTO v_status FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  IF v_status <> 'Em Produção' THEN
    RAISE EXCEPTION 'Meta precisa estar Em Produção (atual: %).', v_status;
  END IF;

  UPDATE metas_estrategicas SET status = 'Pausada' WHERE id = p_meta_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pausar_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.pausar_meta_estrategica(uuid) TO authenticated;

-- encerrar_meta_estrategica: qualquer → Encerrada (sem pagar pool)
CREATE OR REPLACE FUNCTION public.encerrar_meta_estrategica(p_meta_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN RAISE EXCEPTION 'Apenas admin/CEO.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM metas_estrategicas WHERE id=p_meta_id AND COALESCE(ativo,true)=true) THEN
    RAISE EXCEPTION 'Meta não encontrada.';
  END IF;

  UPDATE metas_estrategicas
     SET status = 'Encerrada'
   WHERE id = p_meta_id;
END;
$$;
REVOKE ALL ON FUNCTION public.encerrar_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.encerrar_meta_estrategica(uuid) TO authenticated;

-- reabrir_meta_estrategica: Encerrada → Em Produção
CREATE OR REPLACE FUNCTION public.reabrir_meta_estrategica(p_meta_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN RAISE EXCEPTION 'Apenas admin/CEO.'; END IF;

  SELECT status INTO v_status FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  IF v_status <> 'Encerrada' THEN
    RAISE EXCEPTION 'Meta precisa estar Encerrada para reabrir (atual: %).', v_status;
  END IF;

  UPDATE metas_estrategicas
     SET status = 'Em Produção', concluida_em = NULL, concluida_por = NULL
   WHERE id = p_meta_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reabrir_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reabrir_meta_estrategica(uuid) TO authenticated;

-- concluir_meta_estrategica: Em Produção → Encerrada + distribui pool
CREATE OR REPLACE FUNCTION public.concluir_meta_estrategica(p_meta_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_role         text;
  v_meta         metas_estrategicas%ROWTYPE;
  v_alvos        uuid[];
  v_count        integer;
  v_valor_unit   numeric(15,2);
  v_resto        numeric(15,2);
  v_alvo         uuid;
  v_conta_id     uuid;
  v_folgas_total integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO podem concluir metas estratégicas.';
  END IF;

  SELECT * INTO v_meta FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta estratégica não encontrada.'; END IF;
  IF v_meta.status <> 'Em Produção' THEN
    RAISE EXCEPTION 'Meta precisa estar Em Produção (status: %).', v_meta.status;
  END IF;
  IF v_meta.pool_distribuido THEN
    RAISE EXCEPTION 'Pool já foi distribuído para esta meta.';
  END IF;

  IF v_meta.setor IS NULL THEN
    SELECT array_agg(id) INTO v_alvos FROM user_profiles
     WHERE COALESCE(ativo,true)=true AND role='colaborador';
  ELSE
    SELECT array_agg(id) INTO v_alvos FROM user_profiles
     WHERE COALESCE(ativo,true)=true AND role='colaborador'
       AND v_meta.setor = ANY(ARRAY[setor] || COALESCE(setores_extras,'{}'::text[]));
  END IF;

  v_count := COALESCE(array_length(v_alvos,1),0);

  IF v_count > 0 AND v_meta.bonificacao_equipe > 0 THEN
    v_valor_unit := ROUND(v_meta.bonificacao_equipe / v_count, 2);
    v_resto      := v_meta.bonificacao_equipe - (v_valor_unit * v_count);

    FOREACH v_alvo IN ARRAY v_alvos LOOP
      DECLARE
        v_valor numeric(15,2) := v_valor_unit;
        v_tx_id uuid;
      BEGIN
        IF v_resto <> 0 THEN v_valor := v_valor + v_resto; v_resto := 0; END IF;

        INSERT INTO maxbank_contas (colaborador_id) VALUES (v_alvo)
          ON CONFLICT (colaborador_id) DO NOTHING;
        SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id=v_alvo;

        BEGIN
          INSERT INTO maxbank_transacoes
            (conta_id,tipo,carteira,valor,descricao,origem,origem_id,created_by)
          VALUES
            (v_conta_id,'credito','bonificacoes',v_valor,
             'Meta equipe: '||left(v_meta.descricao,80),
             'meta_estrategica',p_meta_id,v_uid)
          RETURNING id INTO v_tx_id;

          UPDATE maxbank_contas
             SET saldo_bonificacoes=saldo_bonificacoes+v_valor
           WHERE id=v_conta_id;

          v_folgas_total := v_folgas_total + gerar_folgas_acumulado(v_alvo,NULL);
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
      END;
    END LOOP;
  END IF;

  UPDATE metas_estrategicas
     SET status='Encerrada', pool_distribuido=true,
         concluida_em=now(), concluida_por=v_uid
   WHERE id=p_meta_id;

  RETURN jsonb_build_object(
    'meta_id',p_meta_id,
    'colaboradores_beneficiados',v_count,
    'valor_por_colaborador',v_valor_unit,
    'folgas_total',v_folgas_total
  );
END;
$$;
REVOKE ALL ON FUNCTION public.concluir_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.concluir_meta_estrategica(uuid) TO authenticated;

-- Remover RPC cancelar (substituída por encerrar) — mantém para compatibilidade mas delega
CREATE OR REPLACE FUNCTION public.cancelar_meta_estrategica(p_meta_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.encerrar_meta_estrategica(p_meta_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancelar_meta_estrategica(uuid) TO authenticated;

-- =================================================================
-- 5. RPCs — tarefas_taticas
-- =================================================================

-- criar_tarefa_tatica: situacao='Rascunho'; meta pode estar em Rascunho ou Em Produção
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
  v_setor_alvo      text;
  v_ids             uuid[] := ARRAY[]::uuid[];
  v_id              uuid;
  v_colab           record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT role, ARRAY[setor]||COALESCE(setores_extras,'{}'::text[])
    INTO v_caller_role, v_caller_setores
    FROM user_profiles WHERE id=v_uid;

  IF v_caller_role NOT IN ('admin','ceo','gerente') THEN
    RAISE EXCEPTION 'Sem permissão para criar tarefas táticas.';
  END IF;

  SELECT * INTO v_meta FROM metas_estrategicas
   WHERE id=p_meta_estrategica_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta estratégica não encontrada.'; END IF;
  IF v_meta.status NOT IN ('Em Produção','Rascunho') THEN
    RAISE EXCEPTION 'Meta precisa estar Em Produção ou Rascunho (status: %).', v_meta.status;
  END IF;
  IF p_valor_bonificacao < 0 THEN
    RAISE EXCEPTION 'Valor de bonificação não pode ser negativo.';
  END IF;
  IF v_meta.limite_bonificacao_individual > 0
     AND p_valor_bonificacao > v_meta.limite_bonificacao_individual THEN
    RAISE EXCEPTION 'Valor R$ % excede o limite individual da meta (R$ %).',
      to_char(p_valor_bonificacao,'FM999G999G990D00'),
      to_char(v_meta.limite_bonificacao_individual,'FM999G999G990D00');
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.';
  END IF;

  IF v_meta.setor IS NOT NULL THEN
    v_setor_alvo := v_meta.setor;
    IF v_caller_role='gerente' AND NOT (v_setor_alvo=ANY(v_caller_setores)) THEN
      RAISE EXCEPTION 'Gerente só pode atuar em tarefas do próprio setor.';
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
      IF v_alvo_setor IS NULL THEN RAISE EXCEPTION 'Colaborador alvo não encontrado.'; END IF;
      IF v_caller_role='gerente' AND NOT (v_alvo_setor=ANY(v_caller_setores)) THEN
        RAISE EXCEPTION 'Gerente só pode atribuir tarefa a colaboradores do próprio setor.';
      END IF;

      INSERT INTO tarefas_taticas
        (meta_estrategica_id,descricao,colaborador_id,setor,valor_bonificacao,
         data_inicio,data_fim,criada_por,status,situacao)
      VALUES
        (p_meta_estrategica_id,p_descricao,p_colaborador_id,v_alvo_setor,p_valor_bonificacao,
         p_data_inicio,p_data_fim,v_uid,'Pendente','Rascunho')
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
        (meta_estrategica_id,descricao,colaborador_id,setor,valor_bonificacao,
         data_inicio,data_fim,criada_por,status,situacao)
      VALUES
        (p_meta_estrategica_id,p_descricao,v_colab.id,
         COALESCE(v_setor_alvo,v_colab.setor),p_valor_bonificacao,
         p_data_inicio,p_data_fim,v_uid,'Pendente','Rascunho')
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids,v_id);
    END LOOP;

    IF array_length(v_ids,1) IS NULL THEN
      RAISE EXCEPTION 'Nenhum colaborador ativo encontrado %.',
        CASE WHEN v_setor_alvo IS NULL THEN 'na empresa'
             ELSE 'no setor "' || v_setor_alvo || '"' END;
    END IF;
  END IF;

  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.criar_tarefa_tatica(uuid,text,uuid,numeric,date,date) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_tarefa_tatica(uuid,text,uuid,numeric,date,date) TO authenticated;

-- publicar_tarefa_tatica: Rascunho | Pausada → Em Produção
CREATE OR REPLACE FUNCTION public.publicar_tarefa_tatica(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_situacao text;
  v_setor text;
  v_caller_setores text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role, ARRAY[setor]||COALESCE(setores_extras,'{}'::text[])
    INTO v_role, v_caller_setores FROM user_profiles WHERE id=v_uid;
  IF v_role NOT IN ('admin','ceo','gerente') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;

  SELECT situacao, setor INTO v_situacao, v_setor
    FROM tarefas_taticas WHERE id=p_tarefa_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_role='gerente' AND NOT (v_setor=ANY(v_caller_setores)) THEN
    RAISE EXCEPTION 'Gerente só pode publicar tarefas do próprio setor.';
  END IF;
  IF v_situacao NOT IN ('Rascunho','Pausada') THEN
    RAISE EXCEPTION 'Tarefa precisa estar em Rascunho ou Pausada (atual: %).', v_situacao;
  END IF;

  UPDATE tarefas_taticas SET situacao='Em Produção' WHERE id=p_tarefa_id;
END;
$$;
REVOKE ALL ON FUNCTION public.publicar_tarefa_tatica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.publicar_tarefa_tatica(uuid) TO authenticated;

-- pausar_tarefa_tatica: Em Produção → Pausada
CREATE OR REPLACE FUNCTION public.pausar_tarefa_tatica(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_situacao text;
  v_setor text;
  v_caller_setores text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role, ARRAY[setor]||COALESCE(setores_extras,'{}'::text[])
    INTO v_role, v_caller_setores FROM user_profiles WHERE id=v_uid;
  IF v_role NOT IN ('admin','ceo','gerente') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;

  SELECT situacao, setor INTO v_situacao, v_setor
    FROM tarefas_taticas WHERE id=p_tarefa_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_role='gerente' AND NOT (v_setor=ANY(v_caller_setores)) THEN
    RAISE EXCEPTION 'Gerente só pode pausar tarefas do próprio setor.';
  END IF;
  IF v_situacao <> 'Em Produção' THEN
    RAISE EXCEPTION 'Tarefa precisa estar Em Produção (atual: %).', v_situacao;
  END IF;

  UPDATE tarefas_taticas SET situacao='Pausada' WHERE id=p_tarefa_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pausar_tarefa_tatica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.pausar_tarefa_tatica(uuid) TO authenticated;

-- encerrar_tarefa_tatica: qualquer → Encerrada (sem creditar)
CREATE OR REPLACE FUNCTION public.encerrar_tarefa_tatica(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_setor text;
  v_caller_setores text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role, ARRAY[setor]||COALESCE(setores_extras,'{}'::text[])
    INTO v_role, v_caller_setores FROM user_profiles WHERE id=v_uid;
  IF v_role NOT IN ('admin','ceo','gerente') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;

  SELECT setor INTO v_setor FROM tarefas_taticas
   WHERE id=p_tarefa_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_role='gerente' AND NOT (v_setor=ANY(v_caller_setores)) THEN
    RAISE EXCEPTION 'Gerente só pode encerrar tarefas do próprio setor.';
  END IF;

  UPDATE tarefas_taticas SET situacao='Encerrada' WHERE id=p_tarefa_id;
END;
$$;
REVOKE ALL ON FUNCTION public.encerrar_tarefa_tatica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.encerrar_tarefa_tatica(uuid) TO authenticated;

-- reabrir_tarefa_tatica: Encerrada → Em Produção
CREATE OR REPLACE FUNCTION public.reabrir_tarefa_tatica(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_situacao text;
  v_setor text;
  v_caller_setores text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role, ARRAY[setor]||COALESCE(setores_extras,'{}'::text[])
    INTO v_role, v_caller_setores FROM user_profiles WHERE id=v_uid;
  IF v_role NOT IN ('admin','ceo','gerente') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;

  SELECT situacao, setor INTO v_situacao, v_setor
    FROM tarefas_taticas WHERE id=p_tarefa_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_role='gerente' AND NOT (v_setor=ANY(v_caller_setores)) THEN
    RAISE EXCEPTION 'Gerente só pode reabrir tarefas do próprio setor.';
  END IF;
  IF v_situacao <> 'Encerrada' THEN
    RAISE EXCEPTION 'Tarefa precisa estar Encerrada para reabrir (atual: %).', v_situacao;
  END IF;

  UPDATE tarefas_taticas SET situacao='Em Produção' WHERE id=p_tarefa_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reabrir_tarefa_tatica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reabrir_tarefa_tatica(uuid) TO authenticated;

-- concluir_tarefa_tatica: só funciona com situacao='Em Produção'
CREATE OR REPLACE FUNCTION public.concluir_tarefa_tatica(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_colaborador uuid;
  v_status      text;
  v_situacao    text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT colaborador_id, status, situacao
    INTO v_colaborador, v_status, v_situacao
    FROM tarefas_taticas WHERE id=p_tarefa_id AND COALESCE(ativo,true)=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_colaborador <> v_uid THEN
    RAISE EXCEPTION 'Só o colaborador alvo pode marcar a tarefa como concluída.';
  END IF;
  IF v_situacao <> 'Em Produção' THEN
    RAISE EXCEPTION 'Tarefa não está Em Produção (situação: %).', v_situacao;
  END IF;
  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Tarefa precisa estar Pendente (status atual: %).', v_status;
  END IF;

  UPDATE tarefas_taticas
     SET status='Concluida', concluida_em=now()
   WHERE id=p_tarefa_id;
END;
$$;
REVOKE ALL ON FUNCTION public.concluir_tarefa_tatica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.concluir_tarefa_tatica(uuid) TO authenticated;

COMMIT;
