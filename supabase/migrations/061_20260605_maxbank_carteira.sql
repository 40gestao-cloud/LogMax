-- =================================================================
-- MaxBank — Carteira do colaborador (Fase 1)
-- =================================================================
-- Cria a infra de saldo + extrato que o MaxBank stand-alone vai ler.
-- Ainda NÃO há crédito automático de folha (isso é Fase 2). Aqui:
--
--   • maxbank_contas       — 1 conta por colaborador, 3 carteiras
--                            (salário, benefícios, bonificações).
--   • maxbank_transacoes   — extrato; origem polimórfica
--                            (folha_pagamento, meta, pdv_beneficio, ...).
--   • Idempotência por folha via UNIQUE parcial (origem_id, carteira)
--     filtrado a origem='folha_pagamento'. Mesmo padrão de
--     `movimentacoes_estoque.recebimento_id`.
--   • Trigger garante conta para cada novo user_profiles.
--   • Backfill cria conta para colaboradores existentes.
--   • RLS: colaborador lê só a sua; admin/CEO/financeiro/RH leem todas.
--     INSERT/UPDATE só via service_role ou RPC (Fase 2).
--   • Realtime publication habilitada para o PDV escutar saldo de
--     benefícios (Fase 5).
--
-- IDEMPOTENTE: pode rodar várias vezes nas 4 instâncias com colaboradores
-- (LogMax ERP, Contabilidade, Aprendiz, ADM). NÃO rodar na instância 5
-- (MaxPOS — PDV): não tem user_profiles e a FK falha.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. maxbank_contas
-- =================================================================

CREATE TABLE IF NOT EXISTS maxbank_contas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id      uuid NOT NULL UNIQUE
                       REFERENCES user_profiles(id) ON DELETE CASCADE,
  saldo_salario       numeric(15,2) NOT NULL DEFAULT 0
                       CHECK (saldo_salario >= 0),
  saldo_beneficios    numeric(15,2) NOT NULL DEFAULT 0
                       CHECK (saldo_beneficios >= 0),
  saldo_bonificacoes  numeric(15,2) NOT NULL DEFAULT 0
                       CHECK (saldo_bonificacoes >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Trigger: updated_at automático.
CREATE OR REPLACE FUNCTION maxbank_contas_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maxbank_contas_updated_at ON maxbank_contas;
CREATE TRIGGER trg_maxbank_contas_updated_at
  BEFORE UPDATE ON maxbank_contas
  FOR EACH ROW EXECUTE FUNCTION maxbank_contas_set_updated_at();

-- =================================================================
-- 2. maxbank_transacoes
-- =================================================================

CREATE TABLE IF NOT EXISTS maxbank_transacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id     uuid NOT NULL REFERENCES maxbank_contas(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('credito', 'debito')),
  carteira     text NOT NULL CHECK (carteira IN ('salario', 'beneficios', 'bonificacoes')),
  valor        numeric(15,2) NOT NULL CHECK (valor > 0),
  descricao    text NOT NULL,
  origem       text,
  origem_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_maxbank_transacoes_conta_data
  ON maxbank_transacoes (conta_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maxbank_transacoes_origem
  ON maxbank_transacoes (origem, origem_id)
  WHERE origem IS NOT NULL;

-- Idempotência da Fase 2: mesma folha não credita 2x na mesma carteira.
-- Pattern: parcial WHERE origem='folha_pagamento' (memória feedback_partial_unique_soft_delete).
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_folha
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'folha_pagamento';

-- =================================================================
-- 3. Auto-criação de conta para cada user_profiles novo
-- =================================================================

CREATE OR REPLACE FUNCTION criar_maxbank_conta_para_colaborador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (NEW.id)
  ON CONFLICT (colaborador_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_maxbank_conta ON user_profiles;
CREATE TRIGGER trg_user_profiles_maxbank_conta
  AFTER INSERT ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION criar_maxbank_conta_para_colaborador();

-- =================================================================
-- 4. Backfill — colaboradores existentes ganham conta zerada.
-- =================================================================

INSERT INTO maxbank_contas (colaborador_id)
SELECT up.id
FROM user_profiles up
WHERE NOT EXISTS (
  SELECT 1 FROM maxbank_contas mc WHERE mc.colaborador_id = up.id
);

-- =================================================================
-- 5. RLS
-- =================================================================

ALTER TABLE maxbank_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE maxbank_transacoes ENABLE ROW LEVEL SECURITY;

-- Colaborador lê a própria conta; admin/CEO/financeiro/RH leem todas.
DROP POLICY IF EXISTS maxbank_contas_read ON maxbank_contas;
CREATE POLICY maxbank_contas_read ON maxbank_contas
  FOR SELECT TO authenticated USING (
    colaborador_id = auth.uid()
    OR auth_is_admin()
    OR auth_in_setor('financeiro', 'rh')
  );

-- Colaborador lê extrato da própria conta; mesmos cargos leem tudo.
DROP POLICY IF EXISTS maxbank_transacoes_read ON maxbank_transacoes;
CREATE POLICY maxbank_transacoes_read ON maxbank_transacoes
  FOR SELECT TO authenticated USING (
    conta_id IN (SELECT id FROM maxbank_contas WHERE colaborador_id = auth.uid())
    OR auth_is_admin()
    OR auth_in_setor('financeiro', 'rh')
  );

-- INSERT/UPDATE/DELETE: sem policy = bloqueado para authenticated.
-- service_role bypassa RLS e cobre o caso da Fase 2 (RPC SECURITY DEFINER).

-- =================================================================
-- 6. Realtime publication (Fase 5: PDV vai escutar saldo de benefícios)
-- =================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'maxbank_contas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE maxbank_contas;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO (rodar após a migração)
-- =================================================================
--   -- Toda pessoa em user_profiles tem conta?
--   SELECT count(*) AS sem_conta
--     FROM user_profiles up
--    WHERE NOT EXISTS (SELECT 1 FROM maxbank_contas WHERE colaborador_id = up.id);
--   -- Esperado: 0.
--
--   -- Saldos zerados após backfill?
--   SELECT count(*) AS contas, sum(saldo_salario+saldo_beneficios+saldo_bonificacoes) AS total
--     FROM maxbank_contas;
--   -- Esperado: total = 0.
--
--   -- Logado como colaborador, conseguir ler só a própria:
--   SELECT colaborador_id FROM maxbank_contas;  -- 1 linha.
-- =================================================================
