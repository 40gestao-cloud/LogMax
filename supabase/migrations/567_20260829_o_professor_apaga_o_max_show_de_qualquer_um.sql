-- =================================================================
-- Max Show — o professor consegue apagar a apresentação de qualquer um
-- =================================================================
-- Relato (2026-08-29): "admin ao excluir arquivos do MaxShow deve poder
-- excluir de todos; hoje tento excluir e não exclui". Sem erro na tela:
-- some o botão de confirmar, aparece "Movido para a lixeira", a lista
-- recarrega e o arquivo continua lá.
--
-- Causa. Excluir no Max Show é SOFT delete — um UPDATE que grava
-- `deleted_at`. A policy de UPDATE nasceu na migr. 253 sem o ramo de
-- docente que o SELECT e o DELETE receberam:
--
--   max_shows_select  USING (user_id = auth.uid() OR max_work_is_docente())
--   max_shows_delete  USING (user_id = auth.uid() OR max_work_is_docente())
--   max_shows_update  USING (user_id = auth.uid())              <-- aqui
--
-- Então o professor VÊ a apresentação do aluno (SELECT passa) e o UPDATE
-- não encontra linha nenhuma. Um UPDATE que casa zero linhas não é erro
-- em Postgres nem no PostgREST: volta 200 com lista vazia. A tela não
-- tinha como saber e anunciava sucesso. Mesma coisa no "restaurar", que
-- também é UPDATE. Conferido nos 4 bancos — idêntico, sem drift.
--
-- Recorte. `max_work_is_docente()` é admin | ceo | conselheiro, e nas
-- turmas CEO e conselheiro são ALUNOS (no LogMax-ERP, hoje: 1 admin e 1
-- conselheiro, este último colega dos outros 25). Dar-lhes o apagar
-- entrega o trabalho de um colega à mão de outro. "O professor" aqui é
-- `role = 'admin'` e mais ninguém — mesma régua de Usuários, do cofre de
-- senhas e das planilhas do aluno (migr. 390). Vide o histórico da 389,
-- que abriu material pessoal para `auth_is_admin()` por ler o nome do
-- helper como "docente".
--
-- Pelo mesmo motivo esta migração APERTA o DELETE, que hoje já deixa um
-- aluno-CEO apagar de vez o PDF de um colega. Não é o que foi relatado,
-- mas é o mesmo buraco na mesma tabela, e fechá-lo agora custa duas
-- linhas.
--
-- O SELECT fica como está: enxergar tudo é a premissa do módulo ("visão
-- docente", migr. 253) e ninguém pediu para mudar quem vê.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- COALESCE porque sem perfil `auth_user_role()` devolve NULL, e NULL num
-- OR não é falso: o predicado inteiro vira NULL e o guard desaparece.
DROP POLICY IF EXISTS max_shows_update ON public.max_shows;
CREATE POLICY max_shows_update ON public.max_shows
  FOR UPDATE
  USING      (user_id = auth.uid() OR COALESCE(public.auth_user_role() = 'admin', false))
  WITH CHECK (user_id = auth.uid() OR COALESCE(public.auth_user_role() = 'admin', false));

DROP POLICY IF EXISTS max_shows_delete ON public.max_shows;
CREATE POLICY max_shows_delete ON public.max_shows
  FOR DELETE
  USING (user_id = auth.uid() OR COALESCE(public.auth_user_role() = 'admin', false));

-- Recarrega cache PostgREST.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE tablename='max_shows' ORDER BY cmd, policyname;
--   -- update e delete devem citar auth_user_role() = 'admin';
--   -- select continua com max_work_is_docente().
-- =================================================================
