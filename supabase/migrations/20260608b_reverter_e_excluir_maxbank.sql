-- =================================================================
-- MaxBank — Reversão administrativa (folha + lançamentos individuais)
-- =================================================================
-- Caso de uso (testes em ambiente educacional):
--   • RH/admin cancela uma folha de pagamento que já foi Paga →
--     precisa estornar o crédito que rodou na carteira do colaborador
--     e inativar a Conta a Pagar derivada.
--   • Admin precisa apagar um lançamento avulso do MaxBank (qualquer
--     origem: folha, meta, transferencia_envio/recebimento, pdv_beneficios)
--     ajustando o saldo da carteira correspondente.
--
-- Duas RPCs SECURITY DEFINER:
--   1. reverter_folha_maxbank(p_folha_id)
--        Pra cada maxbank_transacoes vinculada a essa folha, devolve o
--        saldo (GREATEST 0 — se o colaborador já gastou parte, perde a
--        diferença) e apaga o lançamento. Inativa a conta_pagar que tem
--        marcador [folha:<uuid>] na descrição. Idempotente — chamar 2x
--        é seguro (na segunda não acha mais transações pra reverter).
--   2. excluir_transacao_maxbank(p_transacao_id)
--        Apaga um lançamento individual ajustando o saldo. Genérica —
--        serve pra qualquer origem. Usada pelo módulo admin de carteiras.
--
-- Segurança: ambas exigem role IN ('admin','CEO','rh') OU setor 'rh' (ou
-- setores_extras contendo 'rh'). Sem isso, RAISE EXCEPTION com mensagem
-- amigável.
--
-- O CHECK (saldo_* >= 0) das colunas de maxbank_contas força GREATEST(0,
-- saldo - valor) — se a reversão deixaria negativo, ficamos em 0 e
-- registramos no JSONB de retorno. Em produção isso seria um erro mas
-- aqui é didático.
--
-- IDEMPOTENTE: rodar nas 4 instâncias com colaboradores (ERP,
-- Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS-PDV (sem carteiras).
-- =================================================================

BEGIN;

-- =================================================================
-- Helper interno: confere se auth.uid() pode reverter/excluir.
-- =================================================================
CREATE OR REPLACE FUNCTION public._maxbank_pode_reverter()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role           text;
  v_setor          text;
  v_setores_extras text[];
BEGIN
  SELECT role, setor, COALESCE(setores_extras, ARRAY[]::text[])
    INTO v_role, v_setor, v_setores_extras
    FROM user_profiles
   WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_role IN ('admin', 'CEO') THEN
    RETURN true;
  END IF;

  IF v_setor = 'rh' OR 'rh' = ANY(v_setores_extras) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._maxbank_pode_reverter() FROM public;

-- =================================================================
-- 1. excluir_transacao_maxbank(p_transacao_id)
-- =================================================================
-- Apaga um lançamento avulso e devolve o saldo. Retorna JSONB com
-- {tipo, carteira, valor, saldo_apos, perda_por_saldo_insuficiente}.
-- perda_por_saldo_insuficiente > 0 indica que parte do crédito já tinha
-- sido gasto e foi "perdida" na reversão (testes só).
-- =================================================================
CREATE OR REPLACE FUNCTION public.excluir_transacao_maxbank(p_transacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo       text;
  v_carteira   text;
  v_valor      numeric(15,2);
  v_conta_id   uuid;
  v_saldo_antes numeric(15,2);
  v_saldo_novo  numeric(15,2);
  v_delta       numeric(15,2);
  v_perda       numeric(15,2) := 0;
BEGIN
  IF NOT public._maxbank_pode_reverter() THEN
    RAISE EXCEPTION 'Apenas admin, CEO ou RH podem reverter lançamentos do MaxBank.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT tipo, carteira, valor, conta_id
    INTO v_tipo, v_carteira, v_valor, v_conta_id
    FROM maxbank_transacoes
   WHERE id = p_transacao_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento % não encontrado.', p_transacao_id
      USING ERRCODE = 'P0002';
  END IF;

  -- delta = +valor para débito (devolve), -valor para crédito (retira).
  v_delta := CASE WHEN v_tipo = 'debito' THEN v_valor ELSE -v_valor END;

  -- Lê saldo atual da carteira certa.
  EXECUTE format(
    'SELECT saldo_%I FROM maxbank_contas WHERE id = $1 FOR UPDATE',
    v_carteira
  )
  INTO v_saldo_antes
  USING v_conta_id;

  v_saldo_novo := v_saldo_antes + v_delta;
  IF v_saldo_novo < 0 THEN
    v_perda := -v_saldo_novo;
    v_saldo_novo := 0;
  END IF;

  EXECUTE format(
    'UPDATE maxbank_contas SET saldo_%I = $1 WHERE id = $2',
    v_carteira
  )
  USING v_saldo_novo, v_conta_id;

  DELETE FROM maxbank_transacoes WHERE id = p_transacao_id;

  RETURN jsonb_build_object(
    'tipo',                          v_tipo,
    'carteira',                      v_carteira,
    'valor',                         v_valor,
    'saldo_apos',                    v_saldo_novo,
    'perda_por_saldo_insuficiente',  v_perda
  );
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_transacao_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.excluir_transacao_maxbank(uuid) TO authenticated;

-- =================================================================
-- 2. reverter_folha_maxbank(p_folha_id)
-- =================================================================
-- Itera nas transacoes derivadas da folha e chama a reversão individual.
-- Inativa conta_pagar marcada com [folha:<uuid>] na descrição (idem
-- padrão usado por handleStatusCycle em FolhaPagamentoView.tsx).
-- Retorna JSONB com {transacoes_revertidas, contas_pagar_inativadas,
-- perda_total_por_saldo_insuficiente}.
-- =================================================================
CREATE OR REPLACE FUNCTION public.reverter_folha_maxbank(p_folha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx           record;
  v_revertidas   integer := 0;
  v_contas       integer := 0;
  v_perda_total  numeric(15,2) := 0;
  v_res          jsonb;
BEGIN
  IF NOT public._maxbank_pode_reverter() THEN
    RAISE EXCEPTION 'Apenas admin, CEO ou RH podem reverter folha no MaxBank.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR v_tx IN
    SELECT id
      FROM maxbank_transacoes
     WHERE origem = 'folha_pagamento'
       AND origem_id = p_folha_id
  LOOP
    v_res := public.excluir_transacao_maxbank(v_tx.id);
    v_revertidas := v_revertidas + 1;
    v_perda_total := v_perda_total + COALESCE((v_res->>'perda_por_saldo_insuficiente')::numeric, 0);
  END LOOP;

  -- Inativa contas_pagar derivadas (marcador [folha:<uuid>]).
  WITH inativadas AS (
    UPDATE contas_pagar
       SET ativo = false
     WHERE descricao LIKE '%[folha:' || p_folha_id::text || ']%'
       AND COALESCE(ativo, true) = true
     RETURNING 1
  )
  SELECT count(*) INTO v_contas FROM inativadas;

  RETURN jsonb_build_object(
    'transacoes_revertidas',                v_revertidas,
    'contas_pagar_inativadas',              v_contas,
    'perda_total_por_saldo_insuficiente',   v_perda_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverter_folha_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reverter_folha_maxbank(uuid) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
-- =================================================================
--   -- Smoke: rever uma folha já paga e zerar carteira.
--   SELECT reverter_folha_maxbank('<folha_id>');
--   -- Esperado: {transacoes_revertidas:1 ou 2, contas_pagar_inativadas:1,
--   --            perda_total_por_saldo_insuficiente:0}
--
--   -- Apagar lançamento solto:
--   SELECT excluir_transacao_maxbank('<transacao_id>');
-- =================================================================
