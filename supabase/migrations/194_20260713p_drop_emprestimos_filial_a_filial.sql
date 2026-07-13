-- =================================================================
-- LogMax — Remove cluster empréstimos filial-a-filial (ERP-only drift)
-- =================================================================
-- Diff via MCP achou tabelas + funções + triggers no LogMax-ERP que
-- nunca existiram no repo (drift): cluster experimental de empréstimo
-- entre filiais, criado direto no SQL Editor.
--
-- Regra confirmada com o usuário (2026-07-13): empréstimos devem ser
-- filial → Matriz, não entre filiais. Feature abandonada.
--
-- Todas as 3 tabelas têm 0 rows, safe pra drop. Nos outros 3 projetos
-- (aprendiz/contabilidade/Adm) as tabelas não existem — os DROP IF
-- EXISTS saem em silêncio.
--
-- ATENÇÃO: preserva `filial_caixa_config` (config independente com
-- flag "bloqueado" por filial, 3 rows em uso) e `capital_filial`
-- (existe nas 4 turmas, não faz parte do cluster).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Triggers que dependem de bloqueia_conta_pagar_estourado ────
DROP TRIGGER IF EXISTS trg_contas_pagar_bloqueio_insert ON public.contas_pagar;
DROP TRIGGER IF EXISTS trg_contas_pagar_bloqueio_pagar  ON public.contas_pagar;

-- ─── 2. Funções ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.bloqueia_conta_pagar_estourado();
DROP FUNCTION IF EXISTS public.aprovar_emprestimo(uuid, uuid, text, numeric, integer, text);
DROP FUNCTION IF EXISTS public.negar_emprestimo(uuid, text);
DROP FUNCTION IF EXISTS public.calcular_saldo_capital(text);

-- ─── 3. Tabelas (ordem respeita FK: parcelas → emprestimos) ────────
DROP TABLE IF EXISTS public.parcelas_emprestimo;
DROP TABLE IF EXISTS public.emprestimos_filial;
DROP TABLE IF EXISTS public.capital_config;

COMMIT;
