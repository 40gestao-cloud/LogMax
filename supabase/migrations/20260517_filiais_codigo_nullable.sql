-- =================================================================
-- LogMax — Alinhar filiais.codigo com a UI (nullable)
-- =================================================================
-- FiliaisView nunca teve campo "código" no formulário (só nome, CNPJ,
-- cidade, celular, endereço, representante). O schema original criou
-- `filiais.codigo` como NOT NULL, então qualquer projeto Supabase
-- inicializado "do zero" pelo schema unificado quebra ao salvar
-- a primeira filial pelo app.
--
-- Histórico: a turma de produção original recebeu um ALTER manual
-- (via Dashboard) que nunca foi committado como migration. Esta
-- migration formaliza essa correção para qualquer ambiente futuro
-- (novas turmas, restores, ambientes de homologação).
--
-- Idempotente: usa IF EXISTS check via DO block.
-- Execute no Supabase SQL Editor.
-- =================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'filiais'
      AND column_name  = 'codigo'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE filiais ALTER COLUMN codigo DROP NOT NULL;
  END IF;
END $$;
