-- =================================================================
-- Avaliações: filial vê feedback da Matriz sobre ela
-- =================================================================
-- Contexto:
--   Avaliações do tipo 'matriz_filial' (CEO / conselheiros avaliando a
--   filial como entidade, no ciclo Matriz) têm avaliado_id = NULL e
--   avaliada_filial = 'SuperMax'|'MaxLook'|'TechMax'. A policy antiga
--   avaliacoes_read só liberava para admin, avaliador e avaliado — o
--   que deixava colaboradores/gerentes da própria filial sem acesso ao
--   feedback que a Matriz registrou sobre eles. Este patch libera SELECT
--   para qualquer usuário cuja filial coincida com avaliada_filial.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "avaliacoes_read" ON public.avaliacoes;

CREATE POLICY "avaliacoes_read" ON public.avaliacoes
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR avaliador_id = auth.uid()
    OR avaliado_id  = auth.uid()
    OR (
      auth_user_role() = 'gerente'
      AND avaliado_id IN (SELECT id FROM user_profiles WHERE setor = auth_user_setor())
    )
    -- Feedback da Matriz sobre a filial: qualquer usuário da filial avaliada lê.
    OR (avaliada_filial IS NOT NULL AND avaliada_filial = auth_user_filial())
  );

COMMIT;
