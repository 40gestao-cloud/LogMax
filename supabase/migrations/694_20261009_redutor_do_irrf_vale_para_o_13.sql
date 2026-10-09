-- 694 — O redutor do IRRF (Lei 15.270/2025) também vale para o 13º.
--
-- A 688 deixou o 13º sem redutor por dúvida na leitura da lei. A orientação
-- da Receita Federal sobre o cálculo a partir de 01/01/2026 diz que a redução
-- "também se aplica ao imposto cobrado exclusivamente na fonte no pagamento do
-- décimo terceiro salário". Conferência de 2026-10-09 contra as fontes:
-- INSS (Portaria Interministerial MPS/MF nº 13/2026), salário mínimo
-- (R$ 1.621,00), tabela mensal do IRRF, dependente (R$ 189,59), simplificado
-- (R$ 607,20) e os números do redutor — todos batem com o que a 688 gravou.
--
-- No 13º o rendimento comparado com a faixa do redutor é o do próprio 13º
-- (tributação exclusiva, base própria); o desconto simplificado continua fora
-- dele — só as deduções legais (INSS + dependentes).

DO $mig$
DECLARE
  v_def text;
  v_old text := 'IF COALESCE(p_mensal, true) AND v_par.irrf_redutor_ate IS NOT NULL THEN';
  v_new text := 'IF v_par.irrf_redutor_ate IS NOT NULL THEN  -- MIGR 694: vale também para o 13º';
BEGIN
  v_def := replace(pg_get_functiondef('public.rh_calc_irrf(numeric, date, integer, numeric, boolean)'::regprocedure), E'\r', '');
  IF position('MIGR 694' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'rh_calc_irrf: trecho-âncora não encontrado';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, '-- Redutor (Lei 15.270/2025): sobre o rendimento tributável do mês.',
                          '-- Redutor (Lei 15.270/2025): sobre o rendimento tributável do mês ou do 13º.');
  EXECUTE v_def;
END
$mig$;
