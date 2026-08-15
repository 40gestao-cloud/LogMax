-- 422_20260814_cliente_que_paga_metade_agora_existe.sql
--
-- QUEM PAGA METADE NÃO TINHA COMO SER REGISTRADO.
--
-- Contas a Receber só sabia quitar: o botão "Receber" chamava
-- `registrar_pagamento_conta`, que gravava `status='Pago'` com o valor cheio.
-- Cliente que aparece com R$ 300 de uma dívida de R$ 1.000 deixava o aluno com
-- duas saídas, ambas erradas: dar a conta por paga (some R$ 700 a receber) ou
-- não registrar nada (o dinheiro entrou e o caixa não sabe).
--
-- É o caso mais comum de cobrança que existe, e desde a migr. 416 ficou mais
-- caro ainda: o limite de crédito do Fiado se apoia no saldo devedor, e um
-- saldo que só sabe "tudo ou nada" trava venda de quem já pagou parte.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O MODELO
--
-- `contas_receber_baixas`: uma linha por recebimento. O título continua com o
-- `valor` original — nota fiscal não encolhe porque o cliente pagou parte —, e
-- o quanto já entrou é a soma das baixas. Status novo `Parcial` para o meio do
-- caminho.
--
-- Três peças existentes precisaram acompanhar:
--
--   • `chk_contas_receber_status` não conhecia 'Parcial'.
--   • `sync_saldo_caixa_receber` (trigger que credita o banco) só reagia a
--     'Pago'/'Recebido' — sem incluir 'Parcial', o dinheiro da baixa entrava no
--     sistema e não aparecia no saldo. A função já trata mudança de valor
--     comparando o antes e o depois, então baixa após baixa credita a
--     diferença sozinha.
--   • `calcular_valor_atualizado` cobrava juros sobre o valor cheio. Depois de
--     receber R$ 300, juros têm de correr sobre os R$ 700 que sobraram — senão
--     pagar adiantado não reduz nada e a conta vira armadilha.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A SIMPLIFICAÇÃO, DECLARADA
--
-- Na vida real o pagamento parcial abate primeiro os encargos e só o que sobra
-- vai no principal. Aqui a baixa parcial abate **só o principal**, e juros e
-- multa são calculados e cobrados na quitação, sobre o saldo que restou.
--
-- Isso é uma escolha, não um esquecimento: a conta fica visível para o aluno
-- ("devia 1.000, paguei 300, faltam 700 + juros dos 700") em vez de exigir uma
-- decomposição que nem gerente experiente faz de cabeça. Quem for adiante com
-- o assunto muda a regra aqui dentro, num lugar só.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O status do meio do caminho
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.contas_receber DROP CONSTRAINT IF EXISTS chk_contas_receber_status;
ALTER TABLE public.contas_receber
  ADD CONSTRAINT chk_contas_receber_status
  CHECK (status IN ('Aberto', 'Parcial', 'Pago', 'Atrasado', 'Cancelado'))
  NOT VALID;  -- como era antes: não valida o histórico das 4 turmas

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Uma linha por recebimento
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contas_receber_baixas (
  id         uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  conta_id   uuid NOT NULL REFERENCES public.contas_receber(id) ON DELETE CASCADE,
  principal  numeric(15,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  juros      numeric(15,2) NOT NULL DEFAULT 0 CHECK (juros     >= 0),
  multa      numeric(15,2) NOT NULL DEFAULT 0 CHECK (multa     >= 0),
  total      numeric(15,2) GENERATED ALWAYS AS (principal + juros + multa) STORED,
  banco_id   uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  data       date NOT NULL DEFAULT public.acre_today(),
  filial     text NOT NULL DEFAULT 'Matriz',
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contas_receber_baixas_valor_positivo CHECK (principal + juros + multa > 0)
);

CREATE INDEX IF NOT EXISTS idx_contas_receber_baixas_conta
  ON public.contas_receber_baixas (conta_id);
CREATE INDEX IF NOT EXISTS idx_contas_receber_baixas_created_at
  ON public.contas_receber_baixas (created_at DESC);

COMMENT ON TABLE public.contas_receber_baixas IS
  'Recebimentos parciais e quitação de contas a receber. Append-only: escrita só pela RPC baixar_conta_receber.';

ALTER TABLE public.contas_receber_baixas ENABLE ROW LEVEL SECURITY;

-- Leitura pela régua de filial. Escrita não tem policy nenhuma de propósito:
-- quem grava é a RPC (SECURITY DEFINER), que confere setor, filial e valor.
-- Baixa que entra por fora é caixa que ninguém conferiu.
DROP POLICY IF EXISTS crb_select ON public.contas_receber_baixas;
CREATE POLICY crb_select ON public.contas_receber_baixas
  FOR SELECT TO authenticated
  USING (public.auth_pode_filial(filial));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. O banco passa a enxergar o recebimento parcial
--
-- Corpo copiado do banco; a única mudança são os dois IN, que ganharam
-- 'Parcial'. A comparação antes/depois que já existia faz o resto: na segunda
-- baixa a função estorna o valor antigo e credita o novo, então o saldo anda
-- pela diferença sem lançamento duplicado.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_saldo_caixa_receber()
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
    v_novo_ok  := (NEW).status IN ('Pago', 'Recebido', 'Parcial') AND COALESCE((NEW).ativo, true)
              AND (NEW).banco_id IS NOT NULL;
    v_novo_val := COALESCE((NEW).valor_pago, (NEW).valor);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_ant_ok  := (OLD).status IN ('Pago', 'Recebido', 'Parcial') AND COALESCE((OLD).ativo, true)
             AND (OLD).banco_id IS NOT NULL;
    v_ant_val := COALESCE((OLD).valor_pago, (OLD).valor);
  END IF;

  IF v_ant_ok AND (
       NOT v_novo_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - v_ant_val
     WHERE id = (OLD).banco_id;
  END IF;

  IF v_novo_ok AND (
       NOT v_ant_ok
       OR (OLD).banco_id IS DISTINCT FROM (NEW).banco_id
       OR v_ant_val IS DISTINCT FROM v_novo_val
     ) THEN
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + v_novo_val
     WHERE id = (NEW).banco_id;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Juros correm sobre o que sobrou, não sobre o valor cheio
--
-- Corpo copiado do banco. A mudança é o desconto do principal já recebido no
-- lado 'receber'. Em 'pagar' nada muda — lá não existe baixa parcial (ainda).
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
  v_recebido    numeric(15,2) := 0;
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

    -- Principal já recebido em baixas anteriores (migr. 422). O saldo é o que
    -- ainda se cobra, e é sobre ele que juros e multa correm.
    SELECT COALESCE(SUM(principal), 0) INTO v_recebido
      FROM public.contas_receber_baixas WHERE conta_id = p_id;

    v_valor := ROUND(GREATEST(COALESCE(v_valor, 0) - v_recebido, 0), 2);
  ELSIF p_tipo = 'pagar' THEN
    SELECT valor, vencimento, status INTO v_valor, v_venc, v_status
      FROM public.contas_pagar WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF v_valor IS NULL THEN
    RETURN jsonb_build_object('erro', 'Conta não encontrada');
  END IF;

  -- Já pago ou config desativada → não aplica juros.
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

  -- Dentro da carência → sem juros nem multa
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
-- 5. A baixa
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.baixar_conta_receber(
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
  v_conta        contas_receber;
  v_banco_filial text;
  v_banco_ok     boolean;
  v_calc         jsonb;
  v_saldo        numeric(15,2);
  v_juros        numeric(15,2);
  v_multa        numeric(15,2);
  v_devido       numeric(15,2);
  v_principal    numeric(15,2);
  v_quita        boolean;
  v_recebido_ant numeric(15,2);
BEGIN
  PERFORM public._assert_rpc();

  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária de crédito.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'O valor recebido precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_conta
    FROM public.contas_receber
   WHERE id = p_conta_id AND COALESCE(ativo, true)
     FOR UPDATE;

  IF v_conta.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status IN ('Pago', 'Recebido') THEN
    RAISE EXCEPTION 'Esta conta já está quitada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Conta cancelada não recebe baixa.' USING ERRCODE = 'P0001';
  END IF;

  -- Mesma régua do resto do Financeiro: a filial da conta e quem opera nela.
  -- COALESCE porque auth_pode_filial devolve NULL para quem está sem filial, e
  -- NULL num IF não barra ninguém.
  IF v_conta.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_conta.filial), false) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.auth_in_setor('financeiro') OR public.auth_gerente_da(v_conta.filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial registram baixa de conta.'
      USING ERRCODE = '42501';
  END IF;

  -- O dinheiro tem de entrar numa conta da mesma unidade (migr. 325).
  SELECT filial, true INTO v_banco_filial, v_banco_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true);

  IF NOT COALESCE(v_banco_ok, false) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_banco_filial IS NOT NULL
     AND v_banco_filial IS DISTINCT FROM COALESCE(v_conta.filial, 'Matriz') THEN
    RAISE EXCEPTION 'O destino escolhido é caixa/banco de % e esta conta é de %. Use uma conta da própria unidade.',
      v_banco_filial, COALESCE(v_conta.filial, 'Matriz') USING ERRCODE = 'P0001';
  END IF;

  -- Saldo + encargos do momento. `calcular_valor_atualizado` já desconta o
  -- principal das baixas anteriores.
  v_calc   := public.calcular_valor_atualizado('receber', p_conta_id);
  v_saldo  := COALESCE((v_calc->>'valor_original')::numeric, 0);
  v_juros  := COALESCE((v_calc->>'juros')::numeric, 0);
  v_multa  := COALESCE((v_calc->>'multa')::numeric, 0);
  v_devido := COALESCE((v_calc->>'total')::numeric, 0);

  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Esta conta não tem saldo em aberto.' USING ERRCODE = 'P0001';
  END IF;

  -- Tolerância de meio centavo: o valor vem de máscara de moeda no front.
  IF p_valor > v_devido + 0.005 THEN
    RAISE EXCEPTION 'Recebido (R$ %) é maior que o devido (R$ %). Para quitar, informe o valor exato.',
      to_char(p_valor,  'FM999G999G990D00'),
      to_char(v_devido, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  v_quita := p_valor >= v_devido - 0.005;

  IF v_quita THEN
    -- Quitação: leva o saldo inteiro e os encargos acumulados.
    v_principal := v_saldo;
  ELSE
    -- Parcial: abate só principal. Ver a simplificação no cabeçalho.
    v_principal := ROUND(p_valor, 2);
    v_juros     := 0;
    v_multa     := 0;
  END IF;

  INSERT INTO public.contas_receber_baixas
    (conta_id, principal, juros, multa, banco_id, filial, criado_por)
  VALUES
    (p_conta_id, v_principal, v_juros, v_multa, p_banco_id,
     COALESCE(v_conta.filial, 'Matriz'), auth.uid());

  -- `valor_pago` acumula TUDO que entrou (principal + encargos) porque é ele
  -- que o trigger de saldo credita no banco.
  SELECT COALESCE(SUM(total), 0) INTO v_recebido_ant
    FROM public.contas_receber_baixas WHERE conta_id = p_conta_id;

  UPDATE public.contas_receber
     SET status     = CASE WHEN v_quita THEN 'Pago' ELSE 'Parcial' END,
         banco_id   = p_banco_id,
         valor_pago = v_recebido_ant,
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
    'recebido_agora', ROUND(v_principal + v_juros + v_multa, 2),
    'recebido_total', v_recebido_ant,
    'saldo_restante', ROUND(GREATEST(v_saldo - v_principal, 0), 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.baixar_conta_receber(uuid, uuid, numeric) FROM public;
REVOKE ALL ON FUNCTION public.baixar_conta_receber(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.baixar_conta_receber(uuid, uuid, numeric) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. O caminho antigo não pode atropelar o novo
--
-- `registrar_pagamento_conta` grava `valor_pago` de uma vez e ignora as baixas.
-- Chamado numa conta que já tem baixa parcial (F12, tela velha em cache), ele
-- apagaria o histórico e cobraria o valor cheio de novo. Passa a recusar — e
-- só nesse caso: conta sem baixa nenhuma segue funcionando como sempre, e o
-- lado 'pagar' não é tocado.
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
  -- Sem lista de setores: a régua real é verificada abaixo, depois de saber a
  -- filial da conta — Financeiro OU gerente daquela filial (régua canônica
  -- "gerente opera a filial inteira").
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
  ELSE
    SELECT status, filial INTO v_status, v_filial
      FROM public.contas_receber WHERE id = p_conta_id AND COALESCE(ativo, true) FOR UPDATE;

    -- Conta com baixa parcial pertence à baixar_conta_receber (migr. 422).
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

  -- A origem do dinheiro tem de ser da mesma unidade da conta (migr. 325).
  -- Banco global/legado (filial NULL) passa em qualquer uma.
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
-- 7. O limite de crédito passa a contar o que já foi recebido
--
-- `cliente_saldo_devedor` (migr. 416) somava o `valor` de todo título não pago
-- — e o título continua com o valor cheio depois de uma baixa parcial. Sem
-- este ajuste, quem pagou R$ 700 de uma dívida de R$ 1.000 seguiria com os
-- R$ 1.000 inteiros ocupando o limite, e o PDV recusaria a próxima venda a
-- prazo por uma dívida que já foi paga. Pagar tem de liberar crédito, senão a
-- trava vira castigo.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cliente_saldo_devedor(p_cliente_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
           GREATEST(
             cr.valor - COALESCE((
               SELECT SUM(b.principal)
                 FROM public.contas_receber_baixas b
                WHERE b.conta_id = cr.id
             ), 0),
             0)
         ), 0)::numeric(15,2)
    FROM public.contas_receber cr
   WHERE cr.cliente_id = p_cliente_id
     AND cr.ativo = true
     AND cr.status <> 'Pago';
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
