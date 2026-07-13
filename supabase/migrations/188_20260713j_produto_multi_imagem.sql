-- =================================================================
-- Produtos — até 3 imagens (capa + 2 adicionais), teto de 100 KB cada
-- =================================================================
-- `imagem_url` continua sendo a capa (usada em PDV/Catálogo/Vitrine/
-- grades — nenhum desses lugares precisa mudar). As duas colunas novas
-- são só galeria extra, hoje exibidas apenas no modal de detalhes do
-- Catálogo e no formulário de Produtos.
--
-- O teto de tamanho por arquivo cai de 120 KB para 100 KB (pedido do
-- usuário) — reforça o que o resize client-side já mira
-- (src/lib/imageResize.ts).
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS imagem_url_2 text,
  ADD COLUMN IF NOT EXISTS imagem_url_3 text;

UPDATE storage.buckets
SET file_size_limit = 102400 -- 100 KB
WHERE id = 'produto-imagens';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT file_size_limit FROM storage.buckets WHERE id = 'produto-imagens'; -- 102400
--   SELECT imagem_url, imagem_url_2, imagem_url_3 FROM produtos LIMIT 1;
-- =================================================================
