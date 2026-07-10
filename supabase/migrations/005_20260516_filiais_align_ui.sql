-- =================================================================
-- LogMax — Alinhar tabela filiais com a UI
-- =================================================================
-- FiliaisView envia os campos `celular`, `endereco` e `representante`
-- no INSERT/UPDATE, mas a tabela original tem apenas `responsavel`
-- (sem celular nem endereco). Resultado: salvar falha com
-- "Could not find the 'celular' column of 'filiais' in the schema cache".
--
-- `responsavel` em filiais não é referenciado em nenhum outro código
-- nem SQL (centros_custo/departamentos/projetos têm sua própria coluna
-- com mesmo nome — ficam intactas).
--
-- Solução:
--   1. Renomear filiais.responsavel → filiais.representante (single
--      source of truth com a UI).
--   2. Adicionar colunas `celular` e `endereco` se ausentes.
--
-- Idempotente: cobre os estados possíveis em produção (apenas
-- responsavel, apenas representante, nada, ou mix).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

DO $$
BEGIN
  -- 1) responsavel → representante
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'filiais' AND column_name = 'responsavel'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'filiais' AND column_name = 'representante'
  ) THEN
    ALTER TABLE filiais RENAME COLUMN responsavel TO representante;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'filiais' AND column_name = 'representante'
  ) THEN
    ALTER TABLE filiais ADD COLUMN representante text;
  END IF;

  -- 2) celular
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'filiais' AND column_name = 'celular'
  ) THEN
    ALTER TABLE filiais ADD COLUMN celular text;
  END IF;

  -- 3) endereco
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'filiais' AND column_name = 'endereco'
  ) THEN
    ALTER TABLE filiais ADD COLUMN endereco text;
  END IF;
END $$;
