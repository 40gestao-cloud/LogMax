-- A maquininha não sabia se a cobrança foi cancelada ou paga.
--
-- A RLS de `anon` em pix_pendentes/cartao_pendentes (migr. 116/261/302) só
-- enxerga `status = 'aguardando'`. Sem uma forma de perguntar o status real, a
-- MaxPay infere o desfecho pelo SUMIÇO da linha da visão anon — e cobrança
-- CANCELADA no PDV some exatamente igual a cobrança PAGA. Na prática: o aluno
-- cancela o Pix no PDV, a maquininha lê o sumiço como aprovação e imprime
-- comprovante de uma venda que não aconteceu.
--
-- Esta RPC já existe no backend do MaxPOS desde que o bug apareceu lá; as 4
-- turmas do LogMax nunca a receberam — a MaxPay chama, toma PGRST202 e cai no
-- comportamento antigo (ela trata a ausência, por isso o defeito passou calado).
--
-- Devolve SÓ o status: nem valor, nem operador, nem cliente. Não abre as linhas
-- para `anon` — responde "aguardando/pago/autorizado/cancelado" e mais nada.
-- Como a busca é por uuid, não dá para varrer cobranças com ela.

CREATE OR REPLACE FUNCTION public.consultar_status_cobranca(p_tabela text, p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- search_path fixo: sem ele o schema do chamador escolhe qual tabela é lida.
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  -- Whitelist, não interpolação: `p_tabela` vem do cliente.
  IF p_tabela = 'pix_pendentes' THEN
    SELECT status INTO v_status FROM pix_pendentes WHERE id = p_id;
  ELSIF p_tabela = 'cartao_pendentes' THEN
    SELECT status INTO v_status FROM cartao_pendentes WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Tabela invalida: %', p_tabela USING ERRCODE = '22023';
  END IF;

  -- Cobrança apagada (ou id inventado) não é "pago": é desconhecido, e a
  -- maquininha trata isso como motivo para não imprimir nada.
  RETURN COALESCE(v_status, 'desconhecido');
END;
$$;

-- `anon` é a maquininha e o app do cliente; `authenticated` é o operador logado.
-- REVOKE de PUBLIC primeiro: função nova nasce executável por todo mundo, e o
-- GRANT nominal não desfaz isso sozinho.
REVOKE ALL ON FUNCTION public.consultar_status_cobranca(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultar_status_cobranca(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.consultar_status_cobranca(text, uuid) TO authenticated;

-- Sem isto o PostgREST responde PGRST202 até o próximo reload — e a MaxPay
-- continuaria no fallback achando que a turma não tem a migração.
NOTIFY pgrst, 'reload schema';
