-- =================================================================
-- LogMax — UNIQUE parcial em cadastros com soft-delete
--
-- Sintoma reportado: ao soft-deletar um produto com código `TM-001` e
-- tentar cadastrar outro com o mesmo código, dispara 23505 (constraint
-- violation) porque a linha antiga continua na tabela com `ativo=false`
-- e o índice UNIQUE existente não filtra por `ativo`.
--
-- Padrão documentado em `feedback_partial_unique_soft_delete` (memória),
-- com precedente em `20260518_caixa_unique_ativo.sql` (controle_caixa).
-- A solução é recriar o índice UNIQUE como PARCIAL, validando apenas
-- linhas ativas (`WHERE ativo = true`). Linhas soft-deletadas mantêm
-- o código original para histórico, mas deixam de bloquear novos
-- INSERTs com a mesma chave.
--
-- Escopo: cadastros principais com regra "código único de negócio".
--   - produtos.codigo
--   - filiais.codigo
--   - servicos.codigo
--
-- Idempotente: só age se a coluna existir e só remove constraints/
-- índices NÃO-parciais (preservando qualquer índice já correto).
-- =================================================================

BEGIN;

DO $$
DECLARE
  par         record;
  con_record  record;
  idx_record  record;
  partial_idx text;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('produtos', 'codigo'),
      ('filiais',  'codigo'),
      ('servicos', 'codigo')
    ) AS t(tabela, coluna)
  LOOP
    -- 0) Coluna precisa existir.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = par.tabela
        AND column_name  = par.coluna
    ) THEN
      RAISE NOTICE 'Pulando %.%: coluna inexistente.', par.tabela, par.coluna;
      CONTINUE;
    END IF;

    -- 1) Remover constraint UNIQUE simples (uma coluna apenas) no campo.
    --    Composite UNIQUE (ex.: (filial, codigo)) é preservada intacta.
    FOR con_record IN
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class      t ON t.oid = c.conrelid
        JOIN pg_namespace  n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public'
         AND t.relname = par.tabela
         AND c.contype = 'u'
         AND array_length(c.conkey, 1) = 1
         AND (
              SELECT a.attname FROM pg_attribute a
               WHERE a.attrelid = t.oid AND a.attnum = c.conkey[1]
             ) = par.coluna
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                     par.tabela, con_record.conname);
      RAISE NOTICE 'Removida constraint % de %.', con_record.conname, par.tabela;
    END LOOP;

    -- 2) Remover índices UNIQUE no campo que NÃO sejam parciais por `ativo`.
    FOR idx_record IN
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename  = par.tabela
         AND indexdef ILIKE '%UNIQUE%'
         AND indexdef ILIKE format('%%(%s)%%', par.coluna)
         AND indexdef NOT ILIKE '%WHERE %ativo%'
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_record.indexname);
      RAISE NOTICE 'Removido índice % de %.', idx_record.indexname, par.tabela;
    END LOOP;

    -- 3) Criar índice UNIQUE parcial canônico.
    partial_idx := format('uq_%s_%s_ativo', par.tabela, par.coluna);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (%I) WHERE ativo = true',
      partial_idx, par.tabela, par.coluna
    );
    RAISE NOTICE 'Criado índice parcial % em %.%.', partial_idx, par.tabela, par.coluna;
  END LOOP;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Após aplicar, conferir que o índice parcial existe:
--    SELECT indexname, indexdef
--      FROM pg_indexes
--     WHERE schemaname = 'public'
--       AND tablename IN ('produtos', 'filiais', 'servicos')
--       AND indexdef ILIKE '%WHERE%ativo%';
--
-- 2. Reproduzir o cenário do TM-001:
--    INSERT INTO produtos (codigo, nome, preco, filial)
--      VALUES ('TM-TEST-001', 'teste', 1, 'TechMax');
--    UPDATE produtos SET ativo = false WHERE codigo = 'TM-TEST-001';
--    INSERT INTO produtos (codigo, nome, preco, filial)
--      VALUES ('TM-TEST-001', 'teste 2', 1, 'TechMax');
--    -- esperado: ambos os INSERTs passam; SELECT retorna 1 linha ativa
--    --           + 1 inativa com mesmo código.
--
-- 3. Verificar que duplicata em ATIVOS continua bloqueada:
--    INSERT INTO produtos (codigo, nome, preco, filial)
--      VALUES ('TM-TEST-001', 'duplicado', 1, 'TechMax');
--    -- esperado: 23505 (já existe outro com codigo = TM-TEST-001 e ativo=true).
--
-- 4. Limpar:
--    DELETE FROM produtos WHERE codigo = 'TM-TEST-001';
-- =================================================================
