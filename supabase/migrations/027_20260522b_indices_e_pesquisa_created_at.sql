-- =================================================================
-- LogMax — Índices em created_at + fix em pesquisa_resposta_itens
-- =================================================================
-- Contexto:
--   useFetchData ordena toda tabela mapeada por `created_at DESC` (hoje
--   hard-coded; agora também aceita override via options.orderBy). Sem
--   índice em created_at, paginação e ordenação fazem table scan + sort
--   em memória — latência cresce linearmente com volume.
--
--   Grep nas migrations encontrou só 16 índices em created_at, mas o
--   ENDPOINT_TABLE_MAP tem 50 tabelas. Esta migration fecha o gap.
--
--   Adicionalmente: pesquisa_resposta_itens não tinha created_at —
--   mesmo padrão da marketing_artes (que já corrigimos em 20260522).
--   Hoje a tabela só é gravada via RPC `responder_pesquisa`, então não
--   há sintoma reportado; mas é uma bomba-relógio para qualquer view
--   futura que faça useFetchData('/api/pesquisarespostaitensview').
--
-- Tudo `IF NOT EXISTS` / idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. pesquisa_resposta_itens — coluna created_at
-- ─────────────────────────────────────────────
-- Padrão: adiciona como NULL → backfill a partir do pai → marca NOT NULL.
-- Isto permite detectar exatamente quais linhas precisam de backfill
-- (created_at IS NULL) e roda idempotente (se já está NOT NULL, os
-- ALTERs e UPDATEs são no-op).

ALTER TABLE pesquisa_resposta_itens
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- Backfill a partir do timestamp da submissão pai (semanticamente
-- equivalente — o item nasceu junto com a resposta).
UPDATE pesquisa_resposta_itens i
   SET created_at = r.created_at
  FROM pesquisa_respostas r
 WHERE i.resposta_id = r.id
   AND i.created_at IS NULL;

-- Fallback defensivo: se sobrou linha órfã (não deveria pelo FK), usa now().
UPDATE pesquisa_resposta_itens SET created_at = now() WHERE created_at IS NULL;

-- Promove a NOT NULL + default pra novas inserções.
ALTER TABLE pesquisa_resposta_itens
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

-- ─────────────────────────────────────────────
-- 2. Índices em created_at para todas as tabelas do ENDPOINT_TABLE_MAP
-- ─────────────────────────────────────────────
-- Gerados a partir da lista em src/lib/supabase.ts. CREATE INDEX
-- IF NOT EXISTS é idempotente — se já existe (16 já tinham), é no-op.

CREATE INDEX IF NOT EXISTS idx_aprovacoes_compras_created_at        ON aprovacoes_compras(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_estoque_created_at        ON aprovacoes_estoque(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beneficios_created_at                ON beneficios(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caixa_bancos_created_at              ON caixa_bancos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargos_created_at                    ON cargos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_centros_custo_created_at             ON centros_custo(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classificacoes_auxiliares_created_at ON classificacoes_auxiliares(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clientes_created_at                  ON clientes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_colaboradores_created_at             ON colaboradores(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_condicoes_pagamento_created_at       ON condicoes_pagamento(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_created_at              ON contas_pagar(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contas_receber_created_at            ON contas_receber(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_controle_caixa_created_at            ON controle_caixa(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cotacoes_created_at                  ON cotacoes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_departamentos_created_at             ON departamentos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_duplicatas_created_at                ON duplicatas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expedicao_created_at                 ON expedicao(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ferias_created_at                    ON ferias(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_filiais_created_at                   ON filiais(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_folha_pagamento_created_at           ON folha_pagamento(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_formas_pagamento_created_at          ON formas_pagamento(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fornecedores_created_at              ON fornecedores(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funcionarios_created_at              ON funcionarios(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integracoes_bancarias_created_at     ON integracoes_bancarias(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventarios_created_at               ON inventarios(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_itens_venda_created_at               ON itens_venda(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mapeamentos_rateio_created_at        ON mapeamentos_rateio(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_arte_feedback_created_at   ON marketing_arte_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_artes_created_at           ON marketing_artes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_promocoes_created_at       ON marketing_promocoes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_tarefas_created_at         ON marketing_tarefas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_created_at     ON movimentacoes_estoque(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notas_recebidas_created_at           ON notas_recebidas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notificacoes_created_at              ON notificacoes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_created_at                   ON pedidos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pesquisa_perguntas_created_at        ON pesquisa_perguntas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pesquisa_resposta_itens_created_at   ON pesquisa_resposta_itens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pesquisa_respostas_created_at        ON pesquisa_respostas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pesquisas_created_at                 ON pesquisas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ponto_eletronico_created_at          ON ponto_eletronico(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_previsoes_created_at                 ON previsoes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_produtos_created_at                  ON produtos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projetos_created_at                  ON projetos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recebimentos_created_at              ON recebimentos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requisicoes_created_at               ON requisicoes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requisicoes_estoque_created_at       ON requisicoes_estoque(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_servicos_created_at                  ON servicos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tarefas_created_at                   ON tarefas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ti_chamados_created_at               ON ti_chamados(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treinamentos_created_at              ON treinamentos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vencimentos_estoque_created_at       ON vencimentos_estoque(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendas_created_at                    ON vendas(created_at DESC);

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- Lista todos os índices em created_at:
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE schemaname='public' AND indexdef ILIKE '%created_at%'
--    ORDER BY tablename;
--
-- Conferir pesquisa_resposta_itens.created_at:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='pesquisa_resposta_itens' AND column_name='created_at';
-- =================================================================
