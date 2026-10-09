-- 687 — A nota do pedido só se confere com a entrega concluída.
--
-- A tela (ContasPagarView.pendenciaDe) só oferece "Conferir nota" depois de
-- um recebimento 'Concluído', mas conferir_nota_fiscal aceitava 'Parcial'.
-- Pelo F12, conferir a nota da 1ª carga (80 de 150) gravava a conta pelo valor
-- dessa nota e _ajustar_custo_pela_nota dividia esse valor pela quantidade
-- PEDIDA — o custo médio despencava e a dívida encolhia antes do resto chegar.
--
-- Concluído inclui o encerrado com saldo (migr. 489): ali a falta é
-- deliberada, e o custo se divide pelo que chegou.
--
-- No front, o modal passa a listar as notas de todas as cargas e pedir a SOMA
-- delas quando são mais de uma.

DO $mig$
DECLARE
  v_def text;
  v_old text := $o$  -- Divergência entre o combinado e o cobrado. Não bloqueia — em compra real$o$;
  v_new text := $n$  -- MIGR 687: nota de entrega ainda em andamento não se confere — o valor
  -- dela cobre só parte do pedido, e viraria a conta e o custo do pedido todo.
  IF NOT EXISTS (SELECT 1 FROM public.recebimentos r
                  WHERE r.pedido_id = v_conta.pedido_id
                    AND COALESCE(r.ativo, true)
                    AND r.status = 'Concluído') THEN
    RAISE EXCEPTION 'A entrega deste pedido ainda está parcial. A nota se confere quando o Estoque concluir o recebimento (ou encerrar com saldo) — aí o valor é a soma das notas de todas as cargas.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Divergência entre o combinado e o cobrado. Não bloqueia — em compra real$n$;
BEGIN
  v_def := replace(pg_get_functiondef('public.conferir_nota_fiscal(uuid, numeric, text)'::regprocedure), E'\r', '');
  IF position('MIGR 687' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'conferir_nota_fiscal: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;
