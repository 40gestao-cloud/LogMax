-- ════════════════════════════════════════════════════════════════════════════
-- 587 — O cadastro do Administrador também some do RH
--
-- Fecha o último caminho: a 585 impediu mexer no perfil do professor e a 586
-- tirou a conta dele da lista de Usuários, mas a tela de Funcionários lê
-- `funcionarios`, que tem régua própria (RH e gerente da unidade). Hoje não
-- existe cadastro do professor em turma nenhuma — o gatilho da 585 impede
-- criá-lo —, mas se um dia ele precisar de crachá, ponto ou folha, o cadastro
-- que ELE criar não deve aparecer para a turma.
--
-- Policy RESTRITIVA de propósito: as permissivas se somam com OR, então uma
-- permissiva nova não esconderia nada — `func_self` continuaria devolvendo a
-- linha. Restritiva vale sobre todas, e cobre SELECT, UPDATE, INSERT e DELETE
-- de uma vez.
--
-- O helper é SECURITY DEFINER porque a policy roda com os direitos de quem
-- consulta: um SELECT cru em `user_profiles` dentro dela já não enxergaria a
-- linha do admin (a 586 a escondeu), o teste daria "não é admin" e a regra se
-- anularia sozinha. É o mesmo raciocínio de sempre — quem julga privilégio não
-- pode depender da visibilidade de quem está sendo julgado.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.eh_perfil_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT role = 'admin' FROM public.user_profiles WHERE id = p_id), false);
$function$;

REVOKE ALL ON FUNCTION public.eh_perfil_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eh_perfil_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.eh_perfil_admin(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS zz_funcionario_do_admin ON public.funcionarios;
CREATE POLICY zz_funcionario_do_admin ON public.funcionarios
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    COALESCE(public.auth_user_role() = 'admin', false)
    OR user_profile_id IS NULL
    OR user_profile_id = auth.uid()
    OR NOT public.eh_perfil_admin(user_profile_id)
  )
  WITH CHECK (
    COALESCE(public.auth_user_role() = 'admin', false)
    OR user_profile_id IS NULL
    OR user_profile_id = auth.uid()
    OR NOT public.eh_perfil_admin(user_profile_id)
  );

NOTIFY pgrst, 'reload schema';
