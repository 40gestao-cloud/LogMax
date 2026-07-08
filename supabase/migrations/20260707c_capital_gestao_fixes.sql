-- =================================================================
-- Fixes para 20260707_capital_gestao + 20260707b_caixa_bancos_filial:
--   #1 Drop "fin_all" em caixa_bancos (senão bloqueio é ignorado)
--   #2 aprovar_emprestimo credita saldo do banco escolhido
--   #4 bloqueado = saldo real < 0 (reserva vira só alerta)
--   #5 última parcela absorve diferença de arredondamento
-- =================================================================

BEGIN;

-- ── #1: Bloqueio real em caixa_bancos ─────────────────────────────
-- A policy "fin_all" (migration 20260516) concede FOR ALL a todo
-- setor financeiro e sobrepõe (OR) as policies filial-aware.
DROP POLICY IF EXISTS "fin_all" ON public.caixa_bancos;

-- ── #4 + #5 + #2: RPC recalcular_saldo_capital e aprovar_emprestimo
-- Substituindo cálculo do bloqueio e do parcelamento.
CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(p_filial text)
RETURNS TABLE (
  capital_total   numeric,
  despesas_pagas  numeric,
  receitas_pagas  numeric,
  reserva_valor   numeric,
  reserva_pct     numeric,
  saldo_livre     numeric,          -- capital+empréstimo - despesas - reserva (para UI)
  saldo_real      numeric,          -- capital+empréstimo - despesas (sem reserva) — usado para bloqueio
  bloqueado       boolean,          -- true só quando estourou capital+empréstimos
  em_reserva      boolean,          -- true quando saldo_livre <= 0 mas ainda dentro do capital
  data_inicio     date,
  data_fim        date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg         RECORD;
  v_capital     numeric := 0;
  v_emprest     numeric := 0;
  v_despesas    numeric := 0;
  v_receitas    numeric := 0;
  v_reserva_pct numeric := 0;
  v_reserva_val numeric := 0;
  v_saldo_real  numeric := 0;
  v_saldo_livre numeric := 0;
BEGIN
  SELECT * INTO v_cfg FROM public.capital_config
   ORDER BY created_at DESC LIMIT 1;

  SELECT COALESCE(SUM(valor), 0) INTO v_capital
    FROM public.capital_filial
   WHERE filial = p_filial
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(valor), 0) INTO v_emprest
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND status = 'Aprovado'
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(cp.valor), 0) INTO v_despesas
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status = 'Pago'
     AND COALESCE(cp.ativo, true) = true
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial AND cr.status = 'Recebido'
     AND COALESCE(cr.ativo, true) = true
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  v_reserva_pct := COALESCE(v_cfg.reserva_min_pct, 0);
  v_reserva_val := ROUND((v_capital + v_emprest) * v_reserva_pct / 100, 2);
  v_saldo_real  := (v_capital + v_emprest) - v_despesas;
  v_saldo_livre := v_saldo_real - v_reserva_val;

  RETURN QUERY SELECT
    (v_capital + v_emprest),
    v_despesas,
    v_receitas,
    v_reserva_val,
    v_reserva_pct,
    v_saldo_livre,
    v_saldo_real,
    (v_saldo_real < 0),                             -- bloqueia só quando estoura o capital
    (v_saldo_livre <= 0 AND v_saldo_real >= 0),     -- alerta: dentro do capital, mas invadiu reserva
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_inicio ELSE CURRENT_DATE END,
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_fim ELSE NULL END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcular_saldo_capital(text) TO authenticated;

-- ── #2 + #5: aprovar_emprestimo credita banco e ajusta última parcela
CREATE OR REPLACE FUNCTION public.aprovar_emprestimo(
  p_emprestimo_id       uuid,
  p_banco_id            uuid,
  p_banco_nome          text,
  p_taxa_juros          numeric,
  p_num_parcelas        int,
  p_justificativa_resp  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  SELECT * INTO v_emp FROM public.emprestimos_filial WHERE id = p_emprestimo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empréstimo não encontrado'; END IF;
  IF v_emp.status <> 'Pendente' THEN RAISE EXCEPTION 'Empréstimo já processado'; END IF;

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
    v_venc := CURRENT_DATE + ((i) * interval '1 month');

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
$$;

GRANT EXECUTE ON FUNCTION public.aprovar_emprestimo(uuid,uuid,text,numeric,int,text) TO authenticated;

COMMIT;
