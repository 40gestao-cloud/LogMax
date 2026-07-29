-- 281 — Matriz de autoridade (Etapa 8 da auditoria de veracidade)
--
-- Levantamento dos guards de todas as RPCs de transição, feito no banco.
-- Fecha o que o levantamento achou de errado por construção; o que é decisão
-- de processo (segregação de funções) ficou registrado no plano, não aqui.
--
-- 1. Superfície de execução: quatro funções internas/sensíveis estavam com
--    EXECUTE para `anon`. `_folha_creditar_e_avancar` e `creditar_folha_maxbank`
--    não têm RBAC nenhum (o gate mora em `pagar_folha`), então quem tivesse a
--    anon key — que é pública, vai no bundle — creditava a carteira e levava a
--    folha a 'Paga' sem passar pelo RH. `reverter_afastamento_no_ponto` apaga e
--    restaura linhas de `ponto_eletronico` sem guard e sem chamador no
--    frontend: só triggers a usam.
-- 2. `_assert_capital_holding` falhava ABERTO (P7): `auth.uid() IS NULL`
--    retornava em silêncio em vez de barrar.
-- 3. A policy de UPDATE de `emprestimos_filial` era mais larga que a RPC —
--    conselheiro e gerente-conselheiro podiam mudar o status por UPDATE direto,
--    contornando `aprovar_emprestimo` (migr. 277). Nenhuma tela faz esse UPDATE.
-- 4. Segregação mínima em capital: quem solicita o empréstimo não decide sobre
--    ele. `admin`/`ceo` também podem solicitar (policy de INSERT), então o par
--    solicitante=aprovador era alcançável.

BEGIN;

-- ── 1. Superfície de execução ────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public._folha_creditar_e_avancar(uuid, uuid, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.creditar_folha_maxbank(uuid)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverter_afastamento_no_ponto(uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.pagar_folha(uuid)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.processar_folha(uuid) FROM anon;

-- ── 2. Guard que falhava aberto ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_capital_holding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.'
      USING ERRCODE = '42501';
  END IF;

  IF public.auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin ou CEO decidem sobre empréstimos entre filiais.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- ── 3. Policy alinhada à RPC ─────────────────────────────────────────────────
DROP POLICY IF EXISTS emprestimos_update ON public.emprestimos_filial;
CREATE POLICY emprestimos_update ON public.emprestimos_filial
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() IN ('admin', 'ceo'))
  WITH CHECK (public.auth_user_role() IN ('admin', 'ceo'));

-- ── 4. Segregação de funções em capital ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_nao_e_o_solicitante(p_solicitado_por uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF p_solicitado_por IS NOT NULL AND p_solicitado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem solicita não decide: peça a outro admin ou CEO.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._assert_nao_e_o_solicitante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_nao_e_o_solicitante(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.aprovar_emprestimo(
  p_emprestimo_id       uuid,
  p_banco_id            uuid,
  p_banco_nome          text,
  p_taxa_juros          numeric,
  p_num_parcelas        integer,
  p_justificativa_resp  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp        RECORD;
  v_valor_par  numeric;
  v_valor_tot  numeric;
  v_valor_this numeric;
  v_soma_par   numeric := 0;
  i            int;
  v_venc       date;
  v_cp_id      uuid;
BEGIN
  PERFORM public._assert_capital_holding();

  SELECT * INTO v_emp FROM public.emprestimos_filial
   WHERE id = p_emprestimo_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empréstimo não encontrado'; END IF;
  IF v_emp.status <> 'Pendente' THEN RAISE EXCEPTION 'Empréstimo já processado'; END IF;

  -- Segregação: quem pediu não decide.
  PERFORM public._assert_nao_e_o_solicitante(v_emp.solicitado_por);

  v_valor_tot := ROUND(v_emp.valor * (1 + p_taxa_juros / 100), 2);
  v_valor_par := ROUND(v_valor_tot / p_num_parcelas, 2);

  UPDATE public.emprestimos_filial SET
    status                 = 'Aprovado',
    banco_id               = p_banco_id,
    banco_nome             = p_banco_nome,
    taxa_juros             = p_taxa_juros,
    num_parcelas           = p_num_parcelas,
    aprovado_por           = auth.uid(),
    aprovado_por_nome      = (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
    justificativa_resposta = p_justificativa_resp
  WHERE id = p_emprestimo_id;

  -- #2: credita saldo do banco escolhido (valor original, sem juros)
  IF p_banco_id IS NOT NULL THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + v_emp.valor
     WHERE id = p_banco_id;
  END IF;

  -- Gera parcelas + contas_pagar
  FOR i IN 1..p_num_parcelas LOOP
    v_venc := public.acre_today() + ((i) * interval '1 month');

    -- #5: última parcela absorve diferença de arredondamento
    IF i = p_num_parcelas THEN
      v_valor_this := v_valor_tot - v_soma_par;
    ELSE
      v_valor_this := v_valor_par;
      v_soma_par := v_soma_par + v_valor_par;
    END IF;

    INSERT INTO public.contas_pagar (descricao, valor, vencimento, status, filial, origem)
    VALUES (
      'Parcela ' || i || '/' || p_num_parcelas || ' — Empréstimo ' || COALESCE(p_banco_nome, 'Banco'),
      v_valor_this,
      v_venc,
      'Pendente',
      v_emp.filial,
      'emprestimo'
    )
    RETURNING id INTO v_cp_id;

    INSERT INTO public.parcelas_emprestimo
      (emprestimo_id, num_parcela, valor_parcela, data_vencimento, contas_pagar_id)
    VALUES
      (p_emprestimo_id, i, v_valor_this, v_venc, v_cp_id);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.negar_emprestimo(
  p_emprestimo_id      uuid,
  p_justificativa_resp text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_solicitado_por uuid;
BEGIN
  PERFORM public._assert_capital_holding();

  SELECT solicitado_por INTO v_solicitado_por
    FROM public.emprestimos_filial
   WHERE id = p_emprestimo_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empréstimo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_nao_e_o_solicitante(v_solicitado_por);

  UPDATE public.emprestimos_filial SET
    status                 = 'Negado',
    aprovado_por           = auth.uid(),
    aprovado_por_nome      = (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
    justificativa_resposta = p_justificativa_resp
  WHERE id = p_emprestimo_id AND status = 'Pendente';
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
