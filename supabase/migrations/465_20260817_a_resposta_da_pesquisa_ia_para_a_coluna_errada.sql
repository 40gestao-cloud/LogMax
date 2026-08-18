-- 465_20260817_a_resposta_da_pesquisa_ia_para_a_coluna_errada.sql
--
-- O SEGUNDO ERRO DE `responder_pesquisa`, QUE ESTAVA ESCONDIDO ATRÁS DO PRIMEIRO.
--
-- A migr. 464 tirou a coluna `anonima` inexistente do primeiro INSERT. Ao
-- reanalisar com `plpgsql_check`, apareceu o INSERT seguinte:
--
--   error 42703: column "valor_num" of relation "pesquisa_resposta_itens"
--                does not exist
--
-- Análise estática reporta um erro por comando: enquanto o primeiro INSERT
-- estava quebrado, o segundo nem era alcançado. É o mesmo motivo pelo qual
-- corrigir um bug às vezes "revela" outro — ele sempre esteve lá.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A RPC ESTAVA ERRADA DOS DOIS LADOS
--
-- `pesquisa_resposta_itens` tem `valor_escala integer`. A tela
-- (`MinhasPesquisasView`) monta o item com `valor_escala`. Só a RPC falava
-- outra língua — e nas duas pontas do mesmo comando:
--
--   lê   →  v_item->>'valor_num'      (chave que a tela nunca envia → NULL)
--   grava →  valor_num                (coluna que a tabela nunca teve → erro)
--
-- Fosse só o segundo, a resposta de escala entraria nula e ninguém veria.
-- Sendo os dois, a função aborta antes — e o que salvou o dado de ficar errado
-- em silêncio foi justamente o erro mais barulhento.
--
-- Tela e tabela sempre concordaram; quem diverge é a função, e é ela que muda.
-- `::int` no lugar de `::numeric` porque a coluna é `integer`: escala de
-- pesquisa é 1 a 5, não 3,7.
--
-- Com isto, a varredura de `plpgsql_check` fica sem nenhum erro real nas 326
-- funções. Os cinco que continuam aparecendo são os falsos positivos já
-- catalogados no cabeçalho da 464: quatro de permissão (o analisador roda com
-- os privilégios de quem chama, e quem chama em produção é SECURITY DEFINER) e
-- um do `format()` dinâmico de `excluir_transacao_maxbank`.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 464.

BEGIN;

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

  IF position('valor_num' in v_def) = 0 THEN
    RAISE NOTICE 'responder_pesquisa já está corrigida.';
    RETURN;
  END IF;

  IF position('INSERT INTO pesquisa_resposta_itens (resposta_id, pergunta_id, valor_num, valor_texto)' in v_def) = 0
     OR position('NULLIF(v_item->>''valor_num'','''')::numeric' in v_def) = 0 THEN
    RAISE EXCEPTION 'responder_pesquisa: o INSERT dos itens mudou — revise a migr. 465 antes de aplicar.';
  END IF;

  v_novo := replace(v_def,
    'INSERT INTO pesquisa_resposta_itens (resposta_id, pergunta_id, valor_num, valor_texto)',
    'INSERT INTO pesquisa_resposta_itens (resposta_id, pergunta_id, valor_escala, valor_texto)');

  v_novo := replace(v_novo,
    'NULLIF(v_item->>''valor_num'','''')::numeric',
    'NULLIF(v_item->>''valor_escala'','''')::int');

  IF position('valor_num' in v_novo) > 0 THEN
    RAISE EXCEPTION 'responder_pesquisa: sobrou referência a valor_num. Revise a migr. 465.';
  END IF;

  EXECUTE v_novo;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. nenhuma referência à coluna que não existe — esperado: zero linhas
--   SELECT proname FROM pg_proc
--    WHERE proname = 'responder_pesquisa' AND prosrc LIKE '%valor_num%';
--
--   -- 2. a RPC fala a mesma língua da tela e da tabela — esperado: 2
--   SELECT count(*) FROM regexp_matches(
--     (SELECT prosrc FROM pg_proc WHERE proname = 'responder_pesquisa'),
--     'valor_escala', 'g');
--
--   -- 3. a varredura inteira. Precisa da extensão:
--   --      CREATE EXTENSION IF NOT EXISTS plpgsql_check;
--   SELECT p.proname, t.msg
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--     JOIN pg_language l ON l.oid = p.prolang
--     CROSS JOIN LATERAL plpgsql_check_function(p.oid, format:='text') AS t(msg)
--    WHERE n.nspname = 'public' AND l.lanname = 'plpgsql'
--      AND p.prorettype <> 'trigger'::regtype AND t.msg LIKE 'error:%'
--    ORDER BY 1;
--   -- esperado: só os 5 falsos positivos catalogados na migr. 464 —
--   --   _assert_lixeira, lixeira_listar, cliente_titulos_vencidos e
--   --   reverter_promocoes_expiradas (permissão) e excluir_transacao_maxbank
--   --   (format dinâmico). Depois: DROP EXTENSION plpgsql_check;
--
-- O teste que vale a aula: responder uma pesquisa de clima com pergunta de
-- escala e conferir em RH › Pesquisas que a nota chegou — não só o texto.
-- =================================================================
