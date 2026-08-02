-- =================================================================
-- LogMax — Transferência entre contas da mesma unidade
-- =================================================================
-- Regressão aberta pela 327 e fechada aqui. Ao tirar o campo "Saldo" do
-- formulário, tirei junto a única forma que existia de repartir dinheiro
-- entre as contas de uma unidade — antes isso se fazia digitando um valor
-- menor numa conta e um maior na outra.
--
-- Sem isto, a filial que recebe um aporte de R$ 100.000 no Banco do Brasil
-- não tem como passar R$ 5.000 pro caixa físico. O dinheiro entra e não se
-- move. Fora do ERP essa operação existe todo dia: TED interna, sangria do
-- caixa pro banco, suprimento do caixa pra troco.
--
-- REGRAS
--   • Origem e destino têm de ser da MESMA unidade. Transferir entre filiais
--     seria aporte ou empréstimo — cada um com sua RPC, sua alçada e seu
--     rastro. Esta aqui não é porta dos fundos pra nenhum dos dois.
--   • Não sai o que não há: trava pelo saldo da origem, como a 326.
--   • Respeita `filial_caixa_config.bloqueado`. Quando a Matriz tranca o
--     caixa da filial, tranca inclusive o remanejamento interno — senão a
--     trava vira decoração.
--   • Quem move: admin/CEO, Financeiro da unidade ou o gerente dela. Mesma
--     régua de `registrar_pagamento_conta` (267/325).
--
-- Conta global/legada (`filial IS NULL`) transfere só com outra global: sem
-- dono declarado, não há "mesma unidade" que se possa afirmar.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.transferir_entre_contas(
  p_origem_id  uuid,
  p_destino_id uuid,
  p_valor      numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_orig_filial  text;
  v_orig_saldo   numeric;
  v_orig_nome    text;
  v_dest_filial  text;
  v_dest_nome    text;
  v_achou        boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF p_origem_id IS NULL OR p_destino_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de origem e a de destino.' USING ERRCODE = 'P0001';
  END IF;
  IF p_origem_id = p_destino_id THEN
    RAISE EXCEPTION 'Origem e destino são a mesma conta.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  -- Trava as duas linhas numa ordem determinística (por id). Duas
  -- transferências simultâneas em sentidos opostos entre as mesmas contas
  -- travariam uma na outra se cada uma bloqueasse "a sua" primeiro.
  PERFORM 1 FROM public.caixa_bancos
   WHERE id IN (p_origem_id, p_destino_id)
   ORDER BY id
   FOR UPDATE;

  SELECT filial, COALESCE(saldo, 0), COALESCE(banco, conta), true
    INTO v_orig_filial, v_orig_saldo, v_orig_nome, v_achou
    FROM public.caixa_bancos
   WHERE id = p_origem_id AND COALESCE(ativo, true);
  IF NOT COALESCE(v_achou, false) THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  v_achou := false;
  SELECT filial, COALESCE(banco, conta), true
    INTO v_dest_filial, v_dest_nome, v_achou
    FROM public.caixa_bancos
   WHERE id = p_destino_id AND COALESCE(ativo, true);
  IF NOT COALESCE(v_achou, false) THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  -- IS DISTINCT FROM e não <>: com NULL dos dois lados (contas globais), o
  -- operador comum devolveria NULL e o IF não barraria nada.
  IF v_orig_filial IS DISTINCT FROM v_dest_filial THEN
    RAISE EXCEPTION 'Transferência só entre contas da mesma unidade. Origem é de %, destino é de %. Entre unidades, use aporte ou empréstimo.',
      COALESCE(v_orig_filial, 'uso global'), COALESCE(v_dest_filial, 'uso global')
      USING ERRCODE = 'P0001';
  END IF;

  -- COALESCE em todo guard, e aqui não é zelo abstrato: `auth_gerente_da`
  -- é `role = 'gerente' AND auth_user_filial() = p_filial`, então com
  -- p_filial NULL — que é o caso das contas globais — um gerente recebe
  -- `true AND NULL` = NULL. Sem o COALESCE, `IF NOT (false OR false OR NULL)`
  -- vira `IF NULL`, que não dispara: o guard seria pulado e a permissão
  -- concedida por omissão. A turma Adm tem exatamente 3 contas nesse estado.
  IF v_orig_filial IS NOT NULL
     AND NOT COALESCE(public.auth_pode_filial(v_orig_filial), false) THEN
    RAISE EXCEPTION 'Contas de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_is_admin(), false)
          OR COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(v_orig_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da unidade movem dinheiro entre contas.'
      USING ERRCODE = '42501';
  END IF;

  IF v_orig_filial IS NOT NULL
     AND NOT COALESCE(public.auth_is_admin(), false) AND EXISTS (
       SELECT 1 FROM public.filial_caixa_config fc
        WHERE fc.filial = v_orig_filial AND fc.bloqueado = true
     ) THEN
    RAISE EXCEPTION 'O caixa de % está bloqueado pela Matriz.', v_orig_filial
      USING ERRCODE = '42501';
  END IF;

  IF v_orig_saldo < p_valor THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e a transferência é de R$ %.',
      v_orig_nome, round(v_orig_saldo, 2), round(p_valor, 2)
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.caixa_bancos SET saldo = COALESCE(saldo, 0) - p_valor WHERE id = p_origem_id;
  UPDATE public.caixa_bancos SET saldo = COALESCE(saldo, 0) + p_valor WHERE id = p_destino_id;

  RETURN jsonb_build_object(
    'origem',  v_orig_nome,
    'destino', v_dest_nome,
    'valor',   round(p_valor, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transferir_entre_contas(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferir_entre_contas(uuid, uuid, numeric) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
