-- =================================================================
-- LogMax — Alinhar tabelas clientes/fornecedores com o CRMView
-- =================================================================
-- O CRMView envia colunas que não batem com o schema original:
--   clientes:    pessoa_tipo (DB: tipo), cpf_cnpj (DB: cnpj_cpf),
--                endereco (DB: cidade, não usado)
--   fornecedores: pessoa_tipo (DB: ausente), cpf_cnpj (DB: cnpj),
--                endereco (DB: ausente)
--
-- Renomeia onde faz sentido (tipo → pessoa_tipo, cnpj_cpf → cpf_cnpj)
-- e adiciona o que falta. Idempotente.
--
-- Execute no Supabase SQL Editor.
-- =================================================================

-- ---------- clientes ----------
DO $$
BEGIN
  -- tipo → pessoa_tipo
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='clientes' AND column_name='tipo')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='clientes' AND column_name='pessoa_tipo') THEN
    ALTER TABLE clientes RENAME COLUMN tipo TO pessoa_tipo;
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='clientes' AND column_name='pessoa_tipo') THEN
    ALTER TABLE clientes ADD COLUMN pessoa_tipo text;
  END IF;

  -- cnpj_cpf → cpf_cnpj (UI usa ordem invertida)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='clientes' AND column_name='cnpj_cpf')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='clientes' AND column_name='cpf_cnpj') THEN
    ALTER TABLE clientes RENAME COLUMN cnpj_cpf TO cpf_cnpj;
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='clientes' AND column_name='cpf_cnpj') THEN
    ALTER TABLE clientes ADD COLUMN cpf_cnpj text;
  END IF;
END $$;

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco text;

-- ---------- fornecedores ----------
DO $$
BEGIN
  -- cnpj → cpf_cnpj (consistência com clientes; fornecedor pode ser PF)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='fornecedores' AND column_name='cnpj')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='fornecedores' AND column_name='cpf_cnpj') THEN
    ALTER TABLE fornecedores RENAME COLUMN cnpj TO cpf_cnpj;
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='fornecedores' AND column_name='cpf_cnpj') THEN
    ALTER TABLE fornecedores ADD COLUMN cpf_cnpj text;
  END IF;
END $$;

ALTER TABLE fornecedores
  ADD COLUMN IF NOT EXISTS pessoa_tipo text,
  ADD COLUMN IF NOT EXISTS endereco    text;
