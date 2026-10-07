-- 680 — Classificação dos fornecedores existentes (migr. 679)
--
-- Lista aprovada pelo usuário em 2026-10-07, feita a partir dos cadastros das
-- 4 turmas. Por nome, porque a categoria era texto livre e não serve de régua
-- (no ERP, Energisa/Saneacre/Unonet estavam como "Serviços"). Ficaram de fora
-- de propósito — continuam Mercadoria — AGIS, Rcell e Vizzano: categoria com
-- "serviço", mas vendem produto e têm compras registradas.
-- Idempotente: nome ausente na turma não faz nada.

BEGIN;

UPDATE public.fornecedores SET tipo = 'concessionaria'
 WHERE ativo AND tipo <> 'concessionaria'
   AND lower(btrim(nome)) IN ('energisa', 'saneacre', 'unonet', 'prefeitura de cruzeiro do sul');

UPDATE public.fornecedores SET tipo = 'servico'
 WHERE ativo AND tipo = 'mercadoria'
   AND lower(btrim(nome)) IN ('alpha contabilidade', 'inviolável');

COMMIT;
