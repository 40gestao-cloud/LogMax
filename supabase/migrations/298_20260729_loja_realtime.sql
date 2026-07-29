-- 298 — A fila de pedidos online chega sem F5.
--
-- ERRO DA 293. A tela já pedia realtime desde o primeiro dia:
--
--     useFetchData('/api/pedidosonlineview', { filial }, true)
--                                                        ^^^^
--
-- e o `useFetchData` abre o canal, assina `postgres_changes` e faz refetch a
-- cada evento. Só que as três tabelas nunca entraram na publicação
-- `supabase_realtime` — sem isso o Postgres não publica nada, o canal fica
-- aberto ouvindo silêncio e a tela só muda com F5.
--
-- Não dá erro em lugar nenhum, e é justamente o que torna a falha chata: o
-- código do cliente está certo, o canal conecta, o status é SUBSCRIBED, e o
-- aluno conclui que o sistema é lento.
--
-- As três, porque a tela assina as três: a fila (`pedidos_online`), os itens
-- que aparecem ao expandir o pedido (`pedidos_online_itens`) e o estado
-- aberta/fechada (`loja_config`) — este último para que, quando o gerente
-- abrir a loja, a tela de quem já estava com o módulo aberto acompanhe.
--
-- RLS continua valendo: o realtime do Supabase só entrega a linha para quem
-- poderia lê-la num SELECT, e o refetch passa pelas mesmas policies. Publicar
-- a tabela não vaza pedido de outra filial.
--
-- O canal não usa filtro (`event: '*'` na tabela toda) e o refetch é que
-- filtra, então não é preciso REPLICA IDENTITY FULL.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedidos_online', 'pedidos_online_itens', 'loja_config']
  LOOP
    -- ALTER PUBLICATION ... ADD TABLE estoura se a tabela já está lá, e um
    -- erro no meio abortaria a migração inteira. Por isso o IF NOT EXISTS
    -- na mão: reaplicar tem de ser inofensivo.
    IF NOT EXISTS (
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

-- Verificação: as três devem aparecer.
--
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime'
--      AND tablename IN ('pedidos_online', 'pedidos_online_itens', 'loja_config')
--    ORDER BY tablename;
