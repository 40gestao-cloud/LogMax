-- =================================================================
-- LogMax — Alinhar tabela colaboradores com a UI (celular)
-- =================================================================
-- ColaboradoresView usa o campo 'celular' no form, search, lista e
-- edição, mas a tabela tinha 'telefone' do schema original. Resultado:
-- INSERT/UPDATE rebentava com "Could not find the 'celular' column".
--
-- 'telefone' não é referenciado em nenhum outro código nem SQL.
-- Solução: renomear para alinhar com a UI (single source of truth).
--
-- Idempotente: cobre os 3 estados possíveis em produção (apenas
-- telefone, apenas celular, ou nada — caso TRUNCATE+recreate).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'colaboradores' AND column_name = 'telefone'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'colaboradores' AND column_name = 'celular'
  ) THEN
    ALTER TABLE colaboradores RENAME COLUMN telefone TO celular;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'colaboradores' AND column_name = 'celular'
  ) THEN
    ALTER TABLE colaboradores ADD COLUMN celular text;
  END IF;
END $$;
