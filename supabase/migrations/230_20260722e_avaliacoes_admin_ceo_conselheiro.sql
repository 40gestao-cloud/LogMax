-- =================================================================
-- Avaliações: novos tipos `admin_ceo` e `admin_conselheiro`.
--
-- Contexto:
--   Admin precisa avaliar CEO e Conselheiros com um set próprio de
--   critérios estratégicos (Pontualidade, Decisões Estratégicas,
--   Planos de Ação, Qualidade de Relatórios, Ordem de Comando,
--   Condução dos Trabalhos). O tipo `ceo_conselheiro` já existente
--   continua servindo pro CEO avaliar conselheiros com o set padrão.
--
-- Mudança: amplia CHECK constraint. RLS e RPCs são agnósticas ao tipo.
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.avaliacoes DROP CONSTRAINT IF EXISTS chk_aval_tipo;

ALTER TABLE public.avaliacoes
  ADD CONSTRAINT chk_aval_tipo
  CHECK (tipo IN (
    'ceo_gerente',
    'ceo_colaborador',
    'ceo_conselheiro',
    'admin_ceo',
    'admin_conselheiro',
    'gerente_colaborador',
    'feedback_colaborador',
    'ti_dev_ia',
    'matriz_filial'
  ));

COMMIT;
