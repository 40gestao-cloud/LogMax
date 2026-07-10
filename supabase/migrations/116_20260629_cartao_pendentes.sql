-- =================================================================
-- LogMax — Fluxo Cartão (Maquininha) interativo
-- =================================================================
-- Objetivo:
--   Suportar pagamento Débito/Crédito via maquininha simulada (MaxPay)
--   em duas fases:
--     1. PDV cria registro em cartao_pendentes (status='aguardando') e
--        sinaliza maquininha; itens NÃO são persistidos ainda.
--     2. MaxBank (cliente) lê QR `LOGMAX-CARTAO-<id>` e autoriza:
--        - Débito: debita saldo_salario
--        - Crédito: registra fatura (sem debitar saldo)
--     3. PDV escuta via realtime/polling e chama criar_venda_pdv.
-- =================================================================

CREATE TABLE IF NOT EXISTS cartao_pendentes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valor        numeric(15,2) NOT NULL CHECK (valor >= 0),
  metodo       text NOT NULL CHECK (metodo IN ('debito', 'credito')),
  parcelas     int NOT NULL DEFAULT 1 CHECK (parcelas BETWEEN 1 AND 12),
  status       text NOT NULL DEFAULT 'aguardando'
               CHECK (status IN ('aguardando', 'autorizado', 'cancelado')),
  operador_id  uuid,
  user_id      uuid,
  card_last_four text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);

CREATE INDEX IF NOT EXISTS cartao_pendentes_status_idx
  ON cartao_pendentes (status, created_at DESC);

ALTER TABLE cartao_pendentes ENABLE ROW LEVEL SECURITY;

-- Authenticated (PDV) — acesso total
DROP POLICY IF EXISTS cartao_pendentes_auth_all ON cartao_pendentes;
CREATE POLICY cartao_pendentes_auth_all
  ON cartao_pendentes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Anonymous (MaxPay/MaxBank scan) — lookup por id quando aguardando
DROP POLICY IF EXISTS cartao_pendentes_anon_select ON cartao_pendentes;
CREATE POLICY cartao_pendentes_anon_select
  ON cartao_pendentes FOR SELECT TO anon
  USING (status = 'aguardando');

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cartao_pendentes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cartao_pendentes;
  END IF;
END $$;

-- Trigger paid_at
CREATE OR REPLACE FUNCTION cartao_pendentes_set_paid_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'autorizado' AND OLD.status <> 'autorizado' THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cartao_pendentes_paid_at ON cartao_pendentes;
CREATE TRIGGER trg_cartao_pendentes_paid_at
  BEFORE UPDATE ON cartao_pendentes
  FOR EACH ROW EXECUTE FUNCTION cartao_pendentes_set_paid_at();

-- =================================================================
-- RPC: autorizar_cartao_maxbank
-- Chamado pelo MaxBank ao escanear QR LOGMAX-CARTAO-<id>.
-- - Débito: debita saldo_salario do funcionário autenticado
-- - Crédito: registra transação tipo 'fatura' (não debita saldo)
-- - Idempotente: se já autorizado, retorna 'ja_autorizado'
-- =================================================================
CREATE OR REPLACE FUNCTION autorizar_cartao_maxbank(
  p_id uuid,
  p_user_id uuid,
  p_card_last_four text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pendente cartao_pendentes;
  v_conta_id uuid;
  v_saldo_atual numeric;
  v_descricao text;
BEGIN
  -- Busca pendente
  SELECT * INTO v_pendente FROM cartao_pendentes WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobrança não encontrada.');
  END IF;

  IF v_pendente.status = 'autorizado' THEN
    RETURN jsonb_build_object('status', 'ja_autorizado');
  END IF;

  IF v_pendente.status <> 'aguardando' THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobrança cancelada ou inválida.');
  END IF;

  -- Busca conta MaxBank do usuário
  SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = p_user_id;
  IF v_conta_id IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Conta MaxBank não encontrada.');
  END IF;

  v_descricao := 'Compra cartão ' || v_pendente.metodo
              || CASE WHEN v_pendente.parcelas > 1
                      THEN ' ' || v_pendente.parcelas || 'x'
                      ELSE '' END;

  IF v_pendente.metodo = 'debito' THEN
    -- Verifica saldo
    SELECT saldo_salario INTO v_saldo_atual FROM maxbank_contas WHERE id = v_conta_id;
    IF v_saldo_atual < v_pendente.valor THEN
      RETURN jsonb_build_object(
        'status', 'erro',
        'mensagem', 'Saldo de salário insuficiente.',
        'saldo', v_saldo_atual
      );
    END IF;

    -- Debita saldo_salario
    UPDATE maxbank_contas
       SET saldo_salario = saldo_salario - v_pendente.valor
     WHERE id = v_conta_id;

    INSERT INTO maxbank_transacoes (conta_id, tipo, carteira, valor, descricao, origem)
    VALUES (v_conta_id, 'debito', 'salario', v_pendente.valor, v_descricao, 'cartao_maquininha');
  ELSE
    -- Crédito: registra transação fatura (não muda saldo)
    INSERT INTO maxbank_transacoes (conta_id, tipo, carteira, valor, descricao, origem)
    VALUES (v_conta_id, 'debito', 'fatura', v_pendente.valor, v_descricao, 'cartao_maquininha');
  END IF;

  -- Marca cartão como autorizado
  UPDATE cartao_pendentes
     SET status = 'autorizado',
         user_id = p_user_id,
         card_last_four = COALESCE(p_card_last_four, card_last_four)
   WHERE id = p_id;

  RETURN jsonb_build_object('status', 'autorizado', 'valor', v_pendente.valor, 'metodo', v_pendente.metodo);
END;
$$;

GRANT EXECUTE ON FUNCTION autorizar_cartao_maxbank(uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION autorizar_cartao_maxbank(uuid, uuid, text) TO authenticated;
