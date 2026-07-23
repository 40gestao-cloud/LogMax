-- =================================================================
-- Remove função `cancelar_pix_pendentes_antigos(int)` do projeto Adm.
--
-- Auditoria por hashes identificou que a fn existe SÓ no projeto Adm
-- (pvzfaejminpxkuuhilhz), presumivelmente um teste manual antigo. Não
-- é usada pelo frontend nem por cron. Removida para convergir com os
-- outros 3 projetos.
--
-- APLICAR SOMENTE NO PROJETO LogMax-Adm.
-- =================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.cancelar_pix_pendentes_antigos(integer);

NOTIFY pgrst, 'reload schema';

COMMIT;
