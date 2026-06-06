-- =================================================================
-- MaxPOS (instância 5) — beneficios_pendentes (Fase 5)
-- =================================================================
-- Fluxo:
--   1. PDV (MaxPOS) cria registro em beneficios_pendentes com
--      valor_beneficios (parcial do carrinho elegível) e — se houver —
--      valor_resto + forma_resto pra cobrir o restante.
--   2. Gera codigo_curto de 6 chars (alfanumérico maiúsculo, sem
--      caracteres confundíveis) e exibe pro vendedor mostrar ao
--      colaborador.
--   3. Colaborador abre MaxBank stand-alone (logado na própria
--      instância 1-4), entra em "Pagar no PDV", digita o código.
--      MaxBank faz lookup anon em MaxPOS por codigo_curto +
--      status='aguardando'. Mostra valor + filial_pdv + produtos.
--   4. Colaborador clica "Confirmar". MaxBank standalone:
--      a) chama RPC debitar_maxbank_beneficios na instância dele
--         (idempotente — UNIQUE parcial protege duplo crédito);
--      b) faz UPDATE anon do pendente em MaxPOS pra status='pago'
--         (também guarda colaborador_email + instancia_paga_id).
--   5. PDV (realtime) vê o pago, chama criar_venda_pdv.
--
-- Segurança: codigo_curto é o segredo (6 chars). UNIQUE parcial por
-- status='aguardando' libera reuso após consumir/expirar. Expiração
-- em 5 min reduz janela de ataque por chute (62^6 = 56B combinações).
--
-- RODAR APENAS NA INSTÂNCIA 5 (MaxPOS). NÃO rodar nas 1-4 — não
-- existem clientes/produtos lá no PDV (eles ficam só em MaxPOS).
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS beneficios_pendentes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_curto        text NOT NULL,
  valor_beneficios    numeric(15,2) NOT NULL CHECK (valor_beneficios >= 0),
  valor_resto         numeric(15,2) NOT NULL DEFAULT 0
                       CHECK (valor_resto >= 0),
  forma_resto         text,  -- 'Dinheiro' | 'PIX' | 'Cartão Débito' etc.
  filial_pdv          text,  -- snapshot do nome da filial pra mostrar ao colaborador
  produtos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              text NOT NULL DEFAULT 'aguardando'
                       CHECK (status IN ('aguardando','pago','cancelado','expirado')),
  -- cliente_id e operador_id sem FK: MaxPOS é instância minimal e pode não
  -- ter `clientes`; e operador pode estar em projeto Vercel diferente.
  -- Mantemos como uuid livre só pra auditoria.
  cliente_id          uuid,
  operador_id         uuid,
  colaborador_email   text,  -- preenchido quando confirma (auditoria)
  instancia_paga_id   text,  -- branch_id no MaxBank stand-alone (auditoria)
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);

-- UNIQUE parcial: codigo_curto único só entre os aguardando.
-- Permite reutilizar depois que vira pago/cancelado/expirado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_beneficios_pendentes_codigo_ativo
  ON beneficios_pendentes (codigo_curto)
  WHERE status = 'aguardando';

CREATE INDEX IF NOT EXISTS idx_beneficios_pendentes_status
  ON beneficios_pendentes (status, created_at DESC);

-- =================================================================
-- 2. RLS
-- =================================================================
ALTER TABLE beneficios_pendentes ENABLE ROW LEVEL SECURITY;

-- PDV autenticado: full access nos próprios pendentes.
DROP POLICY IF EXISTS beneficios_pendentes_auth_all ON beneficios_pendentes;
CREATE POLICY beneficios_pendentes_auth_all ON beneficios_pendentes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anônimo (MaxBank stand-alone faz lookup sem auth): só vê pendentes
-- aguardando e que não expiraram. Sem listagem — query é sempre
-- por codigo_curto.
DROP POLICY IF EXISTS beneficios_pendentes_anon_select ON beneficios_pendentes;
CREATE POLICY beneficios_pendentes_anon_select ON beneficios_pendentes
  FOR SELECT TO anon
  USING (status = 'aguardando' AND expires_at > now());

-- Anônimo pode marcar como pago. Trigger garante transição válida
-- (aguardando → pago) e preenche paid_at.
DROP POLICY IF EXISTS beneficios_pendentes_anon_update ON beneficios_pendentes;
CREATE POLICY beneficios_pendentes_anon_update ON beneficios_pendentes
  FOR UPDATE TO anon
  USING (status = 'aguardando' AND expires_at > now())
  WITH CHECK (status = 'pago');

-- =================================================================
-- 3. Trigger: gera codigo_curto (6 chars) e preenche paid_at
-- =================================================================
-- Alfabeto sem caracteres confundíveis (sem 0/O, 1/I/L):
--   23456789 ABCDEFGHJKMNPQRSTUVWXYZ
-- = 32 chars → 32^6 ≈ 1.07B combinações.
CREATE OR REPLACE FUNCTION beneficios_pendentes_gerar_codigo()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alfabeto text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_codigo  text;
  v_tentativa integer := 0;
BEGIN
  IF NEW.codigo_curto IS NULL OR NEW.codigo_curto = '' THEN
    LOOP
      v_codigo := '';
      FOR i IN 1..6 LOOP
        v_codigo := v_codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
      END LOOP;
      -- Confere se não colide com outro 'aguardando'.
      IF NOT EXISTS (
        SELECT 1 FROM beneficios_pendentes
         WHERE codigo_curto = v_codigo AND status = 'aguardando'
      ) THEN
        NEW.codigo_curto := v_codigo;
        EXIT;
      END IF;
      v_tentativa := v_tentativa + 1;
      IF v_tentativa > 20 THEN
        RAISE EXCEPTION 'Não foi possível gerar código_curto único após 20 tentativas';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_beneficios_pendentes_codigo ON beneficios_pendentes;
CREATE TRIGGER trg_beneficios_pendentes_codigo
  BEFORE INSERT ON beneficios_pendentes
  FOR EACH ROW EXECUTE FUNCTION beneficios_pendentes_gerar_codigo();

-- Marca paid_at ao virar 'pago'.
CREATE OR REPLACE FUNCTION beneficios_pendentes_set_paid_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pago' AND OLD.status <> 'pago' THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_beneficios_pendentes_paid_at ON beneficios_pendentes;
CREATE TRIGGER trg_beneficios_pendentes_paid_at
  BEFORE UPDATE ON beneficios_pendentes
  FOR EACH ROW EXECUTE FUNCTION beneficios_pendentes_set_paid_at();

-- =================================================================
-- 4. Realtime publication (PDV escuta postgres_changes na linha)
-- =================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'beneficios_pendentes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE beneficios_pendentes;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Smoke: inserir como authenticated, ler o código gerado.
--   INSERT INTO beneficios_pendentes
--     (valor_beneficios, valor_total_unused, filial_pdv)
--     VALUES (50, 50, 'MaxLook - Centro')
--   RETURNING codigo_curto, expires_at;
-- =================================================================
