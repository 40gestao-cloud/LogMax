-- 413_20260812_remuneracao_variavel_saiu_do_produto_e_agora_sai_do_banco.sql
--
-- O módulo Remuneração Variável (migr. 382) saiu do produto. A própria migr.
-- 395 já registrou isso, ao pôr a régua no TRUNCATE do reset:
--
--   "o módulo Remuneração Variável saiu do produto, então a régua ficou sem
--    tela e sem dono."
--
-- Só que saiu da tela, não do banco. `apurar_bonus` e `pagar_bonus` continuam
-- executáveis por qualquer membro do Conselho pelo SQL Editor, e `pagar_bonus`
-- credita carteira de aluno — mexe em dinheiro num módulo que ninguém mais
-- opera nem confere.
--
-- E havia um efeito colateral concreto esperando acontecer. `pagar_bonus`
-- lança em `maxbank_transacoes` com origem_id = <apuracao_id>, mas nem a
-- transação nem `maxbank_contas.saldo_bonificacoes` têm FK para a apuração —
-- `origem_id` é coluna solta. Excluir a competição derruba a apuração por
-- CASCADE e deixa o crédito na carteira; como a idempotência do pagamento é
-- UNIQUE (origem_id, conta_id, carteira), refazer a competição gera id novo,
-- o índice não reconhece nada e paga DE NOVO por cima do saldo que nunca
-- voltou. Bônus duplicado, em silêncio.
--
-- Sem as RPCs, esse caminho deixa de existir: não há como creditar bônus.
--
-- POR QUE SÓ AS FUNÇÕES, E NÃO AS TABELAS:
--
-- `apuracoes_bonus` e `politicas_remuneracao` estão NOMEADAS dentro do
-- TRUNCATE de `resetar_dados_operacionais`. Dropar as tabelas quebraria o
-- APAGAR TUDO inteiro — a função passaria a falhar com "relation does not
-- exist", e ela é a ferramenta que vira a turma. Tirar as tabelas exige
-- reescrever aquele corpo, que é exatamente o que a migr. 412 evitou fazer às
-- cegas (a lista de TRUNCATE foi reescrita pelas migrs. 141, 147, 377 e 395;
-- replace com corpo defasado reverteria a lista junto).
--
-- Então as três tabelas ficam, vazias e sem porta de escrita. A limpeza do
-- schema, se valer a pena um dia, vai junto com a reescrita do reset e com o
-- `prosrc` do banco em mãos.
--
-- VERIFICADO ANTES DE DROPAR, como a migr. 388 fez com Políticas:
--   apuracoes = 0, pagas = 0, creditos_na_carteira = 0.
-- Nunca houve apuração nem pagamento — nada se perde aqui, e não existe
-- dinheiro de bônus circulando que precisasse de estorno.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- Assinatura exata: DROP com argumentos errados é no-op silencioso e deixa a
-- função no ar (e, se combinado com um CREATE, uma sobrecarga que o PostgREST
-- recusa por ambiguidade).
DROP FUNCTION IF EXISTS public.apurar_bonus(uuid, uuid);
DROP FUNCTION IF EXISTS public.pagar_bonus(uuid);

-- As tabelas continuam de pé por causa do TRUNCATE do reset — o comentário
-- explica para quem abrir o banco e não achar como escrever nelas.
COMMENT ON TABLE public.apuracoes_bonus IS
  'INATIVA (migr. 413). O módulo Remuneração Variável saiu do produto e as RPCs '
  'apurar_bonus/pagar_bonus foram removidas. A tabela permanece só porque é '
  'nomeada no TRUNCATE de resetar_dados_operacionais.';

COMMENT ON TABLE public.apuracao_bonus_itens IS
  'INATIVA (migr. 413). Filha de apuracoes_bonus. Sem escrita possível.';

COMMENT ON TABLE public.politicas_remuneracao IS
  'INATIVA (migr. 413). Régua do bônus de um módulo que saiu do produto. '
  'Permanece só porque é nomeada no TRUNCATE de resetar_dados_operacionais.';

-- O índice parcial `uq_maxbank_transacoes_bonus` fica. Ele só indexa linhas
-- com origem = 'remuneracao_variavel', das quais não existe nenhuma: não
-- custa nada, e é o que protegeria contra duplicidade caso algum registro
-- histórico apareça numa turma que eu não conferi.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- 1. as funções sumiram:
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('apurar_bonus', 'pagar_bonus');
--   -- esperado: zero linhas.
--
--   -- 2. o APAGAR TUDO continua de pé (as tabelas do TRUNCATE existem):
--   SELECT to_regclass('public.apuracoes_bonus'),
--          to_regclass('public.politicas_remuneracao');
--   -- esperado: os dois nomes, não NULL.
--
--   -- 3. nada de bônus circulando:
--   SELECT count(*) FROM maxbank_transacoes WHERE origem = 'remuneracao_variavel';
--   -- esperado: 0.
-- =================================================================
