-- Reparo do backfill da 269: o vínculo tem que apontar para a conta VIVA.
--
-- A 269 vinculou, por folha, a conta a pagar mais antiga. Onde o
-- check-then-insert de FolhaPagamentoView correu duas vezes (race de ~130ms,
-- caso real no LogMax-ERP em 2026-07-28: João Lucas e Regina, MaxLook), a mais
-- antiga é exatamente a que o operador inativou depois. Resultado: a folha
-- ficou amarrada à conta morta e a conta viva — a que está 'Pago' — sem vínculo.
--
-- Não há dinheiro errado nesses casos: uma única conta ativa por folha, e o
-- pagamento aconteceu uma vez só. O que estava errado era o ponteiro.
--
-- Repara re-elegendo a conta preferida por folha: ativa antes de inativa,
-- depois a mais antiga. Reaplicar é inofensivo.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos com colaboradores.

BEGIN;

WITH marcadas AS (
  SELECT cp.id,
         substring(cp.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]')::uuid AS folha_id,
         row_number() OVER (
           PARTITION BY substring(cp.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]')
           ORDER BY COALESCE(cp.ativo, true) DESC, cp.created_at, cp.id
         ) AS rn
    FROM public.contas_pagar cp
   WHERE cp.descricao ~ '\[folha:[0-9a-fA-F-]{36}\]'
),
-- 1. Solta o vínculo das preteridas primeiro, senão o UNIQUE parcial de contas
--    ativas pode barrar a re-eleição no meio do caminho.
soltas AS (
  UPDATE public.contas_pagar cp
     SET folha_pagamento_id = NULL
    FROM marcadas m
   WHERE cp.id = m.id
     AND m.rn > 1
     AND cp.folha_pagamento_id IS NOT NULL
  RETURNING 1
)
UPDATE public.contas_pagar cp
   SET folha_pagamento_id = m.folha_id
  FROM marcadas m
 WHERE cp.id = m.id
   AND m.rn = 1
   AND cp.folha_pagamento_id IS DISTINCT FROM m.folha_id
   AND EXISTS (SELECT 1 FROM public.folha_pagamento f WHERE f.id = m.folha_id);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--   -- Deve voltar zero: conta ativa com marcador e sem vínculo.
--   SELECT count(*) FROM contas_pagar
--    WHERE descricao ~ '\[folha:[0-9a-fA-F-]{36}\]'
--      AND COALESCE(ativo, true) = true
--      AND folha_pagamento_id IS NULL;
--
--   -- Duplicidade remanescente (S5) — cada linha é uma folha com mais de uma
--   -- conta ATIVA. Aqui já é dinheiro, não ponteiro: revisar uma a uma.
--   SELECT substring(descricao FROM '\[folha:([0-9a-fA-F-]{36})\]') AS folha,
--          count(*), sum(valor), array_agg(id)
--     FROM contas_pagar
--    WHERE descricao ~ '\[folha:[0-9a-fA-F-]{36}\]' AND COALESCE(ativo,true)
--    GROUP BY 1 HAVING count(*) > 1;
-- ════════════════════════════════════════════════════════════════════════════
