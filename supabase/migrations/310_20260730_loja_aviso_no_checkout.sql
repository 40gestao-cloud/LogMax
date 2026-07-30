-- 310 — Aviso de conduta no checkout da loja.
--
-- A migr. 309 barra o apelido impróprio, mas barra em silêncio: o comprador
-- descobre a regra ao esbarrar nela. Um aviso antes do campo evita a tentativa
-- — que é o objetivo real, já que o problema não é o pedido rejeitado e sim o
-- nome projetado na tela da sala.
--
-- O texto fica em `loja_config`, por filial, e não cravado no código das
-- lojas: são 3 repositórios e 12 deploys, e mudar uma frase não pode exigir
-- 12 deploys. O endpoint `/api/loja?acao=catalogo` passa a devolver o texto
-- junto do catálogo, que a página já consome.
--
-- CORREÇÃO DE ROTA em relação ao que a 309 afirma no cabeçalho. Lá está
-- escrito que "não adianta validar no front da loja". A metade sobre
-- `service_role` ignorar RLS continua valendo — policy realmente não alcança.
-- A conclusão, não: `api/loja.ts` mora no repositório do ERP e é o funil por
-- onde os 12 deploys passam, então validação e aviso servidos por ali valem
-- para todas as lojas na hora, sem depender da versão de cada repo. O trigger
-- da 309 segue útil como última linha, não como única.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

ALTER TABLE public.loja_config
  ADD COLUMN IF NOT EXISTS aviso_checkout text;

COMMENT ON COLUMN public.loja_config.aviso_checkout IS
  'Texto exibido junto ao campo de identificação no checkout da loja. NULL '
  'esconde o aviso. Servido por /api/loja?acao=catalogo. Migração 310.';

-- Só preenche quem ainda não tem texto: reaplicar não sobrescreve o que a
-- turma escreveu depois.
UPDATE public.loja_config
   SET aviso_checkout = 'Use seu nome ou um apelido respeitoso — o pedido aparece na tela do professor. Nomes com linguagem imprópria são recusados automaticamente.'
 WHERE aviso_checkout IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Para mudar o texto de uma loja (ou esconder o aviso):
--
--   UPDATE loja_config SET aviso_checkout = 'Novo texto.' WHERE filial = 'SuperMax';
--   UPDATE loja_config SET aviso_checkout = NULL          WHERE filial = 'SuperMax';
--
-- Verificação:
--   SELECT filial, aberta, aviso_checkout FROM loja_config ORDER BY filial;
-- ────────────────────────────────────────────────────────────────────────────
