-- 256_20260725f_avaliacoes_matriz_fk_profile.sql
-- ============================================================================
-- avaliacoes_matriz.avaliador_id ganha FK explicito pra user_profiles
-- ============================================================================
-- Por que: PostgREST retornava PGRST200 ao tentar embutir role do avaliador
-- via `avaliador:user_profiles!avaliador_id(role)` porque a coluna so tinha
-- FK pra auth.users e o embed nao pulava automatico pra user_profiles mesmo
-- com user_profiles.id = auth.users.id.
--
-- Impacto real (3 lugares):
--   src/views/MatrizAvaliacoesView.tsx:233
--   src/views/MatrizTarefasPanel.tsx:275
--   src/lib/centralAvaliacaoExports.ts:117
--
-- Seguranca: user_profiles.id JA e FK pra auth.users(id), entao todo
-- avaliador_id valido no FK atual e valido no novo. Idempotente.
-- ============================================================================

ALTER TABLE public.avaliacoes_matriz
  DROP CONSTRAINT IF EXISTS avaliacoes_matriz_avaliador_profile_fkey;

ALTER TABLE public.avaliacoes_matriz
  ADD CONSTRAINT avaliacoes_matriz_avaliador_profile_fkey
  FOREIGN KEY (avaliador_id)
  REFERENCES public.user_profiles(id)
  ON DELETE CASCADE;

-- Recarrega cache do PostgREST — sem isso, o embed ainda retorna PGRST200
-- ate o proximo restart do servico (padrao ja rastreado em
-- feedback_pgrst_reload_apos_rpc.md).
NOTIFY pgrst, 'reload schema';
