-- =================================================================
-- Metas em 2 níveis — Estratégico (admin/CEO) + Tático (gerente)
-- =================================================================
-- Antes: maxbank_metas (modelo plano: gerente cria meta individual com
--        bonificação direta pro colaborador). Continua existindo intocada
--        pra preservar histórico, mas a nova UI não usa mais.
--
-- Agora:
--   Nível Estratégico (admin/CEO):
--     metas_estrategicas — setor NULL (=todos) ou específico; com pool
--     `bonificacao_equipe` e teto `limite_bonificacao_individual` que
--     restringe as tarefas táticas criadas dentro dela.
--
--   Nível Tático (gerente):
--     tarefas_taticas — sempre vinculadas a uma meta estratégica;
--     atribuídas a 1 colaborador (ou "todos do setor" via fan-out no
--     RPC, que cria N linhas). valor_bonificacao <= limite da meta.
--
-- Fluxo de bonificação (sistema de folga R$ 2.500 preservado):
--   - Tarefa tática aprovada → credita carteira do colaborador
--     (origem='meta_tatica') → roda gerar_folgas_acumulado.
--   - Meta estratégica concluída → divide bonificacao_equipe igualmente
--     entre os colaboradores ativos do(s) setor(es) alvo →
--     credita cada um (origem='meta_estrategica') → folga acumulada.
--
-- IDEMPOTENTE. Rodar APÓS 20260606c_maxbank_metas.sql.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. metas_estrategicas
-- =================================================================
CREATE TABLE IF NOT EXISTS metas_estrategicas (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao                       text NOT NULL,
  setor                           text,                          -- NULL = todos os setores
  bonificacao_equipe              numeric(15,2) NOT NULL DEFAULT 0
                                   CHECK (bonificacao_equipe >= 0),
  limite_bonificacao_individual   numeric(15,2) NOT NULL DEFAULT 0
                                   CHECK (limite_bonificacao_individual >= 0),
  data_inicio                     date NOT NULL,
  data_fim                        date NOT NULL,
  criada_por                      uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  status                          text NOT NULL DEFAULT 'Ativa'
                                   CHECK (status IN ('Ativa','Concluida','Cancelada')),
  concluida_em                    timestamptz,
  concluida_por                   uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  ativo                           boolean NOT NULL DEFAULT true,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_metas_estrategicas_setor
  ON metas_estrategicas (setor, status) WHERE ativo = true;

CREATE OR REPLACE FUNCTION metas_estrategicas_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_metas_estrategicas_updated_at ON metas_estrategicas;
CREATE TRIGGER trg_metas_estrategicas_updated_at
  BEFORE UPDATE ON metas_estrategicas
  FOR EACH ROW EXECUTE FUNCTION metas_estrategicas_set_updated_at();

-- =================================================================
-- 2. tarefas_taticas
-- =================================================================
CREATE TABLE IF NOT EXISTS tarefas_taticas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_estrategica_id      uuid NOT NULL REFERENCES metas_estrategicas(id) ON DELETE CASCADE,
  descricao                text NOT NULL,
  colaborador_id           uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  -- snapshot do setor do colaborador no momento da criação (igual padrão maxbank_metas)
  setor                    text NOT NULL,
  valor_bonificacao        numeric(15,2) NOT NULL DEFAULT 0
                            CHECK (valor_bonificacao >= 0),
  data_inicio              date NOT NULL,
  data_fim                 date NOT NULL,
  criada_por               uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'Pendente'
                            CHECK (status IN ('Pendente','Concluida','Aprovada','Rejeitada')),
  concluida_em             timestamptz,
  aprovada_em              timestamptz,
  aprovada_por             uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  feedback_aprovacao       text,
  ativo                    boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_tarefas_taticas_colaborador
  ON tarefas_taticas (colaborador_id, status) WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_tarefas_taticas_meta
  ON tarefas_taticas (meta_estrategica_id) WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_tarefas_taticas_setor
  ON tarefas_taticas (setor, status) WHERE ativo = true;

CREATE OR REPLACE FUNCTION tarefas_taticas_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_tarefas_taticas_updated_at ON tarefas_taticas;
CREATE TRIGGER trg_tarefas_taticas_updated_at
  BEFORE UPDATE ON tarefas_taticas
  FOR EACH ROW EXECUTE FUNCTION tarefas_taticas_set_updated_at();

-- =================================================================
-- 3. UNIQUE parcial: idempotência de crédito por tarefa/meta
-- =================================================================
-- Reaproveita maxbank_transacoes (já usado por maxbank_metas legacy).
-- Distingue por `origem`:
--   origem='meta_tatica'     + origem_id = tarefa_tatica.id
--   origem='meta_estrategica'+ origem_id = metas_estrategicas.id (1 linha por colaborador)
-- Pra meta_estrategica precisamos de UNIQUE (origem_id, colaborador via conta_id) — usar
-- conta_id na composição garante 1 crédito por colaborador.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_meta_tatica
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'meta_tatica';

CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_meta_estrategica
  ON maxbank_transacoes (origem_id, conta_id, carteira)
  WHERE origem = 'meta_estrategica';

-- =================================================================
-- 4. RLS
-- =================================================================
ALTER TABLE metas_estrategicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas_taticas    ENABLE ROW LEVEL SECURITY;

-- Helper: setores do usuário autenticado (primário + extras).
-- Já existe auth_user_setores() definido em migrações anteriores.

-- metas_estrategicas:
--   - admin/CEO/RH: leem tudo
--   - gerente: vê metas que cobrem seu setor (setor IS NULL OR setor = ANY(meus_setores))
--   - colaborador: NÃO vê (visão estratégica é só pra gerente+)
DROP POLICY IF EXISTS metas_estrategicas_read ON metas_estrategicas;
CREATE POLICY metas_estrategicas_read ON metas_estrategicas
  FOR SELECT TO authenticated USING (
    auth_is_admin()
    OR auth_in_setor('rh')
    OR (
      EXISTS (
        SELECT 1 FROM user_profiles up
         WHERE up.id = auth.uid()
           AND up.role IN ('gerente','ceo')
      )
      AND (setor IS NULL OR setor = ANY(auth_user_setores()))
    )
  );

-- Writes via RPC (SECURITY DEFINER) — nenhum INSERT/UPDATE/DELETE direto.

-- tarefas_taticas:
--   - colaborador: vê próprias
--   - gerente do setor: vê do setor
--   - admin/CEO/RH: vê tudo
DROP POLICY IF EXISTS tarefas_taticas_read ON tarefas_taticas;
CREATE POLICY tarefas_taticas_read ON tarefas_taticas
  FOR SELECT TO authenticated USING (
    colaborador_id = auth.uid()
    OR auth_is_admin()
    OR auth_in_setor('rh')
    OR (setor = ANY(auth_user_setores())
        AND EXISTS (
          SELECT 1 FROM user_profiles up
           WHERE up.id = auth.uid()
             AND up.role IN ('gerente','ceo')
        ))
  );

-- =================================================================
-- 5. RPC: criar_meta_estrategica (admin/CEO)
-- =================================================================
CREATE OR REPLACE FUNCTION public.criar_meta_estrategica(
  p_descricao                     text,
  p_setor                         text,   -- NULL = todos
  p_bonificacao_equipe            numeric,
  p_limite_bonificacao_individual numeric,
  p_data_inicio                   date,
  p_data_fim                      date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
  v_id    uuid;
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
    (p_descricao, NULLIF(p_setor, ''), p_bonificacao_equipe, p_limite_bonificacao_individual,
     p_data_inicio, p_data_fim, v_uid, 'Ativa')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_meta_estrategica(text, text, numeric, numeric, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_meta_estrategica(text, text, numeric, numeric, date, date) TO authenticated;

-- =================================================================
-- 6. RPC: criar_tarefa_tatica (gerente / admin / CEO)
-- =================================================================
-- p_colaborador_id NULL → fan-out: cria 1 tarefa por colaborador ativo
-- do setor da meta (ou do setor do gerente se meta.setor IS NULL).
-- Valida valor_bonificacao <= meta.limite_bonificacao_individual.
-- Retorna array de ids das tarefas criadas.
-- =================================================================
CREATE OR REPLACE FUNCTION public.criar_tarefa_tatica(
  p_meta_estrategica_id uuid,
  p_descricao           text,
  p_colaborador_id      uuid,    -- NULL = todos do setor
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

  -- Validação de limite individual.
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

  -- Determina setor alvo: se meta.setor NULL, gerente atua no próprio setor primário.
  -- Admin/CEO precisam especificar via colaborador_id (não fan-out global sem setor).
  IF v_meta.setor IS NOT NULL THEN
    v_setor_alvo := v_meta.setor;
  ELSE
    SELECT setor INTO v_setor_alvo FROM user_profiles WHERE id = v_uid;
  END IF;

  -- Gerente só pode atuar nos próprios setores.
  IF v_caller_role = 'gerente' AND NOT (v_setor_alvo = ANY(v_caller_setores)) THEN
    RAISE EXCEPTION 'Gerente só pode criar tarefas pra colaboradores do próprio setor.';
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
    -- Caso 2: fan-out — todos os colaboradores ativos do setor alvo, exceto o próprio criador.
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
        (p_meta_estrategica_id, p_descricao, v_colab.id, v_setor_alvo, p_valor_bonificacao,
         p_data_inicio, p_data_fim, v_uid, 'Pendente')
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

-- =================================================================
-- 7. RPC: concluir_tarefa_tatica (colaborador dono)
-- =================================================================
CREATE OR REPLACE FUNCTION public.concluir_tarefa_tatica(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_colaborador  uuid;
  v_status       text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT colaborador_id, status INTO v_colaborador, v_status
    FROM tarefas_taticas WHERE id = p_tarefa_id AND COALESCE(ativo,true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_colaborador <> v_uid THEN
    RAISE EXCEPTION 'Só o colaborador alvo pode marcar a tarefa como concluída.';
  END IF;
  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Tarefa precisa estar Pendente (status atual: %).', v_status;
  END IF;

  UPDATE tarefas_taticas
     SET status = 'Concluida', concluida_em = now()
   WHERE id = p_tarefa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.concluir_tarefa_tatica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.concluir_tarefa_tatica(uuid) TO authenticated;

-- =================================================================
-- 8. RPC: aprovar_tarefa_tatica (gerente do setor / admin / CEO / RH)
-- =================================================================
CREATE OR REPLACE FUNCTION public.aprovar_tarefa_tatica(p_tarefa_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_caller_role     text;
  v_caller_setores  text[];
  v_tarefa          tarefas_taticas%ROWTYPE;
  v_conta_id        uuid;
  v_transacao_id    uuid;
  v_folgas          integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_caller_role, v_caller_setores
    FROM user_profiles WHERE id = v_uid;

  SELECT * INTO v_tarefa
    FROM tarefas_taticas WHERE id = p_tarefa_id AND COALESCE(ativo,true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_tarefa.status <> 'Concluida' THEN
    RAISE EXCEPTION 'Tarefa precisa estar Concluída (status: %).', v_tarefa.status;
  END IF;

  IF NOT (
       v_caller_role IN ('admin','ceo')
       OR 'rh' = ANY(v_caller_setores)
       OR (v_caller_role = 'gerente' AND v_tarefa.setor = ANY(v_caller_setores))
     ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta tarefa.';
  END IF;

  -- Cria/garante conta MaxBank do colaborador.
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_tarefa.colaborador_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = v_tarefa.colaborador_id;

  -- Crédito idempotente (UNIQUE parcial origem='meta_tatica').
  IF v_tarefa.valor_bonificacao > 0 THEN
    BEGIN
      INSERT INTO maxbank_transacoes
        (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
      VALUES
        (v_conta_id, 'credito', 'bonificacoes', v_tarefa.valor_bonificacao,
         'Tarefa: ' || left(v_tarefa.descricao, 80),
         'meta_tatica', p_tarefa_id, v_uid)
      RETURNING id INTO v_transacao_id;

      UPDATE maxbank_contas
         SET saldo_bonificacoes = saldo_bonificacoes + v_tarefa.valor_bonificacao
       WHERE id = v_conta_id;
    EXCEPTION WHEN unique_violation THEN
      v_transacao_id := NULL;
    END;

    v_folgas := gerar_folgas_acumulado(v_tarefa.colaborador_id, NULL);
  END IF;

  UPDATE tarefas_taticas
     SET status = 'Aprovada', aprovada_em = now(), aprovada_por = v_uid
   WHERE id = p_tarefa_id;

  RETURN jsonb_build_object(
    'tarefa_id', p_tarefa_id,
    'transacao_id', v_transacao_id,
    'folgas_geradas', v_folgas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_tarefa_tatica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.aprovar_tarefa_tatica(uuid) TO authenticated;

-- =================================================================
-- 9. RPC: rejeitar_tarefa_tatica
-- =================================================================
CREATE OR REPLACE FUNCTION public.rejeitar_tarefa_tatica(
  p_tarefa_id uuid,
  p_feedback  text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_caller_role     text;
  v_caller_setores  text[];
  v_tarefa_setor    text;
  v_tarefa_status   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_caller_role, v_caller_setores
    FROM user_profiles WHERE id = v_uid;

  SELECT setor, status INTO v_tarefa_setor, v_tarefa_status
    FROM tarefas_taticas WHERE id = p_tarefa_id AND COALESCE(ativo,true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF v_tarefa_status <> 'Concluida' THEN
    RAISE EXCEPTION 'Tarefa precisa estar Concluída (status: %).', v_tarefa_status;
  END IF;
  IF NOT (
       v_caller_role IN ('admin','ceo')
       OR 'rh' = ANY(v_caller_setores)
       OR (v_caller_role = 'gerente' AND v_tarefa_setor = ANY(v_caller_setores))
     ) THEN
    RAISE EXCEPTION 'Sem permissão para rejeitar esta tarefa.';
  END IF;

  UPDATE tarefas_taticas
     SET status = 'Rejeitada', aprovada_em = now(), aprovada_por = v_uid,
         feedback_aprovacao = p_feedback
   WHERE id = p_tarefa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rejeitar_tarefa_tatica(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rejeitar_tarefa_tatica(uuid, text) TO authenticated;

-- =================================================================
-- 10. RPC: concluir_meta_estrategica (admin/CEO)
-- =================================================================
-- Marca a meta como Concluida e divide bonificacao_equipe igualmente
-- entre os colaboradores ativos do(s) setor(es) alvo. Credita cada um
-- via maxbank_transacoes (origem='meta_estrategica'). Dispara folga
-- acumulada pra cada colaborador.
--
-- Retorna jsonb com:
--   { meta_id, colaboradores_beneficiados, valor_por_colaborador, folgas_total }
-- =================================================================
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
   WHERE id = p_meta_id AND COALESCE(ativo,true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta estratégica não encontrada.'; END IF;
  IF v_meta.status <> 'Ativa' THEN
    RAISE EXCEPTION 'Meta precisa estar Ativa (status: %).', v_meta.status;
  END IF;

  -- Colaboradores alvo: role='colaborador' ativos do(s) setor(es).
  IF v_meta.setor IS NULL THEN
    SELECT array_agg(id) INTO v_alvos
      FROM user_profiles
     WHERE COALESCE(ativo,true) = true
       AND role = 'colaborador';
  ELSE
    SELECT array_agg(id) INTO v_alvos
      FROM user_profiles
     WHERE COALESCE(ativo,true) = true
       AND role = 'colaborador'
       AND v_meta.setor = ANY(ARRAY[setor] || COALESCE(setores_extras, '{}'::text[]));
  END IF;

  v_count := COALESCE(array_length(v_alvos, 1), 0);

  IF v_count > 0 AND v_meta.bonificacao_equipe > 0 THEN
    v_valor_unit := ROUND(v_meta.bonificacao_equipe / v_count, 2);
    -- Resto da divisão fica acumulado no primeiro beneficiário pra fechar o pool.
    v_resto      := v_meta.bonificacao_equipe - (v_valor_unit * v_count);

    FOREACH v_alvo IN ARRAY v_alvos LOOP
      DECLARE
        v_valor numeric(15,2) := v_valor_unit;
        v_tx_id uuid;
      BEGIN
        IF v_resto <> 0 THEN
          v_valor := v_valor + v_resto;
          v_resto := 0;
        END IF;

        INSERT INTO maxbank_contas (colaborador_id) VALUES (v_alvo)
          ON CONFLICT (colaborador_id) DO NOTHING;
        SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = v_alvo;

        BEGIN
          INSERT INTO maxbank_transacoes
            (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
          VALUES
            (v_conta_id, 'credito', 'bonificacoes', v_valor,
             'Meta equipe: ' || left(v_meta.descricao, 80),
             'meta_estrategica', p_meta_id, v_uid)
          RETURNING id INTO v_tx_id;

          UPDATE maxbank_contas
             SET saldo_bonificacoes = saldo_bonificacoes + v_valor
           WHERE id = v_conta_id;

          v_folgas_total := v_folgas_total + gerar_folgas_acumulado(v_alvo, NULL);
        EXCEPTION WHEN unique_violation THEN
          -- Idempotência: meta já creditou esse colaborador antes.
          NULL;
        END;
      END;
    END LOOP;
  END IF;

  UPDATE metas_estrategicas
     SET status = 'Concluida', concluida_em = now(), concluida_por = v_uid
   WHERE id = p_meta_id;

  RETURN jsonb_build_object(
    'meta_id', p_meta_id,
    'colaboradores_beneficiados', v_count,
    'valor_por_colaborador', v_valor_unit,
    'folgas_total', v_folgas_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.concluir_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.concluir_meta_estrategica(uuid) TO authenticated;

-- =================================================================
-- 11. RPC: cancelar_meta_estrategica (admin/CEO) — sem crédito
-- =================================================================
CREATE OR REPLACE FUNCTION public.cancelar_meta_estrategica(p_meta_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO podem cancelar metas estratégicas.';
  END IF;
  SELECT status INTO v_status FROM metas_estrategicas
   WHERE id = p_meta_id AND COALESCE(ativo,true) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  IF v_status <> 'Ativa' THEN
    RAISE EXCEPTION 'Meta precisa estar Ativa (status: %).', v_status;
  END IF;

  UPDATE metas_estrategicas
     SET status = 'Cancelada'
   WHERE id = p_meta_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_meta_estrategica(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancelar_meta_estrategica(uuid) TO authenticated;

COMMIT;
