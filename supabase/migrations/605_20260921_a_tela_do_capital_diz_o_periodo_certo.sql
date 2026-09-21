-- ════════════════════════════════════════════════════════════════════════════
-- 605 — A tela do Capital diz o período certo
-- ════════════════════════════════════════════════════════════════════════════
--
-- `calcular_saldo_capital` devolvia a janela do período assim:
--
--     CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_inicio ELSE acre_today() END
--
-- e `v_cfg` é um RECORD. Para um RECORD, `IS NOT NULL` só é verdadeiro quando
-- TODOS os campos são não-nulos — e `capital_config.data_fim` é NULL sempre
-- que o período é "sem prazo", `criado_por` é NULL em linha antiga, e assim
-- por diante. Ou seja: na prática o CASE caía quase sempre no ELSE e a RPC
-- respondia "o período começa hoje e não termina nunca", qualquer que fosse a
-- configuração real.
--
-- As SOMAS nunca foram afetadas: elas testam `v_cfg IS NULL`, que para RECORD
-- só é verdadeiro quando TODOS os campos são nulos — nenhum campo nulo isolado
-- desliga o filtro. Por isso o defeito passou despercebido: as contas estavam
-- certas e só o par de datas mentia.
--
-- O estrago aparecia na tela da filial, que não tem acesso a `capital_config`
-- e lê o período pela RPC: ela mostrava a data de hoje como início e "sem
-- prazo" como fim, e o aviso de período encerrado (migr. 604 / componente
-- PeriodoCapitalAviso) nunca teria como aparecer lá. Em 21/09/2026 foi
-- exatamente esse silêncio — do lado da Matriz — que fez R$ 35 milhões de
-- aporte aparecerem como "Capital Total R$ 0,00" sem explicação nenhuma.
--
-- Conserto: `FOUND` logo depois do SELECT INTO, que é o teste correto para
-- "achou linha". Nada mais muda — corpo copiado de `prosrc`
-- (md5 df641abe8ff8c6b64748574d26f43a05, igual nos 4 projetos).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(p_filial text)
 RETURNS TABLE(capital_total numeric, despesas_pagas numeric, despesas_operacionais numeric, despesas_financeiras numeric, receitas_pagas numeric, lucro_operacional numeric, lucro_liquido numeric, reserva_valor numeric, reserva_pct numeric, saldo_livre numeric, saldo_real numeric, bloqueado boolean, em_reserva boolean, data_inicio date, data_fim date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg          RECORD;
  v_tem_cfg      boolean := false;
  v_capital      numeric := 0;
  v_emprest      numeric := 0;
  v_saida_hold   numeric := 0;
  v_aporte_out   numeric := 0;
  v_emp_out      numeric := 0;
  v_emp_back     numeric := 0;
  v_juros_in     numeric := 0;
  v_dividendo_in numeric := 0;
  v_desp_op      numeric := 0;
  v_juros_pago   numeric := 0;
  v_amort_paga   numeric := 0;
  v_distribuido  numeric := 0;
  v_receitas     numeric := 0;
  v_reserva_pct  numeric := 0;
  v_reserva_val  numeric := 0;
  v_saldo_real   numeric := 0;
  v_saldo_livre  numeric := 0;
  v_desp_total   numeric := 0;
  v_lucro_op     numeric := 0;
  v_lucro_liq    numeric := 0;
BEGIN
  PERFORM public._assert_rpc();
  SELECT * INTO v_cfg FROM public.capital_config
   ORDER BY created_at DESC LIMIT 1;
  v_tem_cfg := FOUND;

  SELECT COALESCE(SUM(valor), 0) INTO v_capital
    FROM public.capital_filial
   WHERE filial = p_filial
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- (572) `arquivado_em IS NULL`: emprestimo preservado por reset e historico,
  -- nao capital. O caixa foi zerado e os titulos apagados junto.
  SELECT COALESCE(SUM(valor), 0) INTO v_emprest
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND status = 'Aprovado'
     AND arquivado_em IS NULL
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  IF p_filial = 'Matriz' THEN
    SELECT COALESCE(SUM(cf.valor), 0) INTO v_aporte_out
      FROM public.capital_filial cf
     WHERE cf.filial <> 'Matriz'
       AND (v_cfg IS NULL OR cf.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cf.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    -- (572) A outra ponta do mesmo par: se nao conta como capital da unidade,
    -- nao pode continuar descontando do capital proprio da holding.
    SELECT COALESCE(SUM(e.valor), 0) INTO v_emp_out
      FROM public.emprestimos_filial e
     WHERE e.status = 'Aprovado'
       AND e.arquivado_em IS NULL
       AND (v_cfg IS NULL OR e.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR e.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    SELECT COALESCE(SUM(COALESCE(pe.amortizacao, cr.valor)), 0),
           COALESCE(SUM(COALESCE(pe.juros, 0)), 0)
      INTO v_emp_back, v_juros_in
      FROM public.contas_receber cr
      LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_receber_id = cr.id
     WHERE cr.filial = 'Matriz' AND cr.origem = 'emprestimo'
       AND cr.status IN ('Pago', 'Recebido')
       AND COALESCE(cr.ativo, true) = true
       AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    SELECT COALESCE(SUM(d.valor), 0) INTO v_dividendo_in
      FROM public.distribuicoes_lucro d
     WHERE d.ativo = true
       AND (v_cfg IS NULL OR d.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR d.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    v_saida_hold := v_aporte_out + v_emp_out - v_emp_back;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN cp.status = 'Pago' THEN cp.valor ELSE COALESCE(cp.valor_pago, 0) END), 0) INTO v_desp_op
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND COALESCE(cp.origem, '') <> 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.juros, 0)
                ELSE ROUND(COALESCE(pe.juros, 0)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0),
         COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.amortizacao, cp.valor)
                ELSE ROUND(COALESCE(pe.amortizacao, cp.valor)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0)
    INTO v_juros_pago, v_amort_paga
    FROM public.contas_pagar cp
    LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_pagar_id = cp.id
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND cp.origem = 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(d.valor), 0) INTO v_distribuido
    FROM public.distribuicoes_lucro d
   WHERE d.filial = p_filial AND d.ativo = true
     AND (v_cfg IS NULL OR d.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR d.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial
     AND cr.status IN ('Pago', 'Recebido')
     AND COALESCE(cr.ativo, true) = true
     AND NOT (p_filial = 'Matriz' AND COALESCE(cr.origem, '') = 'emprestimo')
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  v_receitas    := v_receitas + v_juros_in + v_dividendo_in;

  v_capital     := v_capital - v_saida_hold;
  v_desp_total  := v_desp_op + v_juros_pago + v_amort_paga;
  v_reserva_pct := COALESCE(v_cfg.reserva_min_pct, 0);
  v_reserva_val := ROUND((v_capital + v_emprest) * v_reserva_pct / 100, 2);
  v_saldo_real  := (v_capital + v_emprest) - v_desp_total - v_distribuido;
  v_saldo_livre := v_saldo_real - v_reserva_val;
  v_lucro_op    := v_receitas - v_desp_op;
  v_lucro_liq   := v_lucro_op - v_juros_pago - v_reserva_val;

  RETURN QUERY SELECT
    (v_capital + v_emprest),
    v_desp_total,
    v_desp_op,
    v_juros_pago,
    v_receitas,
    v_lucro_op,
    v_lucro_liq,
    v_reserva_val,
    v_reserva_pct,
    v_saldo_livre,
    v_saldo_real,
    (v_saldo_real < 0),
    (v_saldo_livre <= 0 AND v_saldo_real >= 0),
    CASE WHEN v_tem_cfg THEN v_cfg.data_inicio ELSE public.acre_today() END,
    CASE WHEN v_tem_cfg THEN v_cfg.data_fim ELSE NULL END;
END;
$function$;

COMMENT ON FUNCTION public.calcular_saldo_capital(text) IS
  'Migr. 605 — o período devolvido sai de FOUND, não de "v_cfg IS NOT NULL": RECORD com um campo nulo (data_fim de período sem prazo) fazia a RPC mentir a janela para a tela da filial.';

COMMIT;

NOTIFY pgrst, 'reload schema';
