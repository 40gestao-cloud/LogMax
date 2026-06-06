-- =================================================================
-- MaxBank — Pix entre colaboradores (Fase 6)
-- =================================================================
-- Colaborador A envia saldo_salario pra colaborador B da MESMA filial.
-- Sem aceite do destinatário (igual Pix real). Idempotência por
-- p_idempotency_key gerada pelo cliente (evita duplo clique e retry).
--
-- DEPENDÊNCIAS:
--   • 20260605_maxbank_carteira.sql  (maxbank_contas/transacoes)
--   • user_profiles (filial, email, nome, role, setor)
--
-- IDEMPOTENTE. Rodar nas 4 instâncias com colaboradores (ERP, Contabilidade,
-- Aprendiz, ADM). NÃO rodar no MaxPOS (5) — não tem user_profiles.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. maxbank_transferencias
-- =================================================================
CREATE TABLE IF NOT EXISTS maxbank_transferencias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     uuid NOT NULL,
  de_colaborador_id   uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  para_colaborador_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  -- Snapshot do nome — sobrevive a renomeação/soft-delete pro extrato.
  de_nome             text,
  para_nome           text,
  valor               numeric(15,2) NOT NULL CHECK (valor > 0),
  descricao           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (de_colaborador_id <> para_colaborador_id)
);

-- Idempotência: cliente envia o mesmo uuid em retries; INSERT colide e
-- a RPC trata "já enviado" sem refazer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transferencias_idemp
  ON maxbank_transferencias (de_colaborador_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_maxbank_transferencias_emissor
  ON maxbank_transferencias (de_colaborador_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maxbank_transferencias_destinatario
  ON maxbank_transferencias (para_colaborador_id, created_at DESC);

-- =================================================================
-- 2. UNIQUE parcial em maxbank_transacoes — idempotência das 2 linhas
-- =================================================================
-- Cada transferência gera 1 débito (origem='transferencia_envio') e 1
-- crédito (origem='transferencia_recebimento'). origem_id em ambas é o
-- id da transferência. Index garante que UMA mesma transferência só pode
-- ter 1 débito e 1 crédito.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_transferencia
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem IN ('transferencia_envio', 'transferencia_recebimento');

-- =================================================================
-- 3. RLS
-- =================================================================
ALTER TABLE maxbank_transferencias ENABLE ROW LEVEL SECURITY;

-- Participante (emissor ou destinatário) lê. Admin/CEO/financeiro/RH global.
DROP POLICY IF EXISTS maxbank_transferencias_read ON maxbank_transferencias;
CREATE POLICY maxbank_transferencias_read ON maxbank_transferencias
  FOR SELECT TO authenticated USING (
    de_colaborador_id   = auth.uid()
    OR para_colaborador_id = auth.uid()
    OR auth_is_admin()
    OR auth_in_setor('financeiro', 'rh')
  );

-- INSERT/UPDATE/DELETE só via RPC SECURITY DEFINER (sem policy = bloqueado).

-- =================================================================
-- 4. RPC buscar_destinatario_pix
-- =================================================================
-- Retorna jsonb { existe: bool, nome?: text, setor?: text }
-- - existe=false quando email não acha NA MESMA FILIAL do emissor.
-- - existe=false quando email == do próprio emissor (bloqueia auto-Pix).
-- =================================================================
CREATE OR REPLACE FUNCTION public.buscar_destinatario_pix(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_emissor_email text;
  v_emissor_fil   text;
  v_dest_nome     text;
  v_dest_setor    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  SELECT email, filial INTO v_emissor_email, v_emissor_fil
    FROM user_profiles WHERE id = v_uid;

  IF lower(p_email) = lower(v_emissor_email) THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  SELECT nome, setor INTO v_dest_nome, v_dest_setor
    FROM user_profiles
   WHERE lower(email) = lower(p_email)
     AND filial = v_emissor_fil
   LIMIT 1;

  IF NOT FOUND OR v_dest_nome IS NULL THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'nome',   v_dest_nome,
    'setor',  v_dest_setor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_destinatario_pix(text) FROM public;
GRANT EXECUTE ON FUNCTION public.buscar_destinatario_pix(text) TO authenticated;

-- =================================================================
-- 5. RPC transferir_pix_maxbank
-- =================================================================
-- Retorna jsonb:
--   { status: 'enviado' | 'ja_enviado',
--     transferencia_id, destinatario_nome, saldo_apos }
-- Falha:
--   • Não autenticado.
--   • valor <= 0 ou idempotency_key null.
--   • Auto-Pix.
--   • Destinatário não encontrado (mesma filial).
--   • Saldo insuficiente.
-- =================================================================
CREATE OR REPLACE FUNCTION public.transferir_pix_maxbank(
  p_email           text,
  p_valor           numeric,
  p_descricao       text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_emissor_email    text;
  v_emissor_nome     text;
  v_emissor_filial   text;
  v_emissor_conta    uuid;
  v_emissor_saldo    numeric(15,2);
  v_dest_id          uuid;
  v_dest_nome        text;
  v_dest_conta       uuid;
  v_transf_id        uuid;
  v_descricao_envio  text;
  v_descricao_receb  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser positivo.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key obrigatório.';
  END IF;

  SELECT email, nome, filial INTO v_emissor_email, v_emissor_nome, v_emissor_filial
    FROM user_profiles WHERE id = v_uid;

  -- Idempotência: já tem transferência com essa key desse emissor?
  SELECT t.id, t.para_nome INTO v_transf_id, v_dest_nome
    FROM maxbank_transferencias t
   WHERE t.de_colaborador_id = v_uid
     AND t.idempotency_key = p_idempotency_key
   LIMIT 1;

  IF v_transf_id IS NOT NULL THEN
    SELECT mc.saldo_salario INTO v_emissor_saldo
      FROM maxbank_contas mc WHERE mc.colaborador_id = v_uid;
    RETURN jsonb_build_object(
      'status',             'ja_enviado',
      'transferencia_id',   v_transf_id,
      'destinatario_nome',  v_dest_nome,
      'saldo_apos',         v_emissor_saldo
    );
  END IF;

  IF lower(COALESCE(p_email,'')) = lower(COALESCE(v_emissor_email,'')) THEN
    RAISE EXCEPTION 'Não é possível transferir pra si mesmo.';
  END IF;

  -- Destinatário (mesma filial).
  SELECT id, nome INTO v_dest_id, v_dest_nome
    FROM user_profiles
   WHERE lower(email) = lower(p_email)
     AND filial = v_emissor_filial
   LIMIT 1;

  IF v_dest_id IS NULL THEN
    RAISE EXCEPTION 'Destinatário não encontrado na sua filial.';
  END IF;

  -- Conta do emissor + LOCK pra travar saldo durante a transação.
  SELECT id, saldo_salario INTO v_emissor_conta, v_emissor_saldo
    FROM maxbank_contas
   WHERE colaborador_id = v_uid
   FOR UPDATE;

  IF v_emissor_conta IS NULL THEN
    RAISE EXCEPTION 'Sua conta MaxBank não foi encontrada.';
  END IF;

  IF v_emissor_saldo < p_valor THEN
    RAISE EXCEPTION 'Saldo de salário insuficiente. Disponível: R$ %.', v_emissor_saldo;
  END IF;

  -- Conta do destinatário (fallback de criação caso não tenha).
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_dest_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_dest_conta
    FROM maxbank_contas WHERE colaborador_id = v_dest_id
    FOR UPDATE;

  -- Grava transferência + débito + crédito.
  INSERT INTO maxbank_transferencias
    (idempotency_key, de_colaborador_id, para_colaborador_id,
     de_nome, para_nome, valor, descricao)
  VALUES
    (p_idempotency_key, v_uid, v_dest_id,
     v_emissor_nome, v_dest_nome, p_valor, NULLIF(trim(COALESCE(p_descricao,'')),''))
  RETURNING id INTO v_transf_id;

  v_descricao_envio := 'Pix enviado a ' || COALESCE(v_dest_nome, 'colaborador');
  v_descricao_receb := 'Pix recebido de ' || COALESCE(v_emissor_nome, 'colaborador');

  -- Débito no emissor.
  INSERT INTO maxbank_transacoes
    (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
  VALUES
    (v_emissor_conta, 'debito', 'salario', p_valor,
     v_descricao_envio, 'transferencia_envio', v_transf_id, v_uid);

  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario - p_valor
   WHERE id = v_emissor_conta;

  -- Crédito no destinatário.
  INSERT INTO maxbank_transacoes
    (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
  VALUES
    (v_dest_conta, 'credito', 'salario', p_valor,
     v_descricao_receb, 'transferencia_recebimento', v_transf_id, v_uid);

  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario + p_valor
   WHERE id = v_dest_conta;

  SELECT saldo_salario INTO v_emissor_saldo
    FROM maxbank_contas WHERE id = v_emissor_conta;

  RETURN jsonb_build_object(
    'status',             'enviado',
    'transferencia_id',   v_transf_id,
    'destinatario_nome',  v_dest_nome,
    'saldo_apos',         v_emissor_saldo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transferir_pix_maxbank(text, numeric, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.transferir_pix_maxbank(text, numeric, text, uuid) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT * FROM information_schema.tables WHERE table_name = 'maxbank_transferencias';
--   SELECT proname FROM pg_proc WHERE proname IN ('buscar_destinatario_pix','transferir_pix_maxbank');
--   SELECT indexname FROM pg_indexes WHERE indexname = 'uq_maxbank_transacoes_transferencia';
--
--   -- Smoke (rodar como colaborador A, B na mesma filial):
--   --   SELECT buscar_destinatario_pix('b@empresa.com');
--   --   SELECT transferir_pix_maxbank('b@empresa.com', 50, 'almoço',
--   --                                  gen_random_uuid());
-- =================================================================
