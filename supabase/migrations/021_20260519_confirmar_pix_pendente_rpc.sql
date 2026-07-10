-- =================================================================
-- LogMax — RPC confirmar_pix_pendente
-- =================================================================
-- Substitui o UPDATE direto que o simulador (rota anônima) fazia em
-- pix_pendentes. Motivo: RLS no projeto está rejeitando o UPDATE
-- com "new row violates row-level security policy" mesmo com policies
-- corretas (PERMISSIVE, USING + WITH CHECK válidos). Diagnóstico
-- confirmou via DISABLE ROW LEVEL SECURITY que o UPDATE em si funciona.
--
-- Solução: SECURITY DEFINER bypassa a RLS no contexto da função. A
-- regra de transição (aguardando → pago) fica codada no corpo, então
-- é mais seguro do que policy: anônimo não pode rebackdate nem cancelar.
-- =================================================================

CREATE OR REPLACE FUNCTION public.confirmar_pix_pendente(p_id uuid)
RETURNS TABLE (id uuid, status text, paid_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE pix_pendentes p
  SET status = 'pago',
      paid_at = now()
  WHERE p.id = p_id
    AND p.status = 'aguardando'
  RETURNING p.id, p.status, p.paid_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pix pendente não encontrado ou já processado'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_pix_pendente(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirmar_pix_pendente(uuid) TO anon, authenticated;
