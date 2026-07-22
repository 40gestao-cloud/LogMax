-- =================================================================
-- Fecha vazamento aberto pela migração 233:
--   `avaliacoes_matriz` estava com SELECT USING(true), o que expunha
--   `avaliador_id`, `decisao` e `comentario` — voto individual e
--   comentário privado de cada conselheiro — para qualquer usuário.
--
-- Ação:
--   • Volta a policy SELECT para conselho/CEO em Matriz (versão 210).
--   • Garante que a view agregada `avaliacoes_matriz_agregado` (já
--     criada em 210) siga legível por `authenticated` — é a única
--     porta que filial precisa (mostra média por participante, sem
--     revelar quem votou o quê).
--   • DemandasView passa a consumir a view agregada em vez da tabela.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS aval_matriz_select ON public.avaliacoes_matriz;
CREATE POLICY aval_matriz_select ON public.avaliacoes_matriz
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND filial = 'Matriz'
        AND (
          role IN ('admin','ceo','conselheiro')
          OR (role = 'gerente' AND is_conselheiro = true)
        )
    )
  );

GRANT SELECT ON public.avaliacoes_matriz_agregado TO authenticated;

COMMIT;
