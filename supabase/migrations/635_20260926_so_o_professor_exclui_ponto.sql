-- 635 — Excluir registro de ponto é do professor, e só dele.
--
-- Caso que motivou (26/09): lançou-se "Presente" num dia sem aula. O registro
-- fica contando como dia letivo na frequência e no placar — engano que só se
-- desfaz apagando. A tela só oferecia a lixeira ao admin, na aba Registros,
-- mas a policy de DELETE deixava o RH e o gerente da filial apagarem pela API:
-- a trava era da tela, não do banco.
--
-- 1. `remover_ponto(id)`: só `role = 'admin'` literal (auth_is_admin() inclui
--    CEO e conselheiro, que aqui são alunos). Recusa as duas linhas que o
--    `registrar_ponto_manual` já se recusa a reescrever: dia da turma anterior
--    (antes do APAGAR TUDO) e dia coberto por afastamento.
-- 2. A policy de DELETE passa a ser só do admin. As RPCs SECURITY DEFINER que
--    apagam ponto (afastamento, reset) não passam pela RLS e seguem iguais.

BEGIN;

CREATE OR REPLACE FUNCTION public.remover_ponto(p_ponto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ponto public.ponto_eletronico;
  v_nome  text;
  v_corte date := public.ponto_corte_turma();
BEGIN
  PERFORM public._assert_rpc();

  IF COALESCE((SELECT public.auth_user_role()), '') <> 'admin' THEN
    RAISE EXCEPTION 'Só o professor (admin) exclui registro de ponto.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ponto FROM public.ponto_eletronico WHERE id = p_ponto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de ponto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT nome INTO v_nome FROM public.funcionarios WHERE id = v_ponto.funcionario_id;

  IF v_corte IS NOT NULL AND v_ponto.data < v_corte THEN
    RAISE EXCEPTION 'Dia % de % é da turma anterior (APAGAR TUDO de %) — histórico, não se exclui.',
      to_char(v_ponto.data, 'DD/MM/YYYY'), COALESCE(v_nome, 'funcionário'), to_char(v_corte, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  IF v_ponto.afastamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dia % de % está coberto por um afastamento. Ajuste pelo módulo Afastamentos.',
      to_char(v_ponto.data, 'DD/MM/YYYY'), COALESCE(v_nome, 'funcionário')
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.ponto_eletronico WHERE id = p_ponto_id;

  RETURN jsonb_build_object('ok', true, 'funcionario', v_nome, 'data', v_ponto.data, 'status', v_ponto.status);
END;
$function$;

REVOKE ALL ON FUNCTION public.remover_ponto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_ponto(uuid) TO authenticated;

-- (select ...) em volta do helper: avaliado uma vez por consulta, não por
-- linha (migr. 597/598).
DROP POLICY IF EXISTS ponto_rh_delete ON public.ponto_eletronico;
DROP POLICY IF EXISTS ponto_admin_delete ON public.ponto_eletronico;
CREATE POLICY ponto_admin_delete ON public.ponto_eletronico
  FOR DELETE TO authenticated
  USING ((SELECT auth_user_role()) = 'admin');

NOTIFY pgrst, 'reload schema';

COMMIT;
