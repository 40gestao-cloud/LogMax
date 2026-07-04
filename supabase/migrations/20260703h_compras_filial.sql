-- =================================================================
-- Compras: adiciona coluna filial nas 5 tabelas do fluxo
-- (requisicoes → aprovacoes_compras → cotacoes → pedidos → recebimentos)
-- e atualiza a RPC criar_requisicao_compra para aceitar p_filial.
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Adiciona coluna filial ────────────────────────────────────
ALTER TABLE public.requisicoes
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.aprovacoes_compras
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.cotacoes
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- ─── 2. Propaga dados históricos pelo fluxo ───────────────────────
-- aprovacoes ← requisicoes
UPDATE public.aprovacoes_compras ac
SET filial = r.filial
FROM public.requisicoes r
WHERE ac.requisicao_id = r.id
  AND ac.filial = 'SuperMax';

-- cotacoes ← requisicoes
UPDATE public.cotacoes c
SET filial = r.filial
FROM public.requisicoes r
WHERE c.requisicao_id = r.id
  AND c.filial = 'SuperMax';

-- pedidos ← cotacoes
UPDATE public.pedidos p
SET filial = c.filial
FROM public.cotacoes c
WHERE p.cotacao_id = c.id
  AND p.filial = 'SuperMax';

-- recebimentos ← pedidos
UPDATE public.recebimentos r
SET filial = p.filial
FROM public.pedidos p
WHERE r.pedido_id = p.id
  AND r.filial = 'SuperMax';

-- ─── 3. Atualiza RPC criar_requisicao_compra ─────────────────────
-- Adiciona p_filial (DEFAULT 'SuperMax') como 6º parâmetro.
-- O GRANT antigo era para assinatura (text,text,integer,text,text);
-- precisamos de um novo GRANT para a assinatura com 6 parâmetros.
CREATE OR REPLACE FUNCTION public.criar_requisicao_compra(
  p_item         text,
  p_solicitante  text,
  p_qtd          integer DEFAULT 1,
  p_urgencia     text    DEFAULT 'Normal',
  p_centro_custo text    DEFAULT NULL,
  p_filial       text    DEFAULT 'SuperMax'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req requisicoes;
BEGIN
  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Item solicitado é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_solicitante IS NULL OR length(trim(p_solicitante)) = 0 THEN
    RAISE EXCEPTION 'Solicitante é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 THEN
    p_qtd := 1;
  END IF;
  IF p_urgencia IS NULL OR p_urgencia NOT IN ('Normal','Alta','Urgente') THEN
    p_urgencia := 'Normal';
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;

  INSERT INTO public.requisicoes (
    item, solicitante, qtd, urgencia, centro_custo, status, data, filial
  ) VALUES (
    trim(p_item), trim(p_solicitante), p_qtd, p_urgencia,
    NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
    'Pendente', public.acre_today(), p_filial
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_requisicao_compra(text, text, integer, text, text, text)
  TO authenticated;

COMMIT;
