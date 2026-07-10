-- =================================================================
-- MaxBank — Crédito automático ao pagar folha (Fase 2)
-- =================================================================
-- Quando RH transita uma folha de Processada → Paga, esta migration
-- habilita o crédito automático na carteira MaxBank do colaborador:
--   • Bridge funcionarios.user_profile_id pra ligar funcionário (RH)
--     → user_profile (auth) — backfill por email + trigger auto-link.
--   • RPC creditar_folha_maxbank(p_folha_id) credita salário líquido
--     em maxbank_contas.saldo_salario e registra extrato.
--   • Idempotência via UNIQUE parcial criado na Fase 1
--     (uq_maxbank_transacoes_folha) — chamar 2x é seguro.
--
-- DEPENDÊNCIAS:
--   - 20260605_maxbank_carteira.sql (Fase 1) — maxbank_contas/transacoes.
--   - rh_tables.sql                          — funcionarios, folha_pagamento.
--   - user_profiles_table.sql                — user_profiles.
--
-- IDEMPOTENTE: pode rodar várias vezes nas 4 instâncias com colaboradores
-- (ERP, Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS-PDV.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. Bridge: funcionarios.user_profile_id
-- =================================================================

ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS user_profile_id uuid
    REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_funcionarios_user_profile_id
  ON funcionarios (user_profile_id)
  WHERE user_profile_id IS NOT NULL;

-- Backfill via email-match (case-insensitive). Idempotente: WHERE user_profile_id IS NULL.
UPDATE funcionarios f
   SET user_profile_id = up.id
  FROM user_profiles up
 WHERE f.user_profile_id IS NULL
   AND f.email IS NOT NULL
   AND lower(f.email) = lower(up.email);

-- Trigger: auto-vincula quando INSERT/UPDATE de email no funcionário
-- (e o vínculo ainda não existe).
CREATE OR REPLACE FUNCTION funcionarios_autovincular_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_profile_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT id INTO NEW.user_profile_id
      FROM user_profiles
     WHERE lower(email) = lower(NEW.email)
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funcionarios_autovincular ON funcionarios;
CREATE TRIGGER trg_funcionarios_autovincular
  BEFORE INSERT OR UPDATE OF email ON funcionarios
  FOR EACH ROW EXECUTE FUNCTION funcionarios_autovincular_user_profile();

-- =================================================================
-- 2. RPC: creditar_folha_maxbank
-- =================================================================
-- Chamada pelo frontend após dbSetStatus(folha, 'Paga'). Não muda
-- o status — apenas credita. Se falhar, RH vê toast e ajusta cadastro.
--
-- Retorno:
--   • UUID da maxbank_transacoes criada (caso novo)
--   • NULL quando a folha já foi creditada antes (duplicata silenciosa)
--
-- Falha (RAISE EXCEPTION):
--   • Folha inexistente ou inativa → ERRCODE P0002.
--   • Funcionário sem user_profile_id (email não casa com user_profiles).
--   • salario_liquido <= 0.
-- =================================================================

CREATE OR REPLACE FUNCTION public.creditar_folha_maxbank(p_folha_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_funcionario_id    uuid;
  v_user_profile_id   uuid;
  v_salario_liquido   numeric(15,2);
  v_mes_ref           text;
  v_status            text;
  v_ativo             boolean;
  v_conta_id          uuid;
  v_transacao_id      uuid;
  v_descricao         text;
BEGIN
  -- 1. Lê folha.
  SELECT funcionario_id, salario_liquido, mes_ref, status, COALESCE(ativo, true)
    INTO v_funcionario_id, v_salario_liquido, v_mes_ref, v_status, v_ativo
    FROM folha_pagamento
   WHERE id = p_folha_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada: %', p_folha_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_ativo = false THEN
    RAISE EXCEPTION 'Folha inativa (soft-deleted) não pode ser creditada.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_salario_liquido IS NULL OR v_salario_liquido <= 0 THEN
    RAISE EXCEPTION 'Salário líquido inválido (% para folha %).', v_salario_liquido, p_folha_id;
  END IF;

  -- 2. Bridge: funcionário precisa ter user_profile vinculado.
  SELECT user_profile_id INTO v_user_profile_id
    FROM funcionarios
   WHERE id = v_funcionario_id;

  IF v_user_profile_id IS NULL THEN
    RAISE EXCEPTION 'Funcionário sem conta de colaborador. Confira o email cadastrado em RH e em user_profiles.';
  END IF;

  -- 3. Garante que existe maxbank_contas pro colaborador (fallback caso
  --    o backfill da Fase 1 tenha perdido alguém criado depois).
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_user_profile_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_conta_id
    FROM maxbank_contas
   WHERE colaborador_id = v_user_profile_id;

  -- 4. Insere transação. Idempotência via UNIQUE parcial criado na Fase 1.
  v_descricao := 'Folha ' || COALESCE(v_mes_ref, '?') || ' — salário líquido';

  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'credito', 'salario', v_salario_liquido,
       v_descricao, 'folha_pagamento', p_folha_id, auth.uid())
    RETURNING id INTO v_transacao_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Folha já foi creditada antes; idempotente.
      RETURN NULL;
  END;

  -- 5. Atualiza saldo SÓ quando o INSERT foi novo (else dessincroniza).
  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario + v_salario_liquido
   WHERE id = v_conta_id;

  RETURN v_transacao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.creditar_folha_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.creditar_folha_maxbank(uuid) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO (rodar após a migração em cada instância)
-- =================================================================
--   -- Backfill: quem ficou sem vínculo?
--   SELECT count(*) FILTER (WHERE user_profile_id IS NOT NULL) AS vinculados,
--          count(*) FILTER (WHERE user_profile_id IS NULL)     AS sem_vinculo
--     FROM funcionarios;
--
--   -- Lista funcionários sem vínculo (revisar emails):
--   SELECT id, nome, email FROM funcionarios WHERE user_profile_id IS NULL;
--
--   -- RPC existe e é SECURITY DEFINER?
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'creditar_folha_maxbank';
-- =================================================================
