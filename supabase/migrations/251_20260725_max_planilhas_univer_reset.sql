-- Migração: reset do conteudo das planilhas (troca de engine)
-- =============================================================
-- Max Planilhas migrou de Fortune-sheet (celldata: [{r,c,v}]) pra
-- Univer (IWorkbookData: {id, sheetOrder, sheets{}, styles{}}).
-- Formatos incompativeis: abrir uma planilha antiga com o novo
-- editor daria crash. O modulo tem ~1 dia de vida (v1 em 2026-07-24),
-- entao TRUNCATE e o caminho seguro. Idempotente — rerodar apenas
-- limpa o que ja estiver la.
-- =============================================================
TRUNCATE TABLE public.max_planilhas;
