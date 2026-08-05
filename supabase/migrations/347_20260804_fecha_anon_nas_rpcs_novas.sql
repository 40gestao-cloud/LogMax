-- =================================================================
-- 347 — Fecha EXECUTE de `anon` nas RPCs criadas depois da 260.
--
-- Achado da auditoria pós-345 (2026-08-04):
--   Estas quatro nasceram executáveis por `anon`:
--     • remover_avaliacao_matriz      (343)
--     • liberar_matriz_tarefa         (345)
--     • progresso_avaliacao_matriz    (345)
--     • lembrar_avaliacoes_pendentes  (345)
--
-- Causa:
--   A 260 varreu as funções existentes revogando anon, mas o Supabase
--   mantém ALTER DEFAULT PRIVILEGES concedendo EXECUTE a anon e
--   authenticated em TODA função nova de `public`. Esse grant é
--   explícito para o role anon — `REVOKE ALL ... FROM public` (que foi
--   o que as migrações 343/345 fizeram) não o remove. Toda RPC criada
--   depois da 260 volta a nascer aberta se não revogar anon nominalmente.
--   As RPCs antigas (avaliar_item_matriz etc.) seguem fechadas porque
--   CREATE OR REPLACE preserva a ACL existente.
--
-- Exposição real:
--   • liberar/progresso/remover: os guards internos usam auth.uid(),
--     que é NULL para anon, então as três já barravam com exceção.
--     Fechamento é defesa em profundidade.
--   • lembrar_avaliacoes_pendentes: essa NÃO tem guard — foi escrita
--     para o cron rodar com service_role. Com a anon key (que está no
--     bundle do front) dava para chamá-la e disparar notificação de
--     lembrete. Escrita sem autenticação, ainda que limitada a 1 aviso
--     por competição por dia e só na janela de 3 dias do fim.
--
-- Correção: revoga anon das quatro; a de cron perde também authenticated
-- (nada na UI chama, só o cron precisa).
--
-- Idempotente.
-- =================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.remover_avaliacao_matriz(uuid, text, uuid)   FROM anon, public;
REVOKE ALL ON FUNCTION public.liberar_matriz_tarefa(uuid)                  FROM anon, public;
REVOKE ALL ON FUNCTION public.progresso_avaliacao_matriz(uuid)             FROM anon, public;
REVOKE ALL ON FUNCTION public.lembrar_avaliacoes_pendentes()               FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.remover_avaliacao_matriz(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_matriz_tarefa(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.progresso_avaliacao_matriz(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.lembrar_avaliacoes_pendentes()             TO service_role;

COMMIT;

-- Conferência (deve voltar tudo false):
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('remover_avaliacao_matriz','liberar_matriz_tarefa',
--                        'progresso_avaliacao_matriz','lembrar_avaliacoes_pendentes');

NOTIFY pgrst, 'reload schema';
