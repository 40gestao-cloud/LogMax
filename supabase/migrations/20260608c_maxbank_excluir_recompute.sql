-- =================================================================
-- MaxBank — Corrige excluir_transacao_maxbank (recompute em vez de delta)
-- =================================================================
-- Bug encontrado em 2026-06-06:
--   1. Folha credita R$ 800 em saldo_beneficios.
--   2. Colaborador gasta R$ 28,60 no PDV → saldo = 771,40.
--   3. Admin apaga o crédito de R$ 800: 771,40 - 800 = -28,60. CHECK
--      força GREATEST(0, ...) → saldo = 0, perda = 28,60.
--   4. Admin apaga o débito de R$ 28,60: saldo = 0 + 28,60 = 28,60.
--   Resultado: R$ 28,60 "ressuscitados" sem corresponder a nenhum
--   crédito real. O delta-update tem dependência de ordem que a
--   restrição de não-negatividade quebra.
--
-- Fix: em vez de "saldo += delta_da_transacao_apagada", recomputamos
--      saldo = SUM(creditos) - SUM(debitos) das transações restantes
--      naquela carteira/conta após o DELETE. Idêntica matemática se
--      nunca houver cap, e correta quando houver.
--
-- Também: nova RPC recompute_saldos_maxbank(p_conta_id) — sanity tool
-- pra zerar drift histórico (do bug acima ou de qualquer cap antigo).
-- Recalcula as 3 carteiras de uma vez.
--
-- IDEMPOTENTE: rodar nas 4 instâncias com colaboradores (ERP,
-- Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS-PDV.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. excluir_transacao_maxbank — recompute em vez de delta
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
  v_saldo_calc numeric(15,2);
  v_saldo_novo numeric(15,2);
  v_perda      numeric(15,2) := 0;
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

  -- Lock da conta pra evitar corrida com creditar_folha_maxbank ou
  -- debitar_maxbank_beneficios rodando em paralelo.
  PERFORM 1 FROM maxbank_contas WHERE id = v_conta_id FOR UPDATE;

  -- Apaga primeiro, depois recomputa o saldo a partir do que sobrou.
  -- Recompute > delta porque elimina dependência de ordem quando o cap
  -- em 0 entra em ação.
  DELETE FROM maxbank_transacoes WHERE id = p_transacao_id;

  SELECT COALESCE(SUM(CASE WHEN tipo = 'credito' THEN valor ELSE -valor END), 0)
    INTO v_saldo_calc
    FROM maxbank_transacoes
   WHERE conta_id = v_conta_id
     AND carteira = v_carteira;

  v_saldo_novo := v_saldo_calc;
  IF v_saldo_novo < 0 THEN
    v_perda      := -v_saldo_novo;
    v_saldo_novo := 0;
  END IF;

  EXECUTE format(
    'UPDATE maxbank_contas SET saldo_%I = $1 WHERE id = $2',
    v_carteira
  )
  USING v_saldo_novo, v_conta_id;

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
-- 2. recompute_saldos_maxbank — sanity tool
-- =================================================================
-- Recomputa as 3 carteiras de uma conta a partir das transações
-- existentes. Útil pra zerar drift histórico (test data antiga, bug
-- de delta-update já corrigido, etc). Retorna JSONB com saldos antes
-- e depois pra auditoria.
-- =================================================================
CREATE OR REPLACE FUNCTION public.recompute_saldos_maxbank(p_conta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_antes_sal   numeric(15,2);
  v_antes_ben   numeric(15,2);
  v_antes_bon   numeric(15,2);
  v_depois_sal  numeric(15,2);
  v_depois_ben  numeric(15,2);
  v_depois_bon  numeric(15,2);
BEGIN
  IF NOT public._maxbank_pode_reverter() THEN
    RAISE EXCEPTION 'Apenas admin, CEO ou RH podem recomputar saldos do MaxBank.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT saldo_salario, saldo_beneficios, saldo_bonificacoes
    INTO v_antes_sal, v_antes_ben, v_antes_bon
    FROM maxbank_contas
   WHERE id = p_conta_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta MaxBank % não encontrada.', p_conta_id
      USING ERRCODE = 'P0002';
  END IF;

  WITH soma AS (
    SELECT carteira,
           SUM(CASE WHEN tipo = 'credito' THEN valor ELSE -valor END) AS total
      FROM maxbank_transacoes
     WHERE conta_id = p_conta_id
     GROUP BY carteira
  )
  SELECT
    GREATEST(0, COALESCE((SELECT total FROM soma WHERE carteira = 'salario'),      0)),
    GREATEST(0, COALESCE((SELECT total FROM soma WHERE carteira = 'beneficios'),   0)),
    GREATEST(0, COALESCE((SELECT total FROM soma WHERE carteira = 'bonificacoes'), 0))
    INTO v_depois_sal, v_depois_ben, v_depois_bon;

  UPDATE maxbank_contas
     SET saldo_salario      = v_depois_sal,
         saldo_beneficios   = v_depois_ben,
         saldo_bonificacoes = v_depois_bon
   WHERE id = p_conta_id;

  RETURN jsonb_build_object(
    'antes',  jsonb_build_object('salario', v_antes_sal,  'beneficios', v_antes_ben,  'bonificacoes', v_antes_bon),
    'depois', jsonb_build_object('salario', v_depois_sal, 'beneficios', v_depois_ben, 'bonificacoes', v_depois_bon)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_saldos_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.recompute_saldos_maxbank(uuid) TO authenticated;

COMMIT;

-- =================================================================
-- LIMPEZA IMEDIATA do drift existente (R$ 28,60 órfão do colaborador)
-- =================================================================
-- Depois de rodar a migração, no mesmo SQL Editor:
--
--   SELECT recompute_saldos_maxbank(id)
--     FROM maxbank_contas;
--
-- Vai retornar antes/depois pra cada conta. Carteiras que não têm
-- transação correspondente vão zerar (e o R$ 28,60 some).
-- =================================================================
