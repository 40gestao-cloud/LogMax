-- =================================================================
-- Total pendente de contas_pagar via RPC (com juros/multa)
-- =================================================================
-- Bug: ContasPagarView calculava `totalPendente` client-side com
-- SELECT sem paginação — PostgREST limita ~1000 linhas, então o total
-- ficava silenciosamente subestimado quando a tabela crescia.
--
-- Fix: SUM server-side considerando juros + multa da `financeiro_config`
-- (mesma lógica de `calcular_valor_atualizado`). Aceita filtro opcional
-- por filial pra bater com o toolbar da view.
--
-- SECURITY DEFINER + gate explícito de role (só quem enxerga contas
-- pendentes pode ver o total: admin/CEO/financeiro).
-- =================================================================

CREATE OR REPLACE FUNCTION public.total_pendente_contas_pagar(
  p_filial text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
           AND vencimento IS NOT NULL
           AND (v_hoje - vencimento) > COALESCE(v_cfg.carencia_dias, 0)
        THEN valor
             + ROUND(valor * COALESCE(v_cfg.multa_pct, 0) / 100.0, 2)
             + ROUND(valor * COALESCE(v_cfg.juros_dia_pct, 0) / 100.0
                     * ((v_hoje - vencimento) - COALESCE(v_cfg.carencia_dias, 0)), 2)
      ELSE valor
    END
  ), 0)
  INTO v_total
  FROM public.contas_pagar
  WHERE status = 'Pendente'
    AND COALESCE(ativo, true)
    AND (p_filial IS NULL OR filial = p_filial);

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.total_pendente_contas_pagar(text) FROM public;
GRANT EXECUTE ON FUNCTION public.total_pendente_contas_pagar(text) TO authenticated;
