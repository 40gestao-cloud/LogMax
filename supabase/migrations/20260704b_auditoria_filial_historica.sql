-- Auditoria: registros onde registro.filial ≠ funcionario.filial
-- Executar no SQL Editor do Supabase (read-only — apenas SELECT).
-- Após revisar, descomentar os UPDATEs correspondentes e executar novamente.

-- ── 1. folha_pagamento ──────────────────────────────────────────────────────
SELECT
  fp.id,
  fp.mes_ref,
  fp.filial        AS filial_registro,
  fn.filial        AS filial_funcionario,
  fn.nome          AS funcionario
FROM public.folha_pagamento fp
JOIN public.funcionarios fn ON fn.id = fp.funcionario_id
WHERE fp.filial <> fn.filial
  AND fn.filial IS NOT NULL
  AND fn.filial <> ''
ORDER BY fp.mes_ref DESC;

/*
-- Corrige folha_pagamento:
UPDATE public.folha_pagamento fp
SET filial = fn.filial
FROM public.funcionarios fn
WHERE fn.id = fp.funcionario_id
  AND fp.filial <> fn.filial
  AND fn.filial IS NOT NULL
  AND fn.filial <> '';
*/

-- ── 2. ferias ───────────────────────────────────────────────────────────────
SELECT
  f.id,
  f.data_inicio,
  f.filial         AS filial_registro,
  fn.filial        AS filial_funcionario,
  fn.nome          AS funcionario
FROM public.ferias f
JOIN public.funcionarios fn ON fn.id = f.funcionario_id
WHERE f.filial <> fn.filial
  AND fn.filial IS NOT NULL
  AND fn.filial <> ''
ORDER BY f.data_inicio DESC;

/*
-- Corrige ferias:
UPDATE public.ferias f
SET filial = fn.filial
FROM public.funcionarios fn
WHERE fn.id = f.funcionario_id
  AND f.filial <> fn.filial
  AND fn.filial IS NOT NULL
  AND fn.filial <> '';
*/

-- ── 3. afastamentos ─────────────────────────────────────────────────────────
SELECT
  a.id,
  a.data_inicio,
  a.filial         AS filial_registro,
  fn.filial        AS filial_funcionario,
  fn.nome          AS funcionario
FROM public.afastamentos a
JOIN public.funcionarios fn ON fn.id = a.funcionario_id
WHERE a.filial <> fn.filial
  AND fn.filial IS NOT NULL
  AND fn.filial <> ''
ORDER BY a.data_inicio DESC;

/*
-- Corrige afastamentos:
UPDATE public.afastamentos a
SET filial = fn.filial
FROM public.funcionarios fn
WHERE fn.id = a.funcionario_id
  AND a.filial <> fn.filial
  AND fn.filial IS NOT NULL
  AND fn.filial <> '';
*/

-- ── 4. contas_pagar com funcionario_id (folha de pagamento) ─────────────────
-- contas_pagar não tem funcionario_id direto; a ligação é por descrição.
-- Auditoria alternativa: CP com filial='SuperMax' criadas antes de 03/07/2026
-- cuja descrição contém nome de funcionário de outra filial.
-- (Requer revisão manual — não há FK direta.)
SELECT
  cp.id,
  cp.descricao,
  cp.valor,
  cp.filial,
  cp.created_at::date AS data
FROM public.contas_pagar cp
WHERE cp.filial = 'SuperMax'
  AND cp.created_at < '2026-07-03'
ORDER BY cp.created_at DESC
LIMIT 100;
