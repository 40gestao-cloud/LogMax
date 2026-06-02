-- =================================================================
-- LogMax — Auditoria "quem fez" (Fase 2): cadastros mestres
--
-- Estende o rastreio de autoria já implementado em
-- 20260602_auditoria_quem_fez.sql (Fase 1: Financeiro, Vendas/PDV,
-- Estoque, Compras) para as 16 tabelas de cadastros mestres.
--
-- Reutiliza a função public.set_auditoria_campos() criada na Fase 1
-- — esta migração apenas adiciona colunas + trigger nas novas tabelas.
--
-- Linhas legadas (pré-migração) ficam com criado_por / atualizado_por
-- IS NULL — o componente <AuditoriaInspect> trata como "autoria
-- desconhecida (linha legada)".
--
-- Idempotente — ADD COLUMN IF NOT EXISTS + DROP/CREATE TRIGGER.
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- Pré-condição: função set_auditoria_campos() deve existir (criada
-- em 20260602_auditoria_quem_fez.sql). Se a migração anterior não
-- foi aplicada, este DO block falha antes de tocar nas tabelas.
-- -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_auditoria_campos'
  ) THEN
    RAISE EXCEPTION
      'Função public.set_auditoria_campos() não existe. Aplique 20260602_auditoria_quem_fez.sql primeiro.';
  END IF;
END $$;

-- -----------------------------------------------------------------
-- Para cada tabela de cadastro:
--   - adiciona criado_por / atualizado_por / updated_at
--   - liga o trigger BEFORE INSERT OR UPDATE
-- -----------------------------------------------------------------
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    -- Cadastros principais (têm view dedicada)
    'produtos', 'fornecedores', 'clientes', 'servicos',
    'colaboradores', 'filiais', 'funcionarios',
    -- Cadastros auxiliares (usam GenericCRUDView)
    'cargos', 'departamentos', 'beneficios',
    'centros_custo', 'projetos',
    'condicoes_pagamento', 'classificacoes_auxiliares',
    'mapeamentos_rateio', 'formas_pagamento'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_auditoria
                      BEFORE INSERT OR UPDATE ON %I
                      FOR EACH ROW EXECUTE FUNCTION public.set_auditoria_campos()', t);
  END LOOP;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Conferir colunas em uma tabela:
--    \d+ produtos
--
-- 2. Inserir uma linha de teste (como usuário autenticado):
--    INSERT INTO produtos (codigo, nome, valor) VALUES ('TEST-001', 'teste', 1);
--    SELECT criado_por, atualizado_por, updated_at FROM produtos
--     WHERE codigo = 'TEST-001';
--    -- esperado: criado_por = auth.uid() do usuário;
--                 atualizado_por = criado_por;
--                 updated_at ≈ created_at.
--
-- 3. Atualizar a mesma linha por outro usuário e conferir:
--    atualizado_por troca, criado_por permanece.
-- =================================================================
