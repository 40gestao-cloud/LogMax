-- =================================================================
-- Central de Avaliação — fecha isolamento por filial
--
-- Antes: avaliacoes_read/evidencias_read liberavam gerente pelo
-- SETOR sem filtro de filial. Como os 6 setores existem nas 3
-- filiais (financeiro/gerencia/logistica/marketing/rh/vendas),
-- gerente de SuperMax:vendas via avaliações/comprovantes de
-- TechMax:vendas e MaxLook:vendas. Também: `setor = auth_user_setor()`
-- ignorava `setores_extras` (gap multi-setor). E `evidencias_read`
-- dava passe livre a qualquer usuário com setor=rh — RH deixou de
-- ser papel global.
--
-- Depois:
--   - Gerente só vê avaliações/evidências de colaboradores da
--     PRÓPRIA FILIAL, e considera todos os setores (principal +
--     setores_extras).
--   - RH perde acesso especial em evidências — vira usuário comum.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- avaliacoes: SELECT policy com filtro de filial + multi-setor
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS avaliacoes_read ON public.avaliacoes;
CREATE POLICY avaliacoes_read ON public.avaliacoes
FOR SELECT
USING (
  auth_is_admin()
  OR avaliador_id = auth.uid()
  OR avaliado_id  = auth.uid()
  OR (
    auth_user_role() = 'gerente'
    AND avaliado_id IN (
      SELECT id FROM public.user_profiles
      WHERE setor = ANY (auth_user_setores())
        AND filial = auth_user_filial()
    )
  )
  OR (avaliada_filial IS NOT NULL AND avaliada_filial = auth_user_filial())
);

-- ─────────────────────────────────────────────────────────────────
-- evidencias_avaliacao: SELECT policy sem RH global + filtro filial
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS evidencias_read ON public.evidencias_avaliacao;
CREATE POLICY evidencias_read ON public.evidencias_avaliacao
FOR SELECT
USING (
  auth_is_admin()
  OR colaborador_id = auth.uid()
  OR (
    auth_user_role() = 'gerente'
    AND colaborador_id IN (
      SELECT id FROM public.user_profiles
      WHERE setor = ANY (auth_user_setores())
        AND filial = auth_user_filial()
    )
  )
);

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como gerente SuperMax:vendas, deve devolver 0 linhas de outra filial:
--   SELECT count(*) FROM avaliacoes a
--     JOIN user_profiles up ON up.id = a.avaliado_id
--    WHERE up.filial <> 'SuperMax';
--   -- deve ser 0 se auth.uid() é gerente SuperMax.
-- =================================================================
