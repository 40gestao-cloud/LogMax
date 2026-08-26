-- 556 — Dinheiro exige gaveta aberta, e a conferência recalcula.
--
-- Dois defeitos do ciclo do caixa, os dois confirmados por teste em 26/08 (como
-- a Evilin — colaboradora, setor vendas, SuperMax — em transação revertida).
--
-- ─── 1. VENDA EM DINHEIRO SEM CAIXA ABERTO ─────────────────────────────────
--
-- `criar_venda_pdv` nunca olha `controle_caixa`. No teste havia ZERO caixas
-- abertos na SuperMax naquele dia, e a venda de R$ 240,00 em dinheiro passou:
-- estoque baixou, nota emitida, conta a receber nasceu 'Pago'. O dinheiro
-- entrou e não existe gaveta que o segure.
--
-- E não fica só sem gaveta: fica cobrado da gaveta errada. `fechar_caixa_conferido`
-- e `solicitar_fechamento_caixa` somam as vendas em dinheiro por DATA + FILIAL,
-- não por caixa:
--
--     WHERE DATE(created_at AT TIME ZONE 'America/Rio_Branco') = v_caixa.data
--       AND forma_pagamento ILIKE 'dinheiro%' ...
--
-- Então a venda feita sem caixa aberto é cobrada de quem abrir o caixa depois,
-- no mesmo dia — o aluno seguinte conta a gaveta e encontra uma falta de R$ 240
-- que ele não causou. Ou de ninguém, se ninguém abrir: a venda some da
-- conferência.
--
-- A trava vai num gatilho de `vendas`, e não dentro da RPC, por dois motivos:
-- cobre qualquer caminho que insira venda (não só o PDV), e evita que esta
-- migração e a 554 disputem a mesma função. Só dinheiro é barrado — cartão,
-- fiado e Pix não passam pela gaveta e seguem sem caixa aberto, como hoje.
--
-- ─── 2. SANGRIA DEPOIS DE A GAVETA JÁ TER SIDO CONTADA ─────────────────────
--
-- `registrar_movimentacao_caixa` só recusa `status = 'Fechado'`. No teste,
-- sangrei R$ 200 de um caixa em 'Aguardando Confirmação' cujo `valor_esperado`
-- congelado era R$ 500. Resultado literal:
--
--     esperado gravado no pedido de fechamento = 500,00
--     sangrias lançadas depois                 = 200,00
--     → o Financeiro confirma contra o número velho
--
-- Porque `confirmar_fechamento_caixa` não recalcula nada: lê
-- `v_caixa.valor_esperado`, que foi carimbado lá atrás por
-- `solicitar_fechamento_caixa`. Os R$ 200 somem da conferência.
--
-- São dois erros, e os dois se consertam:
--
--   · a causa — gaveta contada é gaveta selada: movimentação só entra em caixa
--     'Aberto'. O guard vai no gatilho da tabela, que é por onde TODOS os
--     caminhos passam (a RPC, e o INSERT direto que `criar_devolucao_venda`
--     faz — essa já exige caixa 'Aberto' por conta própria e continua passando
--     pela porta `app.devolucao_caixa`).
--   · o sintoma — a conferência do Financeiro passa a REFAZER a conta em vez de
--     confiar no número guardado. É a régua da migr. 489/531 outra vez: quem
--     calcula é o banco, na hora. Se o recalculado divergir do que o operador
--     viu, a diferença entra na observação em vez de sumir.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Venda em dinheiro exige caixa aberto na unidade, no dia
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venda_dinheiro_exige_caixa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dia date;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;
  -- Só dinheiro passa pela gaveta. Cartão, Fiado e Pix não.
  IF COALESCE(NEW.forma_pagamento, '') NOT ILIKE 'dinheiro%' THEN
    RETURN NEW;
  END IF;
  -- Venda já nascida cancelada não movimenta gaveta nenhuma.
  IF COALESCE(NEW.status, '') = 'Cancelada' THEN
    RETURN NEW;
  END IF;

  v_dia := DATE(COALESCE(NEW.created_at, now()) AT TIME ZONE 'America/Rio_Branco');

  IF NOT EXISTS (
    SELECT 1 FROM public.controle_caixa cc
     WHERE cc.filial = NEW.filial
       AND cc.data   = v_dia
       AND cc.status = 'Aberto'
       AND COALESCE(cc.ativo, true)
  ) THEN
    RAISE EXCEPTION
      'Não há caixa aberto na % hoje, e esta venda é em dinheiro: o dinheiro entraria sem gaveta para guardá-lo, e a conferência do fim do dia cobraria a falta de quem abrisse o caixa depois. Abra o caixa em Financeiro > Controle de Caixa e refaça a venda — ou receba por cartão, Pix ou fiado, que não passam pela gaveta.',
      NEW.filial
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_venda_dinheiro_exige_caixa ON public.vendas;
CREATE TRIGGER trg_venda_dinheiro_exige_caixa
  BEFORE INSERT ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.fn_venda_dinheiro_exige_caixa();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Gaveta contada é gaveta selada
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente de `movimentacao_caixa_guard`, com o estado do caixa
-- acrescentado. O gatilho é BEFORE INSERT OR UPDATE; a trava nova vale só para
-- INSERT, porque corrigir uma movimentação antiga de um caixa já encerrado é
-- conserto, não lançamento novo.
CREATE OR REPLACE FUNCTION public.movimentacao_caixa_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial_caixa text;
  v_status_caixa text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT filial, status INTO v_filial_caixa, v_status_caixa
    FROM public.controle_caixa
   WHERE id = NEW.controle_caixa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa % não encontrado.', NEW.controle_caixa_id USING ERRCODE = 'P0002';
  END IF;

  -- A movimentação é da filial do caixa. Divergência é erro de quem chamou.
  IF NEW.filial IS DISTINCT FROM v_filial_caixa THEN
    RAISE EXCEPTION 'Movimentação declarada como % mas o caixa é da unidade %.',
      NEW.filial, v_filial_caixa USING ERRCODE = '42501';
  END IF;

  -- Migr. 450: sangria emitida por `criar_devolucao_venda`, que já exigiu
  -- admin/CEO ou gerente DA FILIAL antes de gravar qualquer coisa — e que já
  -- procura um caixa 'Aberto' por conta própria. Sem esta porta, um CEO sem
  -- setor financeiro/vendas teria a devolução derrubada aqui, depois de o
  -- estoque já ter voltado.
  IF COALESCE(current_setting('app.devolucao_caixa', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  -- MIGR 556: dinheiro não entra nem sai de gaveta que já foi contada. O
  -- 'Aguardando Confirmação' é o estado em que o operador declarou o valor e
  -- espera o Financeiro conferir: mexer ali muda o esperado por baixo de uma
  -- conferência em andamento.
  IF TG_OP = 'INSERT' AND v_status_caixa <> 'Aberto' THEN
    RAISE EXCEPTION
      'Este caixa está em "%" — a gaveta já foi contada e não recebe mais lançamento. Se a sangria ou o suprimento aconteceu de verdade, peça ao Financeiro para reabrir o caixa (Financeiro > Controle de Caixa > Reabrir), lance, e feche de novo.',
      v_status_caixa
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT ((public.auth_in_setor('financeiro', 'vendas') OR public.auth_user_role() = 'gerente')
          AND public.auth_pode_filial(v_filial_caixa)) THEN
    RAISE EXCEPTION 'Sem permissão para movimentar o caixa da unidade %.', v_filial_caixa
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. A conferência do Financeiro refaz a conta
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_fechamento_caixa(
  p_controle_id uuid,
  p_observacao_extra text DEFAULT NULL::text,
  p_valor_reconferido numeric DEFAULT NULL::numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa       public.controle_caixa;
  v_uid         uuid := auth.uid();
  v_nome        text;
  v_esperado    numeric(15,2);
  v_guardado    numeric(15,2);
  v_vendas_din  numeric(15,2) := 0;
  v_suprimentos numeric(15,2) := 0;
  v_sangrias    numeric(15,2) := 0;
  v_valor_final numeric(15,2);
  v_dif         numeric(15,2);
  v_tipo        text;
  v_obs_final   text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- p_conferencia=true mantém a régua mais estreita (só Financeiro, ou o
  -- gerente da unidade), escopada por filial.
  PERFORM public._assert_caixa(v_caixa.filial, true);

  IF v_caixa.status <> 'Aguardando Confirmação' THEN
    RAISE EXCEPTION 'Só é possível confirmar caixa em Aguardando Confirmação (estado atual: %).', v_caixa.status
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 556: era `v_esperado := COALESCE(v_caixa.valor_esperado, 0)` — o
  -- número carimbado por `solicitar_fechamento_caixa` lá atrás. Agora a conta é
  -- refeita agora, com a mesma fórmula das outras duas RPCs. O número guardado
  -- vira só a referência do que o operador viu na hora.
  v_guardado := COALESCE(v_caixa.valor_esperado, 0);

  SELECT COALESCE(SUM(total_final), 0) INTO v_vendas_din
    FROM public.vendas
   WHERE DATE(created_at AT TIME ZONE 'America/Rio_Branco') = v_caixa.data
     AND forma_pagamento ILIKE 'dinheiro%'
     AND COALESCE(ativo, true) = true
     AND COALESCE(status, '') <> 'Cancelada'
     AND (v_caixa.filial IS NULL OR filial = v_caixa.filial);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  v_esperado := COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias;

  v_valor_final := COALESCE(p_valor_reconferido, v_caixa.valor_fechamento);
  v_dif  := v_valor_final - v_esperado;
  v_tipo := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  v_obs_final := CASE
    WHEN p_observacao_extra IS NULL OR btrim(p_observacao_extra) = '' THEN v_caixa.observacao
    WHEN v_caixa.observacao IS NULL OR btrim(v_caixa.observacao) = '' THEN p_observacao_extra
    ELSE v_caixa.observacao || E'\n— Financeiro: ' || p_observacao_extra
  END;

  -- Se o esperado mudou entre o pedido e a conferência, isso não some: fica
  -- escrito no documento, que é onde o aluno vai procurar a explicação.
  IF ABS(v_esperado - v_guardado) > 0.005 THEN
    v_obs_final := COALESCE(NULLIF(btrim(COALESCE(v_obs_final, '')), '') || E'\n', '')
      || format('— Recalculado na conferência: o esperado passou de R$ %s para R$ %s '
                || '(lançamentos entraram no caixa depois de a gaveta ser contada).',
                to_char(v_guardado, 'FM999G999G990D00'),
                to_char(v_esperado, 'FM999G999G990D00'));
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status            = 'Fechado',
         valor_fechamento  = v_valor_final,
         valor_esperado    = v_esperado,
         diferenca         = v_dif,
         tipo_diferenca    = v_tipo,
         atualizado_por    = v_uid,
         updated_at        = now(),
         observacao        = v_obs_final,
         origem_fechamento = 'financeiro'
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_esperado',   v_esperado,
    'esperado_no_pedido', v_guardado,
    'recalculado',      ABS(v_esperado - v_guardado) > 0.005,
    'valor_final',      v_valor_final,
    'diferenca',        v_dif,
    'tipo',             v_tipo,
    'confirmado_por',   v_nome,
    'status_novo',      'Fechado'
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
