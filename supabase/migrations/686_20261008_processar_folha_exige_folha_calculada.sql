-- 686 — Só se processa folha calculada.
--
-- processar_folha aceitava qualquer folha Pendente. Na Contabilidade as 44
-- folhas da turma foram lançadas e processadas sem nunca passar pelo
-- recalcular_folha_do_ponto: sem rubricas, sem INSS, sem IRRF, sem FGTS — o
-- líquido era o bruto. O funcionário recebia a mais, a empresa não retinha o
-- que deve ao governo, e as guias da 684 nasciam zeradas.
--
-- Régua: a folha tem rubricas (o holerite) e elas fecham com o líquido
-- gravado. A segunda metade pega a folha editada DEPOIS do cálculo (salário
-- base, desconto manual) sem recalcular — o líquido deixa de ser o do
-- holerite.
--
-- O recálculo não inventa falta: sem marcação de ponto ele só aplica salário,
-- INSS, IRRF e FGTS. A tela (FolhaPagamentoView) passa a calcular sozinha
-- antes de processar; esta trava é para o resto (F12, tela antiga em cache).

DO $mig$
DECLARE
  v_def text;
  v_old text := $o$  -- Vencimento: dia 5 do mês seguinte ao de referência.$o$;
  v_new text := $n$  -- MIGR 686: só folha calculada. Rubricas existem e fecham com o líquido —
  -- senão o bruto sai como líquido, sem INSS/IRRF retidos nem FGTS.
  IF NOT EXISTS (SELECT 1 FROM public.folha_rubricas r WHERE r.folha_id = p_folha_id) THEN
    RAISE EXCEPTION 'Esta folha ainda não foi calculada (sem holerite: INSS, IRRF e FGTS não foram apurados). Use "Recalcular do Ponto" antes de processar — sem marcação de ponto ele só aplica salário e encargos.'
      USING ERRCODE = 'P0001';
  END IF;
  IF abs(v_liquido - (
       SELECT COALESCE(sum(r.valor) FILTER (WHERE r.tipo = 'provento'), 0)
            - COALESCE(sum(r.valor) FILTER (WHERE r.tipo = 'desconto'), 0)
         FROM public.folha_rubricas r WHERE r.folha_id = p_folha_id)) > 0.01 THEN
    RAISE EXCEPTION 'A folha foi alterada depois do cálculo — o líquido (R$ %) não é mais o do holerite. Recalcule antes de processar.',
      replace(to_char(v_liquido, 'FM999999990.00'), '.', ',')
      USING ERRCODE = 'P0001';
  END IF;

  -- Vencimento: dia 5 do mês seguinte ao de referência.$n$;
BEGIN
  v_def := replace(pg_get_functiondef('public.processar_folha(uuid)'::regprocedure), E'\r', '');
  IF position('MIGR 686' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'processar_folha: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;
