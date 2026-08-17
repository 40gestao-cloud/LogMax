-- 441_20260817_o_conselho_nao_delibera_mais_valores.sql
--
-- OS TRÊS ATOS DE DELIBERAÇÃO DE VALOR SAEM DO PRODUTO.
--
-- Orçamento Anual (378), Prestação de Contas (379) e Destinação do Resultado
-- (381) foram desenhados para um Conselho que delibera: a filial propõe a
-- verba, o Conselho corta linha a linha, o CEO explica o gasto e o Conselho
-- julga, e no fim o lucro é repartido por deliberação. Esse corpo deixou de
-- existir na dinâmica da turma — não há mais deliberação de conselho sobre
-- valores. Tela que encena uma decisão que ninguém toma ensina um processo
-- falso, que é o oposto do que o resto do ERP faz.
--
-- É a mesma retirada de Auditoria/Riscos (2026-08-08), Políticas (388) e
-- Remuneração Variável (413), e segue a régua que a 413 fixou.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE HAVIA NAS 4 TURMAS (conferido antes de dropar, como a 388 e a 413)
--
--   ERP           orcamentos_periodo 3, itens 0, prestacoes 3, pareceres 0,
--                 destinacoes 0
--   Aprendiz      0 em todas
--   Contabilidade 0 em todas
--   Adm           0 em todas
--
-- Três cabeçalhos de orçamento sem uma única rubrica e três prestações sem um
-- único parecer: ninguém chegou a deliberar nada em nenhuma turma. Não há
-- verba concedida, ressalva com prazo nem lucro distribuído para estornar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE SÓ AS FUNÇÕES E AS POLICIES DE ESCRITA, E NÃO AS TABELAS
--
-- `orcamentos_periodo`, `prestacoes_contas` e `destinacoes_resultado` estão
-- NOMEADAS no TRUNCATE de `resetar_dados_operacionais` (migrs. 393/394/395).
-- Dropar as tabelas quebraria o APAGAR TUDO inteiro — a função passaria a
-- falhar com "relation does not exist", e ela é a ferramenta que vira a turma.
-- Mesmo motivo, mesma decisão da 413.
--
-- As tabelas ficam então vazias e sem porta de escrita: as três RPCs de ato
-- somem e as policies de INSERT/UPDATE também, porque o front escrevia o
-- rascunho direto na tabela (`from('orcamentos_periodo').insert`) — dropar só
-- as RPCs deixaria de pé o caminho de criar orçamento pelo F12.
--
-- As policies de SELECT ficam. São as da migr. 436 (isolamento por filial) e
-- guardam tabela vazia; tirá-las só faria a próxima leitura devolver [] por um
-- motivo diferente, e `orcamento_execucao` já sai daqui de qualquer forma.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRAÇÃO NÃO TOCA
--
-- `auth_is_conselho()`, `isConselho` e o papel de conselheiro continuam: são
-- Mandatos (383) e o Painel de Governança, que ficam. O que acaba é a
-- deliberação de VALOR, não o Conselho.
--
-- `centros_custo` e `centros_custo.grupo_dre` (425) ficam inteiros. O centro
-- de custo nunca dependeu do orçamento — é ele que classifica a despesa no
-- DRE, e a migração seguinte (material de consumo) se apoia nele.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. Os atos ──────────────────────────────────────────────────────────────
--
-- Assinatura exata: DROP com argumento errado é no-op silencioso e deixa a
-- função no ar. Copiadas de `pg_get_function_identity_arguments` no banco.

-- Orçamento Anual (378, reescritas pela 386/431/434)
DROP FUNCTION IF EXISTS public.submeter_orcamento(uuid);
DROP FUNCTION IF EXISTS public.deliberar_orcamento(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.orcamento_execucao(uuid);

-- Prestação de Contas (379, reescritas pela 386)
DROP FUNCTION IF EXISTS public.submeter_prestacao(uuid);
DROP FUNCTION IF EXISTS public.dar_parecer_prestacao(uuid, text, text, date);
DROP FUNCTION IF EXISTS public.encerrar_prestacao(uuid, text);

-- Destinação do Resultado (381, reescritas pela 387/431)
DROP FUNCTION IF EXISTS public.apurar_resultado_periodo(text, date, date);
DROP FUNCTION IF EXISTS public.deliberar_destinacao_resultado(
  text, date, date, numeric, numeric, numeric, uuid, uuid, text);

-- ── 2. As portas de escrita ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "orcamento_propor_insert" ON public.orcamentos_periodo;
DROP POLICY IF EXISTS "orcamento_propor_update" ON public.orcamentos_periodo;
DROP POLICY IF EXISTS "orcamento_item_write"    ON public.orcamento_itens;
DROP POLICY IF EXISTS "prestacao_insert"        ON public.prestacoes_contas;
DROP POLICY IF EXISTS "prestacao_update"        ON public.prestacoes_contas;

-- `prestacao_pareceres` e `destinacoes_resultado` já só tinham policy de
-- leitura: a escrita era exclusiva das RPCs, que acabaram de sair.

-- ── 3. O aviso para quem abrir o banco ──────────────────────────────────────

COMMENT ON TABLE public.orcamentos_periodo IS
  'INATIVA (migr. 441). Orçamento Anual saiu do produto junto com a deliberação '
  'de valores do Conselho. Sem RPC e sem policy de escrita. A tabela permanece '
  'só porque é nomeada no TRUNCATE de resetar_dados_operacionais.';

COMMENT ON TABLE public.orcamento_itens IS
  'INATIVA (migr. 441). Filha de orcamentos_periodo. Sem escrita possível.';

COMMENT ON TABLE public.prestacoes_contas IS
  'INATIVA (migr. 441). Prestação de Contas ao Conselho saiu do produto. Sem '
  'RPC e sem policy de escrita. Permanece só porque é nomeada no TRUNCATE de '
  'resetar_dados_operacionais.';

COMMENT ON TABLE public.prestacao_pareceres IS
  'INATIVA (migr. 441). Filha de prestacoes_contas. Sem escrita possível.';

COMMENT ON TABLE public.destinacoes_resultado IS
  'INATIVA (migr. 441). Destinação do Resultado saiu do produto: a repartição '
  'do lucro era ato de deliberação do Conselho. Permanece só porque é nomeada '
  'no TRUNCATE de resetar_dados_operacionais.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. os oito atos sumiram — esperado: zero linhas
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname IN
--      ('submeter_orcamento','deliberar_orcamento','orcamento_execucao',
--       'submeter_prestacao','dar_parecer_prestacao','encerrar_prestacao',
--       'apurar_resultado_periodo','deliberar_destinacao_resultado');
--
--   -- 2. sobrou só leitura nas cinco tabelas — esperado: só cmd = 'SELECT'
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN
--      ('orcamentos_periodo','orcamento_itens','prestacoes_contas',
--       'prestacao_pareceres','destinacoes_resultado')
--    ORDER BY tablename, cmd;
--
--   -- 3. o APAGAR TUDO continua de pé — esperado: os cinco nomes, não NULL
--   SELECT to_regclass('public.orcamentos_periodo'),
--          to_regclass('public.orcamento_itens'),
--          to_regclass('public.prestacoes_contas'),
--          to_regclass('public.prestacao_pareceres'),
--          to_regclass('public.destinacoes_resultado');
-- =================================================================
