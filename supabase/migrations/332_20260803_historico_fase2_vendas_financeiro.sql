-- 332 — Histórico de operações, fase 2: vendas e financeiro.
--
-- A fase 1 (migr. 331) cobriu o caminho do dinheiro saindo: requisição →
-- cotação → pedido → recebimento → conta a pagar. Esta cobre o dinheiro
-- entrando e o resto do financeiro.
--
-- Só triggers: a tabela, a RLS e a função genérica já existem. É de propósito
-- que a fase 2 não tenha SQL novo além disto — se precisasse, o desenho da 331
-- estaria errado.
--
-- As colunas declaradas em cada trigger são as que valem como decisão naquele
-- documento. `status` entra sempre, sem precisar ser declarado.
--
-- `notas_emitidas` não tem coluna `status`: registra 'Criado' e alterações de
-- valor ou número, que é o que existe para contar nela.
--
-- Custo: `vendas` é a mais movimentada — uma linha de histórico por venda do
-- PDV. É um INSERT dentro de uma transação que já faz vários; e saber quem
-- vendeu, quando e por quanto é exatamente o tipo de pergunta que aparece
-- depois, quando o caixa não fecha.

BEGIN;

-- ── Vendas ──────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_historico ON public.vendas;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('total_final', 'desconto', 'forma_pagamento', 'cliente_id');

DROP TRIGGER IF EXISTS trg_historico ON public.devolucoes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.devolucoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('motivo');

DROP TRIGGER IF EXISTS trg_historico ON public.orcamentos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor_total', 'desconto', 'cliente_id');

DROP TRIGGER IF EXISTS trg_historico ON public.pedidos_venda;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.pedidos_venda
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor_total', 'cliente_id');

-- Separação e despacho: é aqui que a mercadoria sai, e é o elo que costuma
-- ficar sem explicação quando o cliente cobra o pedido.
DROP TRIGGER IF EXISTS trg_historico ON public.expedicao;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.expedicao
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico();

DROP TRIGGER IF EXISTS trg_historico ON public.notas_emitidas;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.notas_emitidas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor_total', 'numero');

-- ── Financeiro ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_historico ON public.contas_receber;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor', 'vencimento', 'cliente_id');

-- Abertura e fechamento do caixa. Quando o caixa não bate, a primeira pergunta
-- é quem abriu, com quanto, e quem fechou — e hoje isso não fica registrado em
-- lugar nenhum que a tela mostre.
DROP TRIGGER IF EXISTS trg_historico ON public.controle_caixa;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.controle_caixa
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor_abertura', 'valor_fechamento');

DROP TRIGGER IF EXISTS trg_historico ON public.folha_pagamento;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.folha_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico();

DROP TRIGGER IF EXISTS trg_historico ON public.notas_recebidas;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.notas_recebidas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor_total');

COMMIT;

-- Verificação (esperado: 18 tabelas — as 8 da fase 1 mais estas 10):
--
--   SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname = 'trg_historico' ORDER BY 1;
--
--   -- Uma venda no PDV deve produzir uma linha 'Criado':
--   SELECT evento, para, ator_nome, created_at
--     FROM historico_operacoes WHERE entidade = 'vendas'
--    ORDER BY created_at DESC LIMIT 5;
