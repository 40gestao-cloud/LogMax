-- 329 — Publica no realtime as tabelas cujas telas já pediam realtime.
--
-- Mesmo defeito que a 298 corrigiu na loja online, agora no resto do sistema:
-- a tela abre o canal, o Supabase responde SUBSCRIBED, e o Postgres nunca
-- publica nada porque a tabela não está em `supabase_realtime`. Não há erro em
-- lugar nenhum — o canal fica ouvindo silêncio e a tela só muda com F5.
--
-- Levantamento em 03/08/2026 no LogMax-ERP: dez tabelas com
-- `useFetchData(..., true)` no código e ausentes da publicação. As quatro que
-- já estavam publicadas (requisicoes, aprovacoes_compras, pedidos,
-- movimentacoes_estoque) explicam por que só *parte* do fluxo de compras
-- parecia funcionar sozinha — e por que a outra parte parecia aleatória.
--
-- Por que cada uma precisa (nenhuma entra "por garantia"): todas são o ponto
-- em que um setor entrega trabalho para outro, com as duas telas abertas ao
-- mesmo tempo numa aula.
--
--   cotacoes            Compras envia a proposta, o Financeiro decide.
--   recebimentos        Um registra a chegada, outro confirma a entrada.
--   requisicoes_estoque O setor pede material, o almoxarifado libera.
--   aprovacoes_estoque  A fila de decisão dessa liberação.
--   contas_pagar        Nasce sozinha do pedido e da folha, sem ninguém digitar.
--   contas_receber      Nasce sozinha da venda e do pedido de venda.
--   orcamentos          Vendas monta, o Financeiro aprova.
--   pedidos_venda       O orçamento aprovado vira pedido para a Logística.
--   vendas              Histórico e recibos, alimentados pelo PDV ao lado.
--   produtos            Estoque do PDV: a venda de um caixa muda a grade do outro.
--
-- Custo: `produtos` é a mais movimentada (toda venda mexe no estoque). O
-- `useFetchData` agrupa eventos numa janela de 250 ms, então uma rajada de
-- vendas vira um refetch por cliente, não um por linha. Preço aceitável para
-- não vender o que já acabou.
--
-- RLS continua valendo: o realtime só entrega a linha a quem poderia lê-la num
-- SELECT, e o refetch passa pelas mesmas policies. Publicar não vaza nada.
--
-- O canal não usa filtro (`event: '*'` na tabela toda) e quem filtra é o
-- refetch, então não é preciso REPLICA IDENTITY FULL.
--
-- Idempotente: rodar de novo não duplica nada.

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cotacoes',
    'recebimentos',
    'requisicoes_estoque',
    'aprovacoes_estoque',
    'contas_pagar',
    'contas_receber',
    'orcamentos',
    'pedidos_venda',
    'vendas',
    'produtos'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verificação (esperado: 14 linhas, as 10 acima mais as 4 que já existiam):
--
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime'
--      AND schemaname = 'public'
--      AND tablename IN ('cotacoes','recebimentos','requisicoes_estoque',
--                        'aprovacoes_estoque','contas_pagar','contas_receber',
--                        'orcamentos','pedidos_venda','vendas','produtos',
--                        'requisicoes','aprovacoes_compras','pedidos',
--                        'movimentacoes_estoque')
--    ORDER BY tablename;
