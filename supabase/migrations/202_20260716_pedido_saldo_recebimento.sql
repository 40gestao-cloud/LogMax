-- 202_20260716_pedido_saldo_recebimento.sql
-- Amarra recebimentos ao saldo do pedido:
--   * view v_pedido_saldo agrega qtd_recebida de recebimentos ativos por pedido
--   * função pedido_saldo(uuid) devolve linha única (usada pelo frontend p/
--     validar antes de confirmar recebimento)
--
-- Regra: recebimentos com ativo=true consomem saldo, independentemente do
-- status (Pendente/Concluído/Parcial). Recebimentos inativos (soft-delete)
-- não consomem — ao inativar um recebimento o saldo é devolvido ao pedido.
-- Idempotente.

BEGIN;

CREATE OR REPLACE VIEW public.v_pedido_saldo AS
SELECT
    p.id                                  AS pedido_id,
    p.filial                              AS filial,
    COALESCE(p.item_qtd, 0)               AS qtd_pedida,
    COALESCE(SUM(r.qtd_recebida) FILTER (WHERE r.ativo = true), 0)::int
                                          AS qtd_recebida_total,
    GREATEST(
        COALESCE(p.item_qtd, 0)
        - COALESCE(SUM(r.qtd_recebida) FILTER (WHERE r.ativo = true), 0)::int,
        0
    )                                     AS qtd_saldo
FROM public.pedidos p
LEFT JOIN public.recebimentos r ON r.pedido_id = p.id
WHERE p.ativo = true
GROUP BY p.id, p.filial, p.item_qtd;

COMMENT ON VIEW public.v_pedido_saldo IS
    'Saldo pendente de recebimento por pedido. Herda RLS de pedidos/recebimentos.';

CREATE OR REPLACE FUNCTION public.pedido_saldo(p_pedido_id uuid)
RETURNS TABLE (
    pedido_id          uuid,
    qtd_pedida         int,
    qtd_recebida_total int,
    qtd_saldo          int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT v.pedido_id, v.qtd_pedida, v.qtd_recebida_total, v.qtd_saldo
    FROM public.v_pedido_saldo v
    WHERE v.pedido_id = p_pedido_id;
$$;

COMMENT ON FUNCTION public.pedido_saldo(uuid) IS
    'Saldo de recebimento de 1 pedido. Frontend chama antes de confirmar.';

GRANT SELECT ON public.v_pedido_saldo TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_saldo(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
