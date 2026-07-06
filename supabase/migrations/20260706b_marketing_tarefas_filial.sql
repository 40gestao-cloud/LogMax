-- =================================================================
-- Adiciona `filial` em marketing_tarefas + backfill via marketing_promocoes.
--
-- Objetivo: alinhar marketing_tarefas ao padrão multi-filial. Antes,
-- a fila de aprovação de conteúdo (AprovacoesConteudoMarketingView)
-- misturava tarefas das 3 unidades.
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.marketing_tarefas
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- marketing_tarefas não tem FK direto para promocao/campanha — tarefas
-- existentes ficam em 'SuperMax' pelo DEFAULT e podem ser reatribuídas
-- manualmente. Novas tarefas devem receber o campo `filial` no INSERT.

CREATE INDEX IF NOT EXISTS idx_marketing_tarefas_filial
  ON public.marketing_tarefas (filial);

COMMIT;
