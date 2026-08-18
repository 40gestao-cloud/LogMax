-- 464_20260817_duas_telas_que_nunca_funcionaram.sql
--
-- A VARREDURA POR ANÁLISE ESTÁTICA ACHOU MAIS DOIS COMO O DA MIGR. 463.
--
-- Depois da 463 — o `::text` que derrubava a conversão de orçamento em pedido —
-- ficou a pergunta: quantos outros fluxos carregam um erro fatal por nunca
-- terem sido executados? PL/pgSQL não valida o corpo na criação, então nem
-- `tsc`, nem teste, nem revisão pegam.
--
-- `plpgsql_check` respondeu em segundos o que nenhuma sonda de dado acharia —
-- porque o sintoma desses erros é a AUSÊNCIA de dado. 326 funções analisadas,
-- mais todos os gatilhos com a tabela de contexto. Dois erros fatais:
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. `responder_pesquisa` — grava numa coluna que não existe
--
--   error 42703: column "anonima" of relation "pesquisa_respostas" does not exist
--
-- A função insere `(pesquisa_id, respondente_id, anonima)`, e `anonima` nunca
-- existiu na tabela. Toda resposta de pesquisa de clima ou eNPS abortava.
-- `pesquisa_respostas` tem zero linhas — nenhum aluno jamais conseguiu
-- responder uma pesquisa.
--
-- A coluna não é adicionada: seria a terceira cópia da mesma informação. O
-- anonimato já está em `pesquisas.anonima` (a pesquisa toda é anônima ou não)
-- e a própria função já o traduz no dado — `respondente_id` fica NULL quando
-- anônima, e é isso que protege o respondente. Sai do INSERT.
--
-- 2. `fechar_inventario` — escreve em coluna gerada
--
--   error 428C9: column "diferenca" can only be updated to DEFAULT
--
-- `inventarios.diferenca` é `GENERATED ALWAYS` — o banco calcula sozinho a
-- partir de `qtd_contada` e `qtd_sistema`. A função tentava atribuí-la no
-- UPDATE final, depois de já ter lançado a movimentação de ajuste. Resultado:
-- a contagem era rejeitada inteira, e o inventário nunca fechava. Zero eventos
-- de `inventarios` no histórico confirmam.
--
-- `v_dif` continua sendo usada nas outras sete vezes — a movimentação de
-- ajuste, o texto e o retorno da RPC. Só a atribuição sai.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE A VARREDURA APONTOU E **NÃO** É BUG
--
-- Registrado para quem repetir a análise não perder tempo:
--
--   • `excluir_transacao_maxbank` — "syntax error at or near %I". É
--     `format('UPDATE maxbank_contas SET saldo_%I = $1', v_carteira)`, SQL
--     dinâmico legítimo; as três colunas existem (`saldo_salario`,
--     `saldo_beneficios`, `saldo_bonificacoes`). O analisador não resolve
--     `format()`.
--   • "permission denied for function acre_today / _lixeira_tabelas" — o check
--     roda com os privilégios de quem o chama; em produção quem as chama é
--     SECURITY DEFINER e roda como dono. Confirmado que nenhuma policy RLS usa
--     `acre_today`, que seria o caso em que o erro valeria.
--   • "routine is marked as STABLE, but expression is VOLATILE" — aparece em
--     `gerar_dre`, `lixeira_listar` e `lixeira_vinculos`, todas por chamarem
--     `_assert_rpc()`. Não quebra nada; fica anotado como imprecisão.
--   • variáveis não usadas e `i` sombreado em laços — cosmético.
--
-- Os gatilhos passaram limpos: zero erros em todos, com a tabela de contexto.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Mesma técnica das migrs. 462 e 463: lê
-- o corpo vigente, troca o que precisa, aborta se o padrão não bater.

BEGIN;

-- ── 1. A resposta de pesquisa ───────────────────────────────────────────────

DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'responder_pesquisa';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'responder_pesquisa não encontrada.';
  END IF;

  IF position('INSERT INTO pesquisa_respostas (pesquisa_id, respondente_id, anonima)' in v_def) = 0 THEN
    IF position('INSERT INTO pesquisa_respostas (pesquisa_id, respondente_id)' in v_def) > 0 THEN
      RAISE NOTICE 'responder_pesquisa já está corrigida.';
      RETURN;
    END IF;
    RAISE EXCEPTION 'responder_pesquisa: o INSERT mudou — revise a migr. 464 antes de aplicar.';
  END IF;

  v_novo := replace(v_def,
    'INSERT INTO pesquisa_respostas (pesquisa_id, respondente_id, anonima)',
    'INSERT INTO pesquisa_respostas (pesquisa_id, respondente_id)');

  IF position('ELSE v_user_id END, v_anonima)' in v_novo) = 0 THEN
    RAISE EXCEPTION 'responder_pesquisa: os VALUES mudaram — revise a migr. 464.';
  END IF;

  v_novo := replace(v_novo,
    'ELSE v_user_id END, v_anonima)',
    'ELSE v_user_id END)');

  EXECUTE v_novo;
END
$do$;

-- ── 2. O fechamento de inventário ───────────────────────────────────────────

DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fechar_inventario';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fechar_inventario não encontrada.';
  END IF;

  IF position('         diferenca   = v_dif,' in v_def) = 0 THEN
    IF position('diferenca' in v_def) = 0 OR position('diferenca   = v_dif' in v_def) = 0 THEN
      RAISE NOTICE 'fechar_inventario já está corrigida.';
      RETURN;
    END IF;
    RAISE EXCEPTION 'fechar_inventario: o UPDATE mudou — revise a migr. 464 antes de aplicar.';
  END IF;

  -- Só a atribuição sai. `diferenca` continua no jsonb de retorno, calculada
  -- pelo banco e devolvida ao PDV.
  v_novo := replace(v_def, E'         diferenca   = v_dif,\r\n', '');

  IF v_novo = v_def THEN
    -- Corpo com quebra de linha Unix em vez de CRLF.
    v_novo := replace(v_def, E'         diferenca   = v_dif,\n', '');
  END IF;

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'fechar_inventario: não consegui remover a atribuição de `diferenca`. Revise a migr. 464.';
  END IF;

  EXECUTE v_novo;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. as duas correções — esperado: zero linhas
--   SELECT proname FROM pg_proc
--    WHERE proname = 'responder_pesquisa' AND prosrc LIKE '%respondente_id, anonima%';
--   SELECT proname FROM pg_proc
--    WHERE proname = 'fechar_inventario' AND prosrc LIKE '%diferenca   = v_dif%';
--
--   -- 2. a análise estática das duas, agora limpa. Precisa da extensão:
--   --      CREATE EXTENSION IF NOT EXISTS plpgsql_check;
--   SELECT p.proname, t.msg
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--     CROSS JOIN LATERAL plpgsql_check_function(p.oid, format:='text') AS t(msg)
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('responder_pesquisa', 'fechar_inventario')
--      AND t.msg LIKE 'error:%';
--   -- esperado: zero linhas. Depois: DROP EXTENSION plpgsql_check;
--
--   -- 3. a varredura inteira, para a próxima vez que alguém quiser repetir
--   SELECT p.proname, t.msg
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--     JOIN pg_language l ON l.oid = p.prolang
--     CROSS JOIN LATERAL plpgsql_check_function(p.oid, format:='text') AS t(msg)
--    WHERE n.nspname = 'public' AND l.lanname = 'plpgsql'
--      AND p.prorettype <> 'trigger'::regtype
--      AND t.msg LIKE 'error:%'
--    ORDER BY 1;
--
-- O teste que vale a aula, e que nunca passou: responder uma pesquisa de clima
-- em RH › Pesquisas, e fechar uma contagem em Estoque › Inventários.
-- =================================================================
