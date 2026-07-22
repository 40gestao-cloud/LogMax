-- =================================================================
-- Avaliações — trava no banco: tipos 'gerente_colaborador' e
-- 'feedback_colaborador' deixam de ser aceitos.
--
-- Régua canônica do ciclo Padrão: só admin/CEO avaliam gerentes e
-- colaboradores. Gerente e colaborador não avaliam ninguém, e
-- conselheiro atua só na Competição/Matriz (avaliacoes_matriz + tipo
-- 'matriz_filial' aqui).
--
-- Estratégia:
--   • Reescreve `chk_aval_tipo` removendo os dois tipos deprecados.
--   • Usa NOT VALID pra NÃO bloquear linhas históricas — o hall de
--     avaliações antigas continua lendo/exibindo normalmente; só
--     novos INSERTs com esses tipos falham.
--
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
    'ti_dev_ia',
    'matriz_filial'
  )) NOT VALID;

COMMIT;
