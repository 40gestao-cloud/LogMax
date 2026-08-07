-- =================================================================
-- 388 — Políticas sai. (E a Auditoria vira aba do Comitê, só no front.)
--
-- Duas decisões de produto tomadas depois de olhar o menu montado:
--
-- 1) POLÍTICAS (#G7) SAI DE VEZ.
--    Foi o item mais fraco do bloco de governança. O que ele acrescentava
--    sobre `avisos_matriz` + "Ciente" (migr. 263) era versionamento e
--    reciência — real, mas caro em atenção para o que entrega: mais um
--    item de menu numa tela que já estava cheia, e nenhuma decisão nova
--    para ninguém tomar. Publicar texto não é governar.
--
--    Verificado antes de dropar: 0 políticas, 0 versões e 0 ciências nos
--    4 projetos. Nunca saiu do papel — nada se perde aqui.
--
--    DROP de verdade, e não "só tira do menu" como foi feito com Votações
--    e Duplicatas: aquelas tinham dado dentro. Estas não têm uma linha, e
--    schema morto que ninguém vai reativar só atrapalha quem lê o banco
--    depois.
--
-- 2) A tela de Auditoria virou a aba "Trilha" do Comitê de Auditoria.
--    Mudança 100% de front — `historico_operacoes`, `auditoria_revisoes`
--    e as RPCs continuam exatamente como estavam. Fica registrado aqui
--    porque quem ler as migrations depois vai procurar o porquê: eram
--    dois itens de menu para o mesmo trabalho, e a busca do Comitê era
--    pior que a da Auditoria (um `ilike` limitado a 25 resultados, contra
--    filtro por período/documento/pessoa, paginação e export). Fundir deu
--    ao Conselho a busca boa e devolveu um item de menu.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Notificações órfãs ─────────────────────────────────────────
-- `link_view = 'politicas'` deixou de existir como rota. Zero linhas
-- esperadas (nenhuma versão chegou a ser publicada), mas o DELETE evita
-- que sobre um sino levando a lugar nenhum se algum projeto divergir.
DELETE FROM public.notificacoes WHERE link_view = 'politicas';

-- ── 2. Políticas: view, RPCs e tabelas ────────────────────────────
DROP VIEW IF EXISTS public.politicas_vigentes;

DROP FUNCTION IF EXISTS public.publicar_politica_versao(uuid, text, text, date);
DROP FUNCTION IF EXISTS public.dar_ciencia_politica(uuid);

-- Ordem filho → pai. O CASCADE das FKs daria conta, mas explicitar deixa
-- claro que são exatamente estas três tabelas, e não o que pendurar nelas.
DROP TABLE IF EXISTS public.politica_ciencias;
DROP TABLE IF EXISTS public.politica_versoes;
DROP TABLE IF EXISTS public.politicas;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Nada de Políticas sobrou:
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public' AND table_name LIKE 'politica%';
-- Esperado: só `politicas_remuneracao` (essa é do bônus, #G2, e FICA).
--
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname IN ('publicar_politica_versao','dar_ciencia_politica');
-- Esperado: zero linhas.
--
-- 2) O Comitê continua inteiro (nada foi tocado aqui):
-- SELECT count(*) FROM historico_operacoes;      -- a trilha segue
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname LIKE '%revisao_auditoria%';
-- Esperado: abrir_, responder_ e encerrar_revisao_auditoria.
