-- RPC para MaxPay re-notificar um PIX já confirmado.
-- Quando o status já é 'pago', confirmar_pix_pendente é no-op (WHERE status='aguardando').
-- Esta RPC atualiza paid_at mesmo quando já pago, disparando o evento realtime
-- que o LogMax PDV escuta para fechar a venda.
CREATE OR REPLACE FUNCTION renotificar_pix_pago(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE pix_pendentes
  SET paid_at = now()
  WHERE id = p_id AND status = 'pago';
END;
$$;

GRANT EXECUTE ON FUNCTION renotificar_pix_pago(uuid) TO anon;
GRANT EXECUTE ON FUNCTION renotificar_pix_pago(uuid) TO authenticated;
