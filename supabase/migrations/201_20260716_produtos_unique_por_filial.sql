-- =================================================================
-- LogMax — produtos.codigo único POR FILIAL (não mais global)
--
-- Contexto: com as 4 turmas em bancos separados e o RBAC/isolamento
-- por filial já fechado (migrations 179–187 + 190–197), a regra
-- histórica de "código único global + prefixo SM-/TM-/ML-" perdeu
-- razão de ser. Cada filial passa a ter seu próprio espaço de
-- códigos (SuperMax pode ter "001", TechMax também, MaxLook idem).
--
-- Estado anterior: UNIQUE parcial em produtos(codigo) WHERE ativo=true
-- (migration 057). Este script troca por UNIQUE parcial composto
-- em produtos(filial, codigo) WHERE ativo=true.
--
-- Códigos antigos com prefixo (SM-001, TM-001, ML-001) continuam
-- válidos — o novo índice aceita qualquer string, só passa a
-- exigir unicidade dentro do escopo da filial.
--
-- Padrão: [[feedback_partial_unique_soft_delete]] — soft-delete
-- exige WHERE ativo=true, senão linha inativa bloqueia novo INSERT.
--
-- Idempotente: DROP IF EXISTS + CREATE IF NOT EXISTS.
-- =================================================================

BEGIN;

-- 1) Remover índice UNIQUE de coluna única (produtos.codigo).
--    Cobre tanto o nome canônico gerado pela migration 057 quanto
--    variantes históricas.
DO $$
DECLARE
  idx_record record;
BEGIN
  FOR idx_record IN
    SELECT i.indexrelid::regclass::text AS idx_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'produtos'
       AND i.indisunique = true
       AND array_length(i.indkey::int[], 1) = 1
       AND (
            SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = t.oid AND a.attnum = i.indkey[0]
           ) = 'codigo'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', idx_record.idx_name);
    RAISE NOTICE 'Removido índice UNIQUE single-column: %', idx_record.idx_name;
  END LOOP;
END $$;

-- 2) Remover constraint UNIQUE simples em produtos(codigo), se ainda existir.
DO $$
DECLARE
  con_record record;
BEGIN
  FOR con_record IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class      t ON t.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'produtos'
       AND c.contype = 'u'
       AND array_length(c.conkey, 1) = 1
       AND (
            SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = t.oid AND a.attnum = c.conkey[1]
           ) = 'codigo'
  LOOP
    EXECUTE format('ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS %I', con_record.conname);
    RAISE NOTICE 'Removida constraint UNIQUE single-column: %', con_record.conname;
  END LOOP;
END $$;

-- 3) Criar índice UNIQUE parcial composto (filial, codigo) WHERE ativo=true.
--    Nome estável para permitir re-execução idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS produtos_filial_codigo_ativo_uniq
  ON public.produtos (filial, codigo)
  WHERE ativo = true;

COMMIT;

-- Verificação manual pós-aplicação:
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname='public' AND tablename='produtos'
--      AND indexdef ILIKE '%unique%';
--
-- Teste de aceite (deve funcionar):
--   INSERT INTO produtos (codigo, nome, preco, filial, ativo)
--     VALUES ('001', 'A', 1, 'SuperMax', true);
--   INSERT INTO produtos (codigo, nome, preco, filial, ativo)
--     VALUES ('001', 'B', 1, 'TechMax',  true);  -- OK: filial diferente
--   INSERT INTO produtos (codigo, nome, preco, filial, ativo)
--     VALUES ('001', 'C', 1, 'SuperMax', true);  -- ERRO 23505 esperado
