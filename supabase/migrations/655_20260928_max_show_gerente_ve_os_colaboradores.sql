-- =================================================================
-- 655 — Max Show: o gerente vê as apresentações dos colaboradores dele
-- =================================================================
-- Pedido (2026-09-28): a tela passa a ter três abas por autor — Admin
-- Master, Gerente e Colaborador. "Admin Master vê todas as abas; Gerente
-- vê a dele próprio e seus colaboradores; Colaborador vê apenas a própria."
--
-- Até aqui o SELECT era dono OU docente (migr. 253):
--
--   max_shows_select  USING (user_id = auth.uid() OR max_work_is_docente())
--
-- O gerente caía no "dono" e só via as próprias. Esta migração acrescenta
-- um ramo: gerente enxerga a apresentação de quem é `colaborador` na MESMA
-- filial que ele. "Seus colaboradores" = a equipe da unidade, a mesma régua
-- de `auth_gerente_da` (migr. 187).
--
-- O ramo de docente fica como estava. `max_work_is_docente()` é admin, CEO
-- e conselheiro — o pedido falou em admin, gerente e colaborador, e tirar a
-- visão de CEO/conselheiro seria cortar acesso que ninguém pediu para cortar.
--
-- Só o SELECT muda. Ver não é mexer: UPDATE e DELETE continuam dono ou
-- admin (migr. 567) — o gerente não apaga o trabalho do colaborador.
--
-- Desempenho (incidente de 15/09): a lista de colaboradores é subconsulta
-- SEM correlação com a linha, e a identidade vem embrulhada em (SELECT ...)
-- — o Postgres calcula as duas uma vez por consulta, não por apresentação.
-- `max_work_is_docente()` ganha o mesmo embrulho de passagem.
--
-- A subconsulta lê `user_profiles` com a RLS de quem pergunta. Serve: o
-- gerente enxerga os perfis da própria filial (up_select_own_or_scope). Um
-- colaborador que chegasse até aqui nem passa do teste de papel.
--
-- Filial NULL não casa com nada (NULL = NULL é NULL), então gerente sem
-- unidade não vê ninguém a mais — o mesmo de hoje.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS max_shows_select ON public.max_shows;
CREATE POLICY max_shows_select ON public.max_shows
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT max_work_is_docente())
    OR (
      COALESCE((SELECT auth_user_role()) = 'gerente', false)
      AND user_id IN (
        SELECT u.id FROM public.user_profiles u
         WHERE u.role = 'colaborador'
           AND u.filial = (SELECT auth_user_filial())
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT qual FROM pg_policies
--    WHERE tablename = 'max_shows' AND policyname = 'max_shows_select';
--   -- deve citar role = 'colaborador' e auth_user_filial().
-- =================================================================
