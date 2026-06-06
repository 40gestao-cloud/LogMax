-- =================================================================
-- MaxBank — Metas / Gamificação (Fase 4)
-- =================================================================
-- Gerente do setor (ou admin/CEO) cria metas de bonificação atribuídas
-- a colaboradores. Fluxo:
--   Pendente  -> colaborador conclui  -> Concluida
--   Concluida -> gerente aprova       -> Aprovada   (credita saldo_bonificacoes)
--                gerente rejeita      -> Rejeitada (não credita)
--
-- Quando o acumulado de bonificações desde a última folga conquistada
-- atinge o limite configurado em maxbank_config.meta_folga_threshold
-- (default R$ 2.500), uma folga ('ferias', status='Aprovado', dias=1) é
-- gerada automaticamente — o colaborador depois escolhe a data exata
-- no módulo Férias. Admin/CEO pode alterar o limite pela MetasView.
--
-- DEPENDÊNCIAS:
--   - 20260605_maxbank_carteira.sql  (Fase 1)
--   - 20260605b_maxbank_credito_folha.sql (bridge funcionarios.user_profile_id)
--   - tabela `ferias` com colunas (funcionario_id, data_inicio, data_fim,
--     dias, status, ativo, observacao text NULL).
--
-- IDEMPOTENTE. Rodar nas 4 instâncias com colaboradores (ERP, Contabilidade,
-- Aprendiz, ADM). NÃO rodar no MaxPOS-PDV.
-- =================================================================

BEGIN;

-- =================================================================
-- 0. ferias.observacao — campo livre usado pela folga conquistada
-- =================================================================
ALTER TABLE ferias
  ADD COLUMN IF NOT EXISTS observacao text;

-- =================================================================
-- 0b. maxbank_config — singleton com parâmetros globais do MaxBank
-- =================================================================
-- Por enquanto carrega só meta_folga_threshold. Pode crescer com mais
-- chaves no futuro (split benefícios, multiplicador hora extra, etc.).
-- Singleton via CHECK (id = 1) — qualquer INSERT de id != 1 falha.
CREATE TABLE IF NOT EXISTS maxbank_config (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  meta_folga_threshold    numeric(15,2) NOT NULL DEFAULT 2500.00
                           CHECK (meta_folga_threshold > 0),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES user_profiles(id) ON DELETE SET NULL
);

INSERT INTO maxbank_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- =================================================================
-- 1. maxbank_metas
-- =================================================================

CREATE TABLE IF NOT EXISTS maxbank_metas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao           text NOT NULL,
  valor               numeric(15,2) NOT NULL CHECK (valor > 0),
  data_inicio         date NOT NULL,
  data_fim            date NOT NULL,
  colaborador_id      uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  criada_por          uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  -- snapshot do setor primário do colaborador no momento da criação
  -- (usado pelo RLS para gerente do setor — setor do user pode mudar
  -- depois, mas a meta segue pertencendo ao setor de origem).
  setor               text,
  filial              text,
  status              text NOT NULL DEFAULT 'Pendente'
                       CHECK (status IN ('Pendente','Concluida','Aprovada','Rejeitada')),
  concluida_em        timestamptz,
  aprovada_em         timestamptz,
  aprovada_por        uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  feedback_aprovacao  text,
  ativo               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_maxbank_metas_colaborador
  ON maxbank_metas (colaborador_id, status)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_maxbank_metas_setor
  ON maxbank_metas (setor, status)
  WHERE ativo = true;

-- Trigger: updated_at automático.
CREATE OR REPLACE FUNCTION maxbank_metas_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maxbank_metas_updated_at ON maxbank_metas;
CREATE TRIGGER trg_maxbank_metas_updated_at
  BEFORE UPDATE ON maxbank_metas
  FOR EACH ROW EXECUTE FUNCTION maxbank_metas_set_updated_at();

-- =================================================================
-- 2. maxbank_folgas_conquistadas
-- =================================================================
-- Registra cada folga gerada por atingir R$ 2.500 em bonificações.
-- Vinculada ao registro 'ferias' que a folga produz. Serve de marcador
-- pra calcular o acumulado "desde a última folga".
-- =================================================================

CREATE TABLE IF NOT EXISTS maxbank_folgas_conquistadas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id        uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  ferias_id             uuid REFERENCES ferias(id) ON DELETE SET NULL,
  acumulado_consumido   numeric(15,2) NOT NULL DEFAULT 2500.00,
  meta_gatilho_id       uuid REFERENCES maxbank_metas(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maxbank_folgas_colaborador
  ON maxbank_folgas_conquistadas (colaborador_id, created_at DESC);

-- =================================================================
-- 3. UNIQUE parcial: idempotência de crédito de meta na carteira
-- =================================================================
-- Mesmo padrão da Fase 2 (uq_maxbank_transacoes_folha).
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_meta
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'meta';

-- =================================================================
-- 4. RLS — maxbank_metas
-- =================================================================
-- Colaborador lê próprias. Gerente lê do setor (incluindo extras).
-- Admin/CEO/RH leem tudo. INSERT/UPDATE/DELETE via RPC (sem policy
-- de WRITE = bloqueado para authenticated). RPCs SECURITY DEFINER
-- contornam isso.
-- =================================================================

ALTER TABLE maxbank_metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE maxbank_folgas_conquistadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE maxbank_config ENABLE ROW LEVEL SECURITY;

-- maxbank_config: todos os autenticados leem (pra UI mostrar o threshold);
-- só admin/CEO escrevem (via RPC SECURITY DEFINER).
DROP POLICY IF EXISTS maxbank_config_read ON maxbank_config;
CREATE POLICY maxbank_config_read ON maxbank_config
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS maxbank_metas_read ON maxbank_metas;
CREATE POLICY maxbank_metas_read ON maxbank_metas
  FOR SELECT TO authenticated USING (
    colaborador_id = auth.uid()
    OR auth_is_admin()
    OR auth_in_setor('rh')
    OR (setor IS NOT NULL AND setor = ANY(auth_user_setores())
        AND EXISTS (
          SELECT 1 FROM user_profiles up
           WHERE up.id = auth.uid()
             AND up.role IN ('gerente','admin','ceo')
        ))
  );

DROP POLICY IF EXISTS maxbank_folgas_read ON maxbank_folgas_conquistadas;
CREATE POLICY maxbank_folgas_read ON maxbank_folgas_conquistadas
  FOR SELECT TO authenticated USING (
    colaborador_id = auth.uid()
    OR auth_is_admin()
    OR auth_in_setor('rh')
  );

-- =================================================================
-- 5. RPC: criar_meta_maxbank
-- =================================================================
-- Quem chama: gerente do setor, admin, CEO ou RH.
-- Snapshot do setor primário do colaborador é gravado em maxbank_metas.setor.
-- =================================================================

CREATE OR REPLACE FUNCTION public.criar_meta_maxbank(
  p_colaborador_id uuid,
  p_descricao      text,
  p_valor          numeric,
  p_data_inicio    date,
  p_data_fim       date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_caller_role      text;
  v_caller_setores   text[];
  v_alvo_setor       text;
  v_alvo_filial      text;
  v_meta_id          uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor da meta deve ser positivo.';
  END IF;

  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'data_fim não pode ser anterior a data_inicio.';
  END IF;

  -- Quem está chamando?
  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_caller_role, v_caller_setores
    FROM user_profiles WHERE id = v_uid;

  IF v_caller_role NOT IN ('admin','ceo','gerente') AND NOT ('rh' = ANY(v_caller_setores)) THEN
    RAISE EXCEPTION 'Sem permissão para criar metas.';
  END IF;

  -- Snapshot do setor/filial do colaborador alvo.
  SELECT setor, filial INTO v_alvo_setor, v_alvo_filial
    FROM user_profiles WHERE id = p_colaborador_id;

  IF v_alvo_setor IS NULL THEN
    RAISE EXCEPTION 'Colaborador alvo não encontrado.';
  END IF;

  -- Gerente só cria pra colaboradores do(s) próprio(s) setor(es).
  IF v_caller_role = 'gerente'
     AND NOT v_caller_role IN ('admin','ceo')
     AND NOT (v_alvo_setor = ANY(v_caller_setores)) THEN
    RAISE EXCEPTION 'Gerente só pode atribuir meta a colaboradores do próprio setor.';
  END IF;

  INSERT INTO maxbank_metas
    (descricao, valor, data_inicio, data_fim, colaborador_id,
     criada_por, setor, filial, status)
  VALUES
    (p_descricao, p_valor, p_data_inicio, p_data_fim, p_colaborador_id,
     v_uid, v_alvo_setor, v_alvo_filial, 'Pendente')
  RETURNING id INTO v_meta_id;

  RETURN v_meta_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_meta_maxbank(uuid, text, numeric, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_meta_maxbank(uuid, text, numeric, date, date) TO authenticated;

-- =================================================================
-- 6. RPC: concluir_meta_maxbank
-- =================================================================
-- Colaborador dono da meta marca como concluída (aguardando revisão).
-- =================================================================

CREATE OR REPLACE FUNCTION public.concluir_meta_maxbank(p_meta_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_colaborador  uuid;
  v_status       text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT colaborador_id, status INTO v_colaborador, v_status
    FROM maxbank_metas WHERE id = p_meta_id AND COALESCE(ativo,true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta não encontrada.';
  END IF;

  IF v_colaborador <> v_uid THEN
    RAISE EXCEPTION 'Só o colaborador alvo pode marcar a meta como concluída.';
  END IF;

  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Meta precisa estar Pendente para ser concluída (status atual: %).', v_status;
  END IF;

  UPDATE maxbank_metas
     SET status = 'Concluida',
         concluida_em = now()
   WHERE id = p_meta_id;
END;
$$;

REVOKE ALL ON FUNCTION public.concluir_meta_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.concluir_meta_maxbank(uuid) TO authenticated;

-- =================================================================
-- 7. RPC interna: gerar_folgas_acumulado
-- =================================================================
-- Calcula créditos de bonificação consumidos vs já reservados em folgas
-- conquistadas. Enquanto saldo livre >= 2500, gera uma folga (ferias
-- Aprovado, 1 dia, observação 'Folga conquistada por meta de bonificação').
-- Registra cada folga em maxbank_folgas_conquistadas.
-- Retorna quantas folgas foram geradas.
-- =================================================================

CREATE OR REPLACE FUNCTION public.gerar_folgas_acumulado(
  p_colaborador_id uuid,
  p_meta_gatilho   uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold       numeric(15,2);
  v_conta_id        uuid;
  v_total_credito   numeric(15,2);
  v_total_consumido numeric(15,2);
  v_acumulado_livre numeric(15,2);
  v_funcionario_id  uuid;
  v_ferias_id       uuid;
  v_folgas_geradas  integer := 0;
BEGIN
  -- Lê threshold global (admin/CEO ajusta via set_maxbank_threshold).
  SELECT meta_folga_threshold INTO v_threshold FROM maxbank_config WHERE id = 1;
  IF v_threshold IS NULL OR v_threshold <= 0 THEN
    v_threshold := 2500.00;
  END IF;

  SELECT id INTO v_conta_id
    FROM maxbank_contas WHERE colaborador_id = p_colaborador_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Soma de TODOS os créditos em bonificações dessa conta.
  SELECT COALESCE(SUM(valor), 0) INTO v_total_credito
    FROM maxbank_transacoes
   WHERE conta_id = v_conta_id
     AND tipo = 'credito'
     AND carteira = 'bonificacoes';

  -- Soma dos thresholds já consumidos por folgas anteriores (o valor
  -- consumido pode variar se o admin mudou o threshold no meio do caminho).
  SELECT COALESCE(SUM(acumulado_consumido), 0) INTO v_total_consumido
    FROM maxbank_folgas_conquistadas
   WHERE colaborador_id = p_colaborador_id;

  v_acumulado_livre := v_total_credito - v_total_consumido;

  -- Funcionário vinculado (bridge) — folga sai sem funcionario_id se não houver.
  SELECT id INTO v_funcionario_id
    FROM funcionarios
   WHERE user_profile_id = p_colaborador_id
     AND COALESCE(ativo, true) = true
   ORDER BY created_at ASC
   LIMIT 1;

  WHILE v_acumulado_livre >= v_threshold LOOP
    -- Cria registro em ferias com status='Aprovado', sem datas (RH/colaborador
    -- escolhe depois via FeriasView). Se não há funcionario_id, ainda cria
    -- a folga conquistada — RH ajusta o vínculo depois.
    IF v_funcionario_id IS NOT NULL THEN
      INSERT INTO ferias
        (funcionario_id, dias, status, ativo, observacao)
      VALUES
        (v_funcionario_id, 1, 'Aprovado', true,
         'Folga conquistada por meta de bonificação (R$ ' || v_threshold::text || ' acumulados)')
      RETURNING id INTO v_ferias_id;
    ELSE
      v_ferias_id := NULL;
    END IF;

    INSERT INTO maxbank_folgas_conquistadas
      (colaborador_id, ferias_id, acumulado_consumido, meta_gatilho_id)
    VALUES
      (p_colaborador_id, v_ferias_id, v_threshold, p_meta_gatilho);

    v_acumulado_livre := v_acumulado_livre - v_threshold;
    v_folgas_geradas := v_folgas_geradas + 1;
  END LOOP;

  RETURN v_folgas_geradas;
END;
$$;

-- =================================================================
-- RPC: set_maxbank_threshold — admin/CEO ajusta limite da folga
-- =================================================================
CREATE OR REPLACE FUNCTION public.set_maxbank_threshold(p_valor numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT role INTO v_role FROM user_profiles WHERE id = v_uid;

  IF v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO podem ajustar o limite da folga.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser positivo.';
  END IF;

  UPDATE maxbank_config
     SET meta_folga_threshold = p_valor,
         updated_at = now(),
         updated_by = v_uid
   WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.set_maxbank_threshold(numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.set_maxbank_threshold(numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.gerar_folgas_acumulado(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.gerar_folgas_acumulado(uuid, uuid) TO authenticated;

-- =================================================================
-- 8. RPC: aprovar_meta_maxbank
-- =================================================================
-- Gerente do setor / admin / CEO / RH aprova meta Concluída.
-- Atualiza status -> Aprovada, credita saldo_bonificacoes via transação
-- idempotente, dispara gerar_folgas_acumulado e retorna jsonb:
--   { meta_id, transacao_id, folgas_geradas }
-- =================================================================

CREATE OR REPLACE FUNCTION public.aprovar_meta_maxbank(p_meta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_caller_role      text;
  v_caller_setores   text[];
  v_meta             maxbank_metas%ROWTYPE;
  v_conta_id         uuid;
  v_transacao_id     uuid;
  v_folgas_geradas   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_caller_role, v_caller_setores
    FROM user_profiles WHERE id = v_uid;

  SELECT * INTO v_meta
    FROM maxbank_metas WHERE id = p_meta_id AND COALESCE(ativo,true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta não encontrada.';
  END IF;

  IF v_meta.status <> 'Concluida' THEN
    RAISE EXCEPTION 'Meta precisa estar Concluída para ser aprovada (status: %).', v_meta.status;
  END IF;

  -- RBAC: admin/CEO/RH global; gerente só do setor da meta.
  IF NOT (
       v_caller_role IN ('admin','ceo')
       OR 'rh' = ANY(v_caller_setores)
       OR (v_caller_role = 'gerente' AND v_meta.setor = ANY(v_caller_setores))
     ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta meta.';
  END IF;

  -- Conta MaxBank (fallback caso não exista).
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_meta.colaborador_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_conta_id
    FROM maxbank_contas WHERE colaborador_id = v_meta.colaborador_id;

  -- Crédito idempotente (UNIQUE parcial origem='meta').
  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'credito', 'bonificacoes', v_meta.valor,
       'Meta: ' || left(v_meta.descricao, 80),
       'meta', p_meta_id, v_uid)
    RETURNING id INTO v_transacao_id;

    UPDATE maxbank_contas
       SET saldo_bonificacoes = saldo_bonificacoes + v_meta.valor
     WHERE id = v_conta_id;
  EXCEPTION
    WHEN unique_violation THEN
      v_transacao_id := NULL;
  END;

  -- Atualiza meta.
  UPDATE maxbank_metas
     SET status = 'Aprovada',
         aprovada_em = now(),
         aprovada_por = v_uid
   WHERE id = p_meta_id;

  -- Dispara checagem de folga.
  v_folgas_geradas := gerar_folgas_acumulado(v_meta.colaborador_id, p_meta_id);

  RETURN jsonb_build_object(
    'meta_id', p_meta_id,
    'transacao_id', v_transacao_id,
    'folgas_geradas', v_folgas_geradas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_meta_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.aprovar_meta_maxbank(uuid) TO authenticated;

-- =================================================================
-- 9. RPC: rejeitar_meta_maxbank
-- =================================================================

CREATE OR REPLACE FUNCTION public.rejeitar_meta_maxbank(
  p_meta_id  uuid,
  p_feedback text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_caller_role     text;
  v_caller_setores  text[];
  v_meta_setor      text;
  v_meta_status     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_caller_role, v_caller_setores
    FROM user_profiles WHERE id = v_uid;

  SELECT setor, status INTO v_meta_setor, v_meta_status
    FROM maxbank_metas WHERE id = p_meta_id AND COALESCE(ativo,true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta não encontrada.';
  END IF;

  IF v_meta_status <> 'Concluida' THEN
    RAISE EXCEPTION 'Meta precisa estar Concluída para ser rejeitada (status: %).', v_meta_status;
  END IF;

  IF NOT (
       v_caller_role IN ('admin','ceo')
       OR 'rh' = ANY(v_caller_setores)
       OR (v_caller_role = 'gerente' AND v_meta_setor = ANY(v_caller_setores))
     ) THEN
    RAISE EXCEPTION 'Sem permissão para rejeitar esta meta.';
  END IF;

  UPDATE maxbank_metas
     SET status = 'Rejeitada',
         aprovada_em = now(),
         aprovada_por = v_uid,
         feedback_aprovacao = p_feedback
   WHERE id = p_meta_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rejeitar_meta_maxbank(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rejeitar_meta_maxbank(uuid, text) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO (rodar após a migração em cada instância)
-- =================================================================
--   -- Tabelas criadas?
--   SELECT relname FROM pg_class
--    WHERE relname IN ('maxbank_metas','maxbank_folgas_conquistadas');
--
--   -- RPCs publicadas e SECURITY DEFINER?
--   SELECT proname, prosecdef
--     FROM pg_proc
--    WHERE proname IN ('criar_meta_maxbank','concluir_meta_maxbank',
--                      'aprovar_meta_maxbank','rejeitar_meta_maxbank',
--                      'gerar_folgas_acumulado');
--
--   -- UNIQUE parcial pra idempotência criado?
--   SELECT indexname FROM pg_indexes WHERE indexname = 'uq_maxbank_transacoes_meta';
--
--   -- Smoke test (substitua os uuids):
--   --   SELECT criar_meta_maxbank('<colaborador>', 'Bater meta de venda', 500,
--   --                              CURRENT_DATE, CURRENT_DATE + 30);
--   --   SELECT concluir_meta_maxbank('<meta_id>');     (rodar como colaborador)
--   --   SELECT aprovar_meta_maxbank('<meta_id>');      (rodar como gerente)
-- =================================================================
