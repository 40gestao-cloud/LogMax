-- =================================================================
-- Folha de Pagamento — UNIQUE parcial por funcionário × mês
-- =================================================================
-- Impede que dois colaboradores de RH lancem folha duplicada para o
-- mesmo funcionário no mesmo mês de referência. Usa índice PARCIAL
-- (ativo = true) pelo padrão do projeto: registros inativados (soft-
-- delete) não devem bloquear um novo lançamento correto.
--
-- DEPENDE DE:
--   - rh_tables.sql (tabela folha_pagamento com colunas ativo, funcionario_id, mes_ref)
--
-- IDEMPOTENTE: IF NOT EXISTS garante segurança em re-apply.
--
-- ATENÇÃO antes de rodar: se já existem duplicatas ativas na tabela,
-- o CREATE UNIQUE INDEX vai falhar. Rode primeiro o bloco de diagnóstico
-- abaixo, limpe os duplicados e então aplique.
-- =================================================================

-- Diagnóstico de duplicatas (rode antes se necessário):
--
-- SELECT funcionario_id, mes_ref, count(*)
--   FROM folha_pagamento
--  WHERE ativo = true
--  GROUP BY funcionario_id, mes_ref
-- HAVING count(*) > 1;
--
-- Remoção da duplicata mais nova em caso de colisão (ajuste o critério):
--
-- DELETE FROM folha_pagamento
--  WHERE id IN (
--    SELECT id FROM (
--      SELECT id, ROW_NUMBER() OVER (
--        PARTITION BY funcionario_id, mes_ref
--        ORDER BY created_at DESC
--      ) AS rn
--      FROM folha_pagamento WHERE ativo = true
--    ) t WHERE rn > 1
--  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_folha_pagamento_func_mes
  ON folha_pagamento (funcionario_id, mes_ref)
  WHERE ativo = true;
