-- Migração: reset do conteudo dos documentos (troca de engine)
-- =============================================================
-- Max Docs migrou de Tiptap (HTML string em conteudo) pra Univer
-- (IDocumentData: {id, body:{dataStream,paragraphs}, documentStyle}).
-- Formatos incompativeis: abrir um doc antigo com o novo editor cai
-- no fallback empty (guard isUniverDocument no editor). Para nao
-- confundir usuario com docs "vazios", TRUNCATE zera tudo. O modulo
-- tem ~1 dia (v1 em 2026-07-24). Idempotente.
-- =============================================================
TRUNCATE TABLE public.max_docs;
