-- =================================================================
-- RPC: criar_requisicoes_compra_lote — requisições de compra em lote
-- =================================================================
-- Complementa `criar_requisicao_compra` (101_20260619c / 136_20260703h)
-- para o caso em que o solicitante pede vários itens de uma vez (ex:
-- itens do mesmo fornecedor). Recebe um array jsonb de {item, qtd} e
-- cria 1 requisição + 1 aprovação pendente POR item, tudo dentro da
-- mesma transação da função — se qualquer item falhar a validação,
-- nada é gravado (mesma garantia de atomicidade do RPC individual).
--
-- Mantém `criar_requisicao_compra` intocado — Cotações/Pedidos seguem
-- 1 requisição : 1 cotação : 1 pedido; o lote só agiliza a etapa de
-- solicitação.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.criar_requisicoes_compra_lote(
  p_itens        jsonb,          -- [{"item": "Parafuso 3/4", "qtd": 10}, ...]
  p_solicitante  text,
  p_urgencia     text    DEFAULT 'Normal',
  p_centro_custo text    DEFAULT NULL,
  p_filial       text    DEFAULT 'SuperMax'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elem      jsonb;
  v_req       requisicoes;
  v_resultado jsonb := '[]'::jsonb;
  v_qtd       integer;
  v_texto     text;
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE = 'P0001';
  END IF;
  IF p_solicitante IS NULL OR length(trim(p_solicitante)) = 0 THEN
    RAISE EXCEPTION 'Solicitante é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_urgencia IS NULL OR p_urgencia NOT IN ('Normal','Alta','Urgente') THEN
    p_urgencia := 'Normal';
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_texto := trim(COALESCE(v_elem->>'item', ''));
    IF v_texto = '' THEN
      RAISE EXCEPTION 'Todo item da requisição em lote precisa de uma descrição.' USING ERRCODE = 'P0001';
    END IF;
    v_qtd := COALESCE((v_elem->>'qtd')::integer, 1);
    IF v_qtd < 1 THEN
      v_qtd := 1;
    END IF;

    INSERT INTO public.requisicoes (
      item, solicitante, qtd, urgencia, centro_custo, status, data, filial
    ) VALUES (
      v_texto, trim(p_solicitante), v_qtd, p_urgencia,
      NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
      'Pendente', public.acre_today(), p_filial
    )
    RETURNING * INTO v_req;

    INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
    VALUES (v_req.id, 'Pendente', p_filial);

    v_resultado := v_resultado || to_jsonb(v_req);
  END LOOP;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text)
  TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT public.criar_requisicoes_compra_lote(
--     '[{"item":"Parafuso 3/4","qtd":10},{"item":"Porca 3/4","qtd":10}]'::jsonb,
--     'Fulano', 'Alta', 'CC-X', 'SuperMax'
--   );
--   -- retorna jsonb array com as 2 requisições criadas; cada uma já
--   -- tem aprovação pendente correspondente em aprovacoes_compras.
-- =================================================================
