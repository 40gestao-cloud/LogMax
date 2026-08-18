-- 459_20260817_a_devolucao_passa_a_ter_uma_porta_so.sql
--
-- DUAS PORTAS PARA A MESMA DEVOLUÇÃO, E ELAS FAZIAM COISAS DIFERENTES.
--
-- O PDV chamava `estornar_venda_pdv`; a tela de Devoluções chama
-- `criar_devolucao_venda`. Mesmo fato do mundo real, dois caminhos que não se
-- conheciam. É a pergunta 3 do documento de auditoria — "esse fato tem duas
-- portas?" — no caso mais caro que havia neste sistema.
--
-- O que a porta do PDV NÃO fazia:
--
--   • **Não entrava no DRE.** Ela gravava em `devolucoes_pdv`, e `gerar_dre`
--     lê `devolucoes` e `itens_devolucao`. Devolução feita no caixa não abatia
--     receita nem devolvia o custo ao CMV: a filial fechava o mês faturando o
--     que estornou.
--   • **Não devolvia o aparelho.** `trg_item_devolucao_devolve_unidade` (446)
--     vive em `itens_devolucao`, tabela que aquele caminho nunca tocava. IMEI
--     devolvido no caixa continuava 'Vendida'.
--   • **Não encerrava a cobrança.** Marcava `requer_ajuste_financeiro = true`
--     e esperava alguém ver.
--
-- E tinha um erro de estoque próprio:
--
--     UPDATE produtos SET estoque = estoque + qtd ...;      -- soma na coluna
--     INSERT INTO movimentacoes_estoque (...);              -- soma de novo
--
-- O que segurava era `trg_block_estoque_manual`, que reverte escrita manual em
-- `estoque` — mas só **enquanto a flag estiver desligada**. Como
-- `fn_atualiza_estoque_produto` liga `app.allow_estoque_update` com
-- `is_local = true`, ela vale até o fim da TRANSAÇÃO. Dentro do laço de itens:
--
--     1º item  → UPDATE revertido, movimentação soma certo. Flag fica ligada.
--     2º item  → UPDATE passa, movimentação soma de novo. ESTOQUE EM DOBRO.
--
-- Devolução de um item era certa; de dois, o segundo em diante entrava
-- inflado. `devolucoes_pdv` está vazia nas 4 turmas — a armadilha estava
-- montada e ninguém tinha pisado nela ainda.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A PORTA QUE FICA
--
-- `criar_devolucao_venda`, que já faz o certo: grava em `devolucoes` +
-- `itens_devolucao` (entra no DRE, dispara o gatilho da unidade serializada),
-- valida o saldo devolvível pela view `v_venda_saldo_devolucao`, cancela ou
-- ajusta a cobrança conforme o que de fato foi recebido, e — desde a migr. 450
-- — lança a sangria quando o dinheiro sai da gaveta.
--
-- **A autorização passa a ser a dela: admin/CEO ou gerente da filial.**
-- Decisão consciente, tomada com o professor: devolver mexe em estoque,
-- dinheiro e cobrança ao mesmo tempo, e isso é alçada. O operador de caixa
-- chama o gerente, que é o que acontece na loja. Antes, quem fosse do setor
-- vendas devolvia sozinho pelo PDV e a mesma pessoa não conseguia fazer o
-- mesmo pela tela de Devoluções — a régua dependia da porta, que é o problema
-- de fundo desta migração.
--
-- A TABELA VAI JUNTO
--
-- `devolucoes_pdv` some porque manter tabela vazia de um fluxo encerrado é
-- deixar a segunda fonte de pé esperando alguém escrever nela de novo.
-- Conferido nas 4 turmas antes: zero linhas em todas.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. O deploy do frontend tem de ir junto:
-- enquanto a tela antiga estiver no ar, o botão de devolução do PDV chama uma
-- função que deixou de existir.

BEGIN;

-- A porta.
DROP FUNCTION IF EXISTS public.estornar_venda_pdv(uuid, jsonb, text);

-- O registro paralelo. `devolucoes_pdv_venda_id_fkey` cai junto com a tabela.
DROP TABLE IF EXISTS public.devolucoes_pdv;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. a segunda porta não existe mais — esperado: zero linhas nas duas
--   SELECT proname FROM pg_proc WHERE proname = 'estornar_venda_pdv';
--   SELECT to_regclass('public.devolucoes_pdv');   -- esperado: NULL
--
--   -- 2. a porta que fica continua inteira
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'criar_devolucao_venda';
--
--   -- 3. depois de devolver pelo PDV, a devolução tem de aparecer nos três
--   --    lugares que a porta antiga não alcançava
--   SELECT d.id, d.valor_devolvido, d.forma_estorno FROM devolucoes d
--    ORDER BY d.created_at DESC LIMIT 1;
--   SELECT status, count(*) FROM produto_unidades GROUP BY 1;   -- devolvida volta a 'Em estoque'
--   SELECT jsonb_pretty(public.gerar_dre('SuperMax', date_trunc('month', now())::date, now()::date));
--
-- O teste que vale a aula: vender DOIS produtos diferentes numa venda em
-- dinheiro, devolver os dois de uma vez pelo PDV, e conferir o estoque de cada
-- um. Na porta antiga, o segundo item voltava em dobro.
-- =================================================================
