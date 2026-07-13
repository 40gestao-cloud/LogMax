-- =================================================================
-- LogMax — Remove colunas legadas do LogMax-ERP
-- =================================================================
-- Diff estrutural final (via MCP, 2026-07-13) achou 4 colunas que só
-- existiam no ERP e nunca foram usadas — sobreviveram de esquemas
-- antigos ou features abandonadas:
--
--   • clientes.cnpj_cpf        — duplicata legada de cpf_cnpj (0 usos).
--   • clientes.tipo            — coluna ambígua sem UI (0 usos).
--   • fornecedores.cnpj        — legado pré-unificação com cpf_cnpj
--                                (0 rows com valor distinto de cpf_cnpj).
--   • contas_pagar.origem      — usada pelo cluster de empréstimos que
--                                a 194 dropou; agora orfã (0 rows
--                                preenchidas).
--   • contas_receber.nota_fiscal_id — FK nunca populada.
--
-- Verificado via grep no front: nenhuma view referencia essas colunas.
--
-- Após aplicar, os 4 projetos LogMax convergem byte-a-byte em schema.
--
-- Idempotente via DROP COLUMN IF EXISTS (nos outros 3 projetos as
-- colunas nem existem — no-op silencioso).
-- =================================================================

BEGIN;

ALTER TABLE public.clientes        DROP COLUMN IF EXISTS cnpj_cpf;
ALTER TABLE public.clientes        DROP COLUMN IF EXISTS tipo;
ALTER TABLE public.fornecedores    DROP COLUMN IF EXISTS cnpj;
ALTER TABLE public.contas_pagar    DROP COLUMN IF EXISTS origem;
ALTER TABLE public.contas_receber  DROP COLUMN IF EXISTS nota_fiscal_id;

COMMIT;
