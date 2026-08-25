-- 532 — Documento também é imagem.
--
-- O bucket `documentos` (migr. 476) aceitava PDF, .docx e .doc. Metade do que a
-- Matriz manda para a turma é figura: o cartaz da campanha, o print do
-- procedimento, a planta do layout da loja. Sem imagem, a única saída era colar
-- dentro de um .docx — e o aluno recebia um Word de uma página só para ver uma
-- figura, que é a versão didática de esconder a informação.
--
-- `allowed_mime_types` é a trava de verdade: o `accept` do <input> só filtra o
-- seletor de arquivo do sistema, e a checagem no JS o F12 contorna. Quem recusa
-- é o Storage, e é aqui que a lista vive.
--
-- 'image/jpg' NÃO entra: não é tipo MIME real. Alguns sistemas o reportam em
-- `File.type`, e por isso a tela mapeia a extensão .jpg para 'image/jpeg' antes
-- de subir. Aceitá-lo aqui só criaria uma segunda grafia para a mesma coisa nas
-- linhas de `documentos.arquivo_mime`.
--
-- Teto continua 10 MB, o mesmo do arquivo de texto: foto de celular cabe, e o
-- que não cabe é imagem que ninguém devia estar mandando por aqui.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/msword',
     'image/png',
     'image/jpeg',
     'image/webp'
   ]
 WHERE id = 'documentos';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
--
--   SELECT id, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'documentos';
--
-- TESTE MANUAL
--   professor publica um PNG   → sobe, aparece com ícone de imagem
--   aluno baixa                → abre a figura
--   professor tenta um .gif    → o seletor nem oferece; forçado, o bucket recusa
-- ════════════════════════════════════════════════════════════════════════════
