-- 530 — A fila "pedido(s) em entrega a receber" contava carga que já chegou.
--
-- A régua era `status = 'Em Entrega' AND recebido_em IS NULL`. Ela nasceu na
-- migr. 457 para não deixar sumir da fila o pedido parcialmente recebido, e
-- nisso está certa. O que ela não distingue é o pedido cuja carga JÁ FOI TODA
-- LANÇADA e só espera a conferência: `recebido_em` só é carimbado quando o
-- pedido vira 'Recebido', e o pedido só vira 'Recebido' quando o recebimento é
-- CONFIRMADO. Entre registrar e confirmar existe uma janela — que na aula dura
-- o intervalo inteiro, porque quem registra não é quem confere — e nela o
-- pedido conta nas DUAS filas ao mesmo tempo.
--
-- Estado vivo na turma de Contabilidade quando isto foi escrito: SuperMax com
-- 13 pedidos 'Em Entrega', saldo ZERO nos 13, cada um com o seu recebimento
-- ainda 'Pendente'. A tela dizia "13 pedido(s) em entrega a receber" e o select
-- de Pedido do botão Registrar não oferecia nenhum deles — todos desabilitados
-- por saldo esgotado, que é o certo: o banco recusaria
-- (`fn_recebimento_nao_estoura_pedido`). O aluno lia um número, clicava em
-- Registrar e não achava o que registrar. Número sem ação correspondente é pior
-- que número nenhum: ensina a ignorar o aviso.
--
-- A carga que já chegou não está esperando carga — está esperando conferência,
-- e essa é a SEGUNDA fila ("recebimento(s) aguardando confirmação"), que já a
-- conta. A régua passa a ser o saldo, como em todo o resto do fluxo desde a
-- migr. 489.
--
-- A view existe porque a bolinha da sidebar conta no servidor (`count`,
-- `head: true`) e não tem como fazer a conta do saldo em PostgREST. Badge e
-- faixa lendo réguas diferentes sobre a mesma fila é como este defeito
-- apareceria de novo, do outro lado.

BEGIN;

CREATE OR REPLACE VIEW public.v_pedidos_a_receber
WITH (security_invoker = true) AS
SELECT
  p.id      AS pedido_id,
  p.filial,
  p.numero,
  p.status,
  p.recebido_em,
  s.qtd_pedida,
  s.qtd_recebida_total,
  s.qtd_saldo
FROM public.pedidos p
JOIN public.v_pedido_saldo s ON s.pedido_id = p.id
WHERE p.ativo IS TRUE
  AND p.status = 'Em Entrega'
  AND p.recebido_em IS NULL
  -- Mesma tolerância do resto do fluxo: numeric(15,3), meia milésima.
  AND s.qtd_saldo > 0.0005;

COMMENT ON VIEW public.v_pedidos_a_receber IS
  'Pedido com carga ainda por chegar: em entrega e com saldo em aberto '
  '(migr. 530). Pedido já lançado por inteiro e à espera de conferência NÃO '
  'entra aqui — ele está na fila de confirmação, não na de recebimento.';

-- View nova nasce acessível ao anon pelo default do schema — mesma armadilha
-- das RPCs. Revoga nominalmente.
REVOKE ALL ON public.v_pedidos_a_receber FROM anon;
GRANT SELECT ON public.v_pedidos_a_receber TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
--
--   -- security_invoker tem de estar ligado (senão a view ignora a RLS):
--   SELECT relname, reloptions FROM pg_class
--    WHERE relname = 'v_pedidos_a_receber';
--
--   -- os que saíram da fila (carga lançada, conferência pendente):
--   SELECT p.filial, p.numero, s.qtd_saldo
--     FROM pedidos p JOIN v_pedido_saldo s ON s.pedido_id = p.id
--    WHERE p.status = 'Em Entrega' AND p.recebido_em IS NULL
--      AND s.qtd_saldo <= 0.0005;
--
-- TESTE MANUAL
--   pedido em entrega, nada lançado   → aparece na fila e no select Registrar
--   pedido com metade lançada         → aparece nas duas coisas
--   pedido com a carga toda lançada   → SAI da fila; fica só em "aguardando
--                                       confirmação", que é onde há o que fazer
-- ════════════════════════════════════════════════════════════════════════════
