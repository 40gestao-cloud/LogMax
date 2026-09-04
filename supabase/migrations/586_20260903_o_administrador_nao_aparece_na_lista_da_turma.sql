-- ════════════════════════════════════════════════════════════════════════════
-- 586 — O Administrador não aparece na lista da turma
--
-- Complemento da 585. Lá o perfil do professor ficou inalterável; aqui ele sai
-- de vista. Quem não é administrador não vê a conta do administrador —
-- nem para consultar, nem para escolher num select.
--
-- O gerente já não via: a policy antiga terminava em `auth_pode_filial(filial)`,
-- e o professor é da Matriz (filial NULL na prática) — a comparação dá NULL e
-- a policy nega, que é o mesmo efeito por acidente descrito em
-- [[feedback_nome_por_uuid_rls_matriz]]. Quem via era CEO e conselheiro, por
-- causa do `auth_is_admin()` do meio — que inclui os dois (é "escopo global",
-- não "é o professor").
--
-- A regra nova, em três linhas:
--   • cada um vê a própria linha (o login precisa disso);
--   • quem é `role = 'admin'` vê todo mundo (é ele quem administra contas);
--   • os demais veem todo mundo MENOS as contas de administrador, dentro do
--     escopo que já tinham.
--
-- Efeito colateral conhecido e aceito: tela que resolve uuid→nome direto em
-- `user_profiles` deixa de mostrar o nome do professor como autor. O padrão da
-- casa para esse caso já existe e continua valendo — omitir a frase, ou usar a
-- view com nome resolvido no banco (`HistoricoOperacoes`), nunca deixar "…".
--
-- As duas views de avaliação da Matriz (`avaliacoes_matriz_agregado` e
-- `..._placar_filial`) são `security_invoker` e já filtravam `up.role <>
-- 'admin'` no JOIN: o placar não muda.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS up_select_own_or_scope ON public.user_profiles;

CREATE POLICY up_select_own_or_scope ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR COALESCE(public.auth_user_role() = 'admin', false)
    OR (
      COALESCE(role, '') <> 'admin'
      AND (public.auth_is_admin() OR public.auth_pode_filial(filial))
    )
  );

NOTIFY pgrst, 'reload schema';
