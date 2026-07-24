-- =================================================================
-- Produtos — teto de imagem sobe de 100 KB para 800 KB
-- =================================================================
-- Contexto: a Vitrine Pública é institucional (roda na tela de login
-- e é controlada pela Matriz). Com 100 KB por arquivo o resize
-- client-side estava caindo pra qualidade 0.35 em 512 px, gerando as
-- imagens borradas que apareceram na vitrine.
--
-- Novo teto: 800 KB, o suficiente pra 1600 px WebP em qualidade ~0.85
-- (nível "boa foto de produto de e-commerce") sem inflar o bucket.
-- O resize client-side (src/lib/imageResize.ts + src/lib/produtoImagem.ts)
-- foi ajustado na mesma leva pra mirar esse teto.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

UPDATE storage.buckets
SET file_size_limit = 819200 -- 800 KB
WHERE id = 'produto-imagens';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT file_size_limit FROM storage.buckets WHERE id = 'produto-imagens'; -- 819200
-- =================================================================
