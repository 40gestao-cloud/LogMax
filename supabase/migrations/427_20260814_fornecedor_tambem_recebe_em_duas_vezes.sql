-- 427_20260814_fornecedor_tambem_recebe_em_duas_vezes.sql
--
-- A migr. 422 deu baixa parcial a Contas a RECEBER e deixou Contas a PAGAR
-- tudo-ou-nada. A necessidade é a mesma e mais comum ainda: negociar com o
-- fornecedor "metade agora, metade no dia 30" é rotina, e o sistema obrigava a
-- fingir que a conta foi paga inteira ou que não foi paga nada.
--
-- O desenho é o espelho do que já está de pé no lado de receber. O que NÃO é
-- espelho — e é o que essa migração precisa acertar — são as cinco travas que
-- moram no `status = 'Pago'` de `contas_pagar` e que o lado de receber não tem.
--
-- ────────────────────────────────────────────────────────────────────────────
-- AS CINCO TRAVAS, UMA A UMA
--
-- 1. `conta_pagar_exige_recebimento` — impede pagar pedido cuja mercadoria não
--    foi conferida. **Passa a valer para a baixa parcial**: adiantar metade a
--    um fornecedor que não entregou é exatamente o que a trava existe para
--    impedir, e sem esta mudança 'Parcial' passaria por baixo dela.
--
-- 2. `bloqueia_conta_pagar_estourado` — capital da filial estourado não paga
--    despesa nova. Mesma lógica: a trava está no `WHEN` do gatilho, que só
--    olhava 'Pago'. O gatilho é recriado incluindo 'Parcial'.
--
-- 3. `sync_saldo_caixa_pagar` — debita o banco. Ganha 'Parcial', como o lado
--    de receber ganhou; a comparação antes/depois já existente faz cada baixa
--    debitar só a diferença.
--
-- 4. `conta_pagar_avancar_folha_e_creditar` e
-- 5. `conta_pagar_avancar_rescisao` — creditam a carteira do MaxBank do
--    funcionário. Estas **não** mudam, e é deliberado: o crédito só acontece
--    na QUITAÇÃO. O `WHEN` delas é `new.status = 'Pago' AND old.status <>
--    'Pago'`, então Pendente→Parcial não dispara e Parcial→Pago dispara uma
--    vez só. Meio salário pago não pode virar salário inteiro na carteira.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MESMA SIMPLIFICAÇÃO DECLARADA DA 422
--
-- A baixa parcial abate só o principal; juros e multa entram na quitação,
-- sobre o saldo que restou.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O status do meio do caminho
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.contas_pagar DROP CONSTRAINT IF EXISTS chk_contas_pagar_status;
ALTER TABLE public.contas_pagar
  ADD CONSTRAINT chk_contas_pagar_status
  CHECK (status IN ('Pendente', 'Parcial', 'Pago', 'Atrasado', 'Cancelado'))
  NOT VALID;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Uma linha por pagamento
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contas_pagar_baixas (
  id         uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  conta_id   uuid NOT NULL REFERENCES public.contas_pagar(id) ON DELETE CASCADE,
  principal  numeric(15,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  juros      numeric(15,2) NOT NULL DEFAULT 0 CHECK (juros     >= 0),
  multa      numeric(15,2) NOT NULL DEFAULT 0 CHECK (multa     >= 0),
  total      numeric(15,2) GENERATED ALWAYS AS (principal + juros + multa) STORED,
  banco_id   uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  data       date NOT NULL DEFAULT public.acre_today(),
  filial     text NOT NULL DEFAULT 'Matriz',
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contas_pagar_baixas_valor_positivo CHECK (principal + juros + multa > 0)
);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_baixas_conta
  ON public.contas_pagar_baixas (conta_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_baixas_created_at
  ON public.contas_pagar_baixas (created_at DESC);

COMMENT ON TABLE public.contas_pagar_baixas IS
  'Pagamentos parciais e quitação de contas a pagar. Append-only: escrita só pela RPC baixar_conta_pagar.';

ALTER TABLE public.contas_pagar_baixas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpb_select ON public.contas_pagar_baixas;
CREATE POLICY cpb_select ON public.contas_pagar_baixas
  FOR SELECT TO authenticated
  USING (public.auth_pode_filial(filial));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. O banco enxerga o pagamento parcial
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_pagar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_novo_ok  boolean := false;
  v_ant_ok   boolean := false;
  v_novo_val numeric(15,2) := 0;
  v_ant_val  numeric(15,2) := 0;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_novo_ok  := (NEW).status IN ('Pago', 'Parcial') AND COALESCE((NEW).ativo, true)
              AND (NEW).banco_id IS NOT NULL;
    v_novo_val := COALESCE((NEW).valor_pago, (NEW).valor);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_ant_ok  := (OLD).status IN ('Pago', 'Parcial') AND COALESCE((OLD).ativo, true)
             AND (OLD).banco_id IS NOT NULL;
    v_ant_val := COALESCE((OLD).valor_pago, (OLD).valor);
  END IF;

  IF v_ant_ok AND (
       NOT v_novo_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + v_ant_val
     WHERE id = (OLD).banco_id;
  END IF;

  IF v_novo_ok AND (
       NOT v_ant_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - v_novo_val
     WHERE id = (NEW).banco_id;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Adiantar dinheiro a fornecedor que não entregou continua barrado
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.conta_pagar_exige_recebimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Confere na PRIMEIRA saída de dinheiro, seja ela parcial ou total. Da
  -- segunda em diante não repete: a conferência já foi feita, e repetir
  -- travaria a quitação de uma conta que começou a ser paga legitimamente.
  IF NEW.status NOT IN ('Pago', 'Parcial')
     OR OLD.status IN ('Pago', 'Parcial')
     OR NEW.pedido_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.recebimentos r
     WHERE r.pedido_id = NEW.pedido_id
       AND COALESCE(r.ativo, true)
       AND r.status = 'Concluído'
  ) THEN
    RAISE EXCEPTION 'Esta conta é de um pedido de compra e a mercadoria ainda não foi conferida no Estoque. Registre o recebimento antes de pagar.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Capital estourado também barra a baixa parcial
--
-- A regra está no WHEN do gatilho, não na função — por isso o gatilho é
-- recriado. Sem isto, filial com capital estourado pagaria em fatias o que não
-- pode pagar de uma vez.
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_contas_pagar_bloqueio_pagar ON public.contas_pagar;
CREATE TRIGGER trg_contas_pagar_bloqueio_pagar
  BEFORE UPDATE OF status ON public.contas_pagar
  FOR EACH ROW
  WHEN (NEW.status IN ('Pago', 'Parcial') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.bloqueia_conta_pagar_estourado();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Juros correm sobre o saldo dos dois lados
--
-- Corpo copiado do banco (versão da migr. 422); a mudança é o desconto do
-- principal já pago também no lado 'pagar'.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_valor_atualizado(p_tipo text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg         public.financeiro_config;
  v_valor       numeric(15,2);
  v_venc        date;
  v_status      text;
  v_quitado     numeric(15,2) := 0;
  v_hoje        date := public.acre_today();
  v_dias_atraso integer;
  v_multa       numeric(15,2) := 0;
  v_juros       numeric(15,2) := 0;
  v_total       numeric(15,2);
BEGIN
  PERFORM public._assert_rpc();
  SELECT * INTO v_cfg FROM public.financeiro_config WHERE id = 1;

  IF p_tipo = 'receber' THEN
    SELECT valor, vencimento, status INTO v_valor, v_venc, v_status
      FROM public.contas_receber WHERE id = p_id;

    SELECT COALESCE(SUM(principal), 0) INTO v_quitado
      FROM public.contas_receber_baixas WHERE conta_id = p_id;

    v_valor := ROUND(GREATEST(COALESCE(v_valor, 0) - v_quitado, 0), 2);
  ELSIF p_tipo = 'pagar' THEN
    SELECT valor, vencimento, status INTO v_valor, v_venc, v_status
      FROM public.contas_pagar WHERE id = p_id;

    SELECT COALESCE(SUM(principal), 0) INTO v_quitado
      FROM public.contas_pagar_baixas WHERE conta_id = p_id;

    v_valor := ROUND(GREATEST(COALESCE(v_valor, 0) - v_quitado, 0), 2);
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF v_valor IS NULL THEN
    RETURN jsonb_build_object('erro', 'Conta não encontrada');
  END IF;

  IF v_status = 'Pago' OR NOT COALESCE(v_cfg.ativo, false) OR v_venc IS NULL THEN
    RETURN jsonb_build_object(
      'valor_original', v_valor,
      'dias_atraso',    0,
      'multa',          0,
      'juros',          0,
      'total',          v_valor,
      'vencido',        false
    );
  END IF;

  v_dias_atraso := GREATEST(0, v_hoje - v_venc);

  IF v_dias_atraso <= v_cfg.carencia_dias THEN
    RETURN jsonb_build_object(
      'valor_original', v_valor,
      'dias_atraso',    v_dias_atraso,
      'multa',          0,
      'juros',          0,
      'total',          v_valor,
      'vencido',        v_dias_atraso > 0
    );
  END IF;

  v_multa := ROUND(v_valor * v_cfg.multa_pct / 100.0, 2);
  v_juros := ROUND(v_valor * v_cfg.juros_dia_pct / 100.0 * (v_dias_atraso - v_cfg.carencia_dias), 2);
  v_total := v_valor + v_multa + v_juros;

  RETURN jsonb_build_object(
    'valor_original', v_valor,
    'dias_atraso',    v_dias_atraso,
    'multa',          v_multa,
    'juros',          v_juros,
    'total',          v_total,
    'vencido',        true
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. A baixa
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.baixar_conta_pagar(
  p_conta_id uuid,
  p_banco_id uuid,
  p_valor    numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta        contas_pagar;
  v_banco_filial text;
  v_banco_ok     boolean;
  v_calc         jsonb;
  v_saldo        numeric(15,2);
  v_juros        numeric(15,2);
  v_multa        numeric(15,2);
  v_devido       numeric(15,2);
  v_principal    numeric(15,2);
  v_quita        boolean;
  v_pago_total   numeric(15,2);
BEGIN
  PERFORM public._assert_rpc();

  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária de origem.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'O valor pago precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_conta
    FROM public.contas_pagar
   WHERE id = p_conta_id AND COALESCE(ativo, true)
     FOR UPDATE;

  IF v_conta.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Pago' THEN
    RAISE EXCEPTION 'Esta conta já está quitada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Conta cancelada não recebe baixa.' USING ERRCODE = 'P0001';
  END IF;

  IF v_conta.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_conta.filial), false) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.auth_in_setor('financeiro') OR public.auth_gerente_da(v_conta.filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial registram baixa de conta.'
      USING ERRCODE = '42501';
  END IF;

  SELECT filial, true INTO v_banco_filial, v_banco_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true);

  IF NOT COALESCE(v_banco_ok, false) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_banco_filial IS NOT NULL
     AND v_banco_filial IS DISTINCT FROM COALESCE(v_conta.filial, 'Matriz') THEN
    RAISE EXCEPTION 'A origem escolhida é caixa/banco de % e esta conta é de %. Use uma conta da própria unidade.',
      v_banco_filial, COALESCE(v_conta.filial, 'Matriz') USING ERRCODE = 'P0001';
  END IF;

  v_calc   := public.calcular_valor_atualizado('pagar', p_conta_id);
  v_saldo  := COALESCE((v_calc->>'valor_original')::numeric, 0);
  v_juros  := COALESCE((v_calc->>'juros')::numeric, 0);
  v_multa  := COALESCE((v_calc->>'multa')::numeric, 0);
  v_devido := COALESCE((v_calc->>'total')::numeric, 0);

  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Esta conta não tem saldo em aberto.' USING ERRCODE = 'P0001';
  END IF;

  IF p_valor > v_devido + 0.005 THEN
    RAISE EXCEPTION 'Pago (R$ %) é maior que o devido (R$ %). Para quitar, informe o valor exato.',
      to_char(p_valor,  'FM999G999G990D00'),
      to_char(v_devido, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  v_quita := p_valor >= v_devido - 0.005;

  IF v_quita THEN
    v_principal := v_saldo;
  ELSE
    v_principal := ROUND(p_valor, 2);
    v_juros     := 0;
    v_multa     := 0;
  END IF;

  INSERT INTO public.contas_pagar_baixas
    (conta_id, principal, juros, multa, banco_id, filial, criado_por)
  VALUES
    (p_conta_id, v_principal, v_juros, v_multa, p_banco_id,
     COALESCE(v_conta.filial, 'Matriz'), auth.uid());

  SELECT COALESCE(SUM(total), 0) INTO v_pago_total
    FROM public.contas_pagar_baixas WHERE conta_id = p_conta_id;

  -- O UPDATE abaixo é o que aciona as travas: conferência de recebimento,
  -- capital da filial e — só na quitação — o crédito de folha/rescisão.
  UPDATE public.contas_pagar
     SET status     = CASE WHEN v_quita THEN 'Pago' ELSE 'Parcial' END,
         banco_id   = p_banco_id,
         valor_pago = v_pago_total,
         juros_pago = COALESCE(juros_pago, 0) + v_juros,
         multa_pago = COALESCE(multa_pago, 0) + v_multa,
         pago_em    = CASE WHEN v_quita THEN public.acre_today() ELSE pago_em END,
         updated_at = now()
   WHERE id = p_conta_id;

  RETURN jsonb_build_object(
    'quitada',        v_quita,
    'principal',      v_principal,
    'juros',          v_juros,
    'multa',          v_multa,
    'pago_agora',     ROUND(v_principal + v_juros + v_multa, 2),
    'pago_total',     v_pago_total,
    'saldo_restante', ROUND(GREATEST(v_saldo - v_principal, 0), 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.baixar_conta_pagar(uuid, uuid, numeric) FROM public;
REVOKE ALL ON FUNCTION public.baixar_conta_pagar(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.baixar_conta_pagar(uuid, uuid, numeric) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. O caminho antigo não atropela o novo (dos dois lados agora)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_pagamento_conta(p_tipo text, p_conta_id uuid, p_banco_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_calc         jsonb;
  v_total        numeric(15,2);
  v_juros        numeric(15,2);
  v_multa        numeric(15,2);
  v_status       text;
  v_filial       text;
  v_banco_filial text;
  v_banco_ok     boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF p_tipo NOT IN ('pagar', 'receber') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;
  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'pagar' THEN
    SELECT status, filial INTO v_status, v_filial
      FROM public.contas_pagar WHERE id = p_conta_id AND COALESCE(ativo, true) FOR UPDATE;

    -- Conta com baixa parcial pertence à baixar_conta_pagar (migr. 427).
    IF EXISTS (SELECT 1 FROM public.contas_pagar_baixas WHERE conta_id = p_conta_id) THEN
      RAISE EXCEPTION 'Esta conta já tem pagamento parcial registrado. Use a baixa em Contas a Pagar para informar o valor.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT status, filial INTO v_status, v_filial
      FROM public.contas_receber WHERE id = p_conta_id AND COALESCE(ativo, true) FOR UPDATE;

    IF EXISTS (SELECT 1 FROM public.contas_receber_baixas WHERE conta_id = p_conta_id) THEN
      RAISE EXCEPTION 'Esta conta já tem recebimento parcial registrado. Use a baixa em Contas a Receber para informar o valor.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IN ('Pago', 'Recebido') THEN
    RAISE EXCEPTION 'Esta conta já está quitada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_filial IS NOT NULL AND NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.auth_in_setor('financeiro')
          OR public.auth_gerente_da(v_filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial registram baixa de conta.'
      USING ERRCODE = '42501';
  END IF;

  SELECT filial, true INTO v_banco_filial, v_banco_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true);

  IF NOT COALESCE(v_banco_ok, false) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_banco_filial IS NOT NULL
     AND v_banco_filial IS DISTINCT FROM COALESCE(v_filial, 'Matriz') THEN
    RAISE EXCEPTION 'A origem escolhida é caixa/banco de % e esta conta é de %. Use uma conta da própria unidade.',
      v_banco_filial, COALESCE(v_filial, 'Matriz') USING ERRCODE = 'P0001';
  END IF;

  v_calc  := public.calcular_valor_atualizado(p_tipo, p_conta_id);
  v_total := (v_calc->>'total')::numeric;
  v_juros := COALESCE((v_calc->>'juros')::numeric, 0);
  v_multa := COALESCE((v_calc->>'multa')::numeric, 0);

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Valor da conta inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'pagar' THEN
    UPDATE public.contas_pagar
       SET status = 'Pago', banco_id = p_banco_id,
           valor_pago = v_total, juros_pago = v_juros, multa_pago = v_multa,
           pago_em = public.acre_today()
     WHERE id = p_conta_id;
  ELSE
    UPDATE public.contas_receber
       SET status = 'Pago', banco_id = p_banco_id,
           valor_pago = v_total, juros_pago = v_juros, multa_pago = v_multa,
           pago_em = public.acre_today()
     WHERE id = p_conta_id;
  END IF;

  RETURN v_calc;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. O card "Total pendente" não pode perder a conta pela metade
--
-- `total_pendente_contas_pagar` soma `valor` de quem está em 'Pendente'. Com o
-- status novo, a conta que recebeu uma baixa **sumiria do card** — e o card é
-- a primeira coisa que a turma olha. Passa a incluir 'Parcial' e a somar o
-- SALDO, não o valor do documento, senão contaria de novo o que já saiu.
--
-- Mesma armadilha da revisão da 426: status novo quebra a função antiga.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.total_pendente_contas_pagar(p_filial text DEFAULT NULL::text)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg   public.financeiro_config%ROWTYPE;
  v_hoje  date := public.acre_today();
  v_total numeric(15,2) := 0;
BEGIN
  IF NOT (auth_is_admin() OR auth_in_setor('financeiro')) THEN
    RAISE EXCEPTION 'Acesso negado — apenas Admin, CEO ou Financeiro.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM public.financeiro_config WHERE id = 1;

  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(v_cfg.ativo, false)
           AND cp.vencimento IS NOT NULL
           AND (v_hoje - cp.vencimento) > COALESCE(v_cfg.carencia_dias, 0)
        THEN saldo.v
             + ROUND(saldo.v * COALESCE(v_cfg.multa_pct, 0) / 100.0, 2)
             + ROUND(saldo.v * COALESCE(v_cfg.juros_dia_pct, 0) / 100.0
                     * ((v_hoje - cp.vencimento) - COALESCE(v_cfg.carencia_dias, 0)), 2)
      ELSE saldo.v
    END
  ), 0)
  INTO v_total
  FROM public.contas_pagar cp
  CROSS JOIN LATERAL (
    SELECT GREATEST(cp.valor - COALESCE((
             SELECT SUM(b.principal) FROM public.contas_pagar_baixas b
              WHERE b.conta_id = cp.id
           ), 0), 0) AS v
  ) saldo
  WHERE cp.status IN ('Pendente', 'Parcial')
    AND COALESCE(cp.ativo, true)
    AND (p_filial IS NULL OR cp.filial = p_filial);

  RETURN v_total;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Cancelar pedido não pode "desfazer" um pagamento que já saiu
--
-- `cancelar_pedido_compra` recusa cancelar quando existe conta **'Pago'** e
-- inativa as demais. Com o status novo, uma conta 'Parcial' passaria pelas duas
-- portas: o guard não a veria, e o `ativo = false` faria o trigger de saldo
-- devolver ao banco um dinheiro que o fornecedor já recebeu.
--
-- Corpo copiado do banco; muda só a régua dos dois pontos.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancelar_pedido_compra(p_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ped    public.pedidos;
  v_pagas  integer;
  v_contas integer;
  v_receb  integer;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.auth_pode_filial(v_ped.filial) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_ped.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Este pedido ja esta cancelado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_receb FROM public.recebimentos r
   WHERE r.pedido_id = v_ped.id AND COALESCE(r.ativo, true) AND r.status <> 'Pendente';
  IF v_receb > 0 THEN
    RAISE EXCEPTION
      'Este pedido ja teve recebimento confirmado - a mercadoria entrou no estoque. Registre uma devolucao ao fornecedor em vez de cancelar.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 'Parcial' conta como dinheiro que já saiu (migr. 427).
  SELECT count(*) INTO v_pagas FROM public.contas_pagar c
   WHERE c.pedido_id = v_ped.id AND COALESCE(c.ativo, true) AND c.status IN ('Pago', 'Parcial');
  IF v_pagas > 0 THEN
    RAISE EXCEPTION
      'Existe conta a pagar ja quitada ou com pagamento parcial para este pedido. Estorne o pagamento antes de cancelar.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pedidos SET status = 'Cancelado' WHERE id = v_ped.id;

  UPDATE public.contas_pagar
     SET ativo = false
   WHERE pedido_id = v_ped.id AND COALESCE(ativo, true) AND status NOT IN ('Pago', 'Parcial');
  GET DIAGNOSTICS v_contas = ROW_COUNT;

  -- A requisicao volta a poder ser cotada. Sem isto ela fica 'Atendida' por um
  -- pedido cancelado: fora do dropdown de nova cotacao e impossivel de refazer.
  IF v_ped.requisicao_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pedidos p
                      WHERE p.requisicao_id = v_ped.requisicao_id
                        AND p.id <> v_ped.id AND COALESCE(p.ativo, true)
                        AND p.status <> 'Cancelado') THEN
    UPDATE public.requisicoes SET status = 'Aprovado'
     WHERE id = v_ped.requisicao_id AND status = 'Atendida';
  END IF;

  RETURN jsonb_build_object('ok', true, 'contas_inativadas', v_contas, 'motivo', p_motivo);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. A devolução ao fornecedor abate também a conta parcialmente paga
--
-- `registrar_devolucao_fornecedor` (migr. 423) procura a conta do pedido com
-- `status = 'Pendente'` para abater o valor devolvido. Uma conta que já teve
-- baixa cairia no ramo "já paga" e o abatimento não aconteceria.
--
-- O ajuste é feito sobre o texto da própria função (mesma técnica que a migr.
-- 260 usou para injetar `_assert_rpc`), e **falha alto** se algum dos dois
-- trechos não casar: substituição que não encontra o alvo vira no-op silencioso,
-- que é o pior desfecho possível numa migração de dinheiro.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_src text;
  v_alvo_status text := 'AND COALESCE(ativo, true) AND status = ''Pendente''';
  v_alvo_piso   text := 'v_conta_novo := ROUND(GREATEST(v_conta.valor - v_valor, 0), 2);';
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'registrar_devolucao_fornecedor';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'registrar_devolucao_fornecedor não existe — aplique a migração 423 antes desta.';
  END IF;

  -- Já ajustada (reexecução): sai sem fazer nada.
  IF position('''Pendente'', ''Parcial''' IN v_src) > 0 THEN
    RETURN;
  END IF;

  IF position(v_alvo_status IN v_src) = 0 OR position(v_alvo_piso IN v_src) = 0 THEN
    RAISE EXCEPTION
      'O corpo de registrar_devolucao_fornecedor não bate com o esperado da migr. 423 — ajuste manual necessário, não vou deixar passar em silêncio.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := replace(v_src, v_alvo_status,
    'AND COALESCE(ativo, true) AND status IN (''Pendente'', ''Parcial'')');

  -- O piso do abatimento deixa de ser zero e passa a ser o que já foi pago:
  -- reduzir abaixo disso faria a conta dever menos do que já saiu do caixa.
  v_src := replace(v_src, v_alvo_piso,
    'v_conta_novo := ROUND(GREATEST(v_conta.valor - v_valor, COALESCE(v_conta.valor_pago, 0)), 2);');

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.registrar_devolucao_fornecedor('
    || 'p_recebimento_id uuid, p_qtd integer, p_motivo text, '
    || 'p_reenvio_esperado boolean DEFAULT true, p_observacao text DEFAULT NULL) '
    || 'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_src);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. O capital da filial precisa ver o dinheiro que saiu pela metade
--
-- `calcular_saldo_capital` soma `contas_pagar.valor` de quem está **'Pago'**
-- para apurar despesa consumida. Uma conta 'Parcial' não entraria: o dinheiro
-- sai do banco e o capital da filial continua achando que está inteiro — e é
-- esse mesmo cálculo que alimenta a trava de capital estourado (item 5 acima).
-- A filial poderia furar o teto pagando tudo em fatias.
--
-- A conta 'Pago' continua entrando pelo `valor` (comportamento de hoje, não
-- mexo nele); 'Parcial' entra pelo que efetivamente saiu — `valor_pago` —, que
-- na baixa parcial é só principal.
--
-- Mesma técnica de cirurgia verificada do item 11, com os dois trechos
-- conferidos antes de trocar.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_src  text;
  v_args text;
  v_ret  text;
  v_alvo text := 'cp.status = ''Pago''';
  v_novo text := 'cp.status IN (''Pago'', ''Parcial'')';
  v_val  text := 'SUM(cp.valor)';
  v_val2 text := 'SUM(CASE WHEN cp.status = ''Pago'' THEN cp.valor ELSE COALESCE(cp.valor_pago, 0) END)';
BEGIN
  SELECT p.prosrc,
         pg_get_function_identity_arguments(p.oid),
         pg_get_function_result(p.oid)
    INTO v_src, v_args, v_ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calcular_saldo_capital';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'calcular_saldo_capital não existe neste banco.' USING ERRCODE = 'P0001';
  END IF;

  IF position(v_novo IN v_src) > 0 THEN
    RETURN;  -- já ajustada
  END IF;

  IF position(v_alvo IN v_src) = 0 OR position(v_val IN v_src) = 0 THEN
    RAISE EXCEPTION
      'O corpo de calcular_saldo_capital não bate com o esperado — ajuste manual necessário, não vou deixar passar em silêncio.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ORDEM IMPORTA. O filtro do WHERE sai primeiro; só depois o SUM ganha o
  -- CASE. Invertido, o segundo replace acertaria também o `cp.status = 'Pago'`
  -- recém-criado DENTRO do CASE, e a conta parcial passaria a somar o valor
  -- cheio do documento — o oposto do que esta migração quer.
  v_src := replace(v_src, v_alvo, v_novo);
  v_src := replace(v_src, v_val,  v_val2);

  -- Sem `STABLE`: a função é VOLATILE no banco, e recriá-la como STABLE
  -- mudaria o plano de execução por engano.
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(%s) RETURNS %s '
    || 'LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_args, v_ret, v_src);
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
