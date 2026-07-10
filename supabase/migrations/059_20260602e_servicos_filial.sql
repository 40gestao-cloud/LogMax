-- =================================================================
-- LogMax — servicos.filial
--
-- Adiciona coluna `filial` em `servicos` para identificar a qual
-- empresa cada serviço pertence (SuperMax, MaxLook, TechMax, Matriz).
-- Antes deste commit, o cadastro de serviços não tinha vinculação
-- com empresa.
--
-- Sem default e nullable: serviços legados ficam com filial=NULL e
-- aparecem agrupados como "Sem empresa" nas listagens (ex.: select
-- de Marketing/Promoções). Colaboradores vão preencher conforme
-- revisam os cadastros existentes.
-- =================================================================

BEGIN;

ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS filial text;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Confirmar coluna criada (deve estar nullable, sem default):
--    \d+ servicos
--
-- 2. Quantidade de servicos sem filial:
--    SELECT COUNT(*) FROM servicos WHERE filial IS NULL;
-- =================================================================
