-- Limpa contas_pagar órfãs: ativas mas vinculadas a pedido inativo.
--
-- Contexto: até esta migração, ao inativar um pedido (soft delete) a conta a
-- pagar gerada na aprovação permanecia com `ativo = true`, aparecendo
-- indevidamente em Despesas Operacionais no dashboard.
--
-- A correção em PedidosView.handleDelete passa a inativar as contas Pendentes
-- junto. Esta migração faz o backfill: marca como inativa qualquer conta a
-- pagar que ainda esteja ativa mas cujo pedido referenciado já foi inativado,
-- desde que não tenha sido paga (status != 'Pago' — pagamento real é
-- preservado e deve ser estornado manualmente se necessário).
--
-- Idempotente: rodar várias vezes só converge no mesmo estado.

UPDATE contas_pagar cp
SET ativo = false
WHERE cp.ativo = true
  AND cp.status <> 'Pago'
  AND cp.pedido_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pedidos p
    WHERE p.id = cp.pedido_id
      AND p.ativo = false
  );

-- Diagnóstico: contas pagas vinculadas a pedido inativo (não tocadas pela
-- migração — precisam de revisão manual no financeiro).
DO $$
DECLARE
  pagas_orfas integer;
BEGIN
  SELECT COUNT(*) INTO pagas_orfas
  FROM contas_pagar cp
  JOIN pedidos p ON p.id = cp.pedido_id
  WHERE cp.ativo = true
    AND cp.status = 'Pago'
    AND p.ativo = false;

  IF pagas_orfas > 0 THEN
    RAISE NOTICE '[orfaos_contas_pagar] % conta(s) PAGAS vinculadas a pedido inativo — revisar manualmente.', pagas_orfas;
  END IF;
END $$;
