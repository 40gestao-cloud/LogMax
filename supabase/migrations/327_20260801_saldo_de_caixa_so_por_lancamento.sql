-- =================================================================
-- LogMax — Saldo de caixa/banco só se move por lançamento
-- =================================================================
-- Último jeito de criar dinheiro do nada: o campo "Saldo (R$)" do formulário
-- de Caixa / Bancos. Depois das 325/326, aporte e empréstimo passaram a sair
-- do caixa da Matriz com trava de saldo — mas bastava a filial abrir a
-- própria tela, digitar um número maior e o exercício inteiro perdia o
-- sentido. Não adianta travar a porta e deixar a janela aberta.
--
-- A partir daqui o saldo é CONSEQUÊNCIA, nunca entrada:
--   • conta nova nasce em R$ 0,00 (DEFAULT da coluna);
--   • sobe por aporte de capital, empréstimo recebido ou conta a receber paga;
--   • desce por conta a pagar paga, aporte concedido ou empréstimo concedido.
--
-- COMO A TRAVA FUNCIONA. Privilégio por COLUNA, não trigger nem RLS. No
-- Postgres o privilégio de tabela vale pra todas as colunas, então o jeito de
-- excluir uma é revogar no nível da tabela e reconceder coluna a coluna. Um
-- INSERT/UPDATE que mencione `saldo` passa a ser recusado antes mesmo da RLS.
--
-- Por que não trigger: trigger precisaria distinguir "movimento legítimo" de
-- "digitação", e o único discriminador disponível (o papel do JWT) não muda
-- dentro de SECURITY DEFINER — chamada por usuário autenticado continua
-- 'authenticated' lá dentro. Daria pra usar flag de sessão via set_config,
-- mas é convenção frágil. Privilégio de coluna é declarativo e o banco
-- garante sozinho.
--
-- As quatro funções que mexem em saldo são todas SECURITY DEFINER e rodam
-- como o dono da função, então nenhuma delas é afetada:
--   aprovar_emprestimo, registrar_aporte_capital,
--   sync_saldo_caixa_pagar, sync_saldo_caixa_receber
-- (e resetar_dados_operacionais, que zera tudo no reset de turma).
--
-- `service_role` mantém acesso total — os endpoints em `api/` dependem disso.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- anon não escreve em caixa nem antes disso; aqui só formaliza.
REVOKE INSERT, UPDATE ON public.caixa_bancos FROM anon;

REVOKE INSERT, UPDATE ON public.caixa_bancos FROM authenticated;

-- Todas as colunas MENOS `saldo`. Manter a lista completa (em vez de só as
-- que o formulário manda hoje) evita quebrar escrita legítima que venha a
-- existir depois — o objetivo é excluir uma coluna, não estreitar o resto.
GRANT INSERT (
  id, conta, banco, agencia, tipo, status, created_at, ativo,
  criado_por, atualizado_por, updated_at, imagem_url, filial, is_reserva
) ON public.caixa_bancos TO authenticated;

GRANT UPDATE (
  id, conta, banco, agencia, tipo, status, created_at, ativo,
  criado_por, atualizado_por, updated_at, imagem_url, filial, is_reserva
) ON public.caixa_bancos TO authenticated;

COMMENT ON COLUMN public.caixa_bancos.saldo IS
  'Saldo atual. Somente leitura pro cliente (migr. 327): só muda por lançamento — aporte, empréstimo, conta paga ou recebida. Conta nova nasce em zero.';

COMMIT;

NOTIFY pgrst, 'reload schema';
