-- Permite que o operador do PDV feche ou suspenda o caixa.
-- Financeiro vê quem fez e de onde (PDV vs painel financeiro).

-- 1. Nova coluna: origem do fechamento
ALTER TABLE public.controle_caixa
  ADD COLUMN IF NOT EXISTS origem_fechamento text;

COMMENT ON COLUMN public.controle_caixa.origem_fechamento IS
  'De onde o caixa foi fechado/suspenso: operador (PDV) ou financeiro (painel). NULL = legado.';

-- 2. Atualizar check de status para incluir Suspenso
-- (se já existir constraint, dropar e recriar)
DO $$
BEGIN
  ALTER TABLE public.controle_caixa DROP CONSTRAINT IF EXISTS controle_caixa_status_check;
  ALTER TABLE public.controle_caixa
    ADD CONSTRAINT controle_caixa_status_check
    CHECK (status IN ('Aberto', 'Fechado', 'Suspenso'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Dropar assinatura antiga (3 params) para evitar overload ambígua
DROP FUNCTION IF EXISTS public.fechar_caixa_conferido(uuid, numeric, text);

-- Atualizar RPC fechar_caixa_conferido para aceitar origem
CREATE OR REPLACE FUNCTION public.fechar_caixa_conferido(
  p_controle_id   uuid,
  p_valor_contado numeric,
  p_observacao    text DEFAULT NULL,
  p_origem        text DEFAULT 'financeiro'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caixa         public.controle_caixa;
  v_vendas_din    numeric(15,2) := 0;
  v_suprimentos   numeric(15,2) := 0;
  v_sangrias      numeric(15,2) := 0;
  v_esperado      numeric(15,2);
  v_dif           numeric(15,2);
  v_tipo          text;
  v_uid           uuid := auth.uid();
  v_nome          text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_caixa.status = 'Fechado' THEN
    RAISE EXCEPTION 'Caixa já fechado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_contado IS NULL OR p_valor_contado < 0 THEN
    RAISE EXCEPTION 'Valor contado inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(total_final), 0) INTO v_vendas_din
    FROM public.vendas
   WHERE DATE(created_at AT TIME ZONE 'America/Rio_Branco') = v_caixa.data
     AND forma_pagamento ILIKE 'dinheiro%'
     AND COALESCE(ativo, true) = true
     AND (v_caixa.filial IS NULL OR filial = v_caixa.filial);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  v_esperado := COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias;
  v_dif      := p_valor_contado - v_esperado;
  v_tipo     := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status             = 'Fechado',
         valor_fechamento   = p_valor_contado,
         valor_esperado     = v_esperado,
         diferenca          = v_dif,
         tipo_diferenca     = v_tipo,
         fechado_por        = v_uid,
         fechado_por_nome   = v_nome,
         fechado_em         = now(),
         observacao         = COALESCE(p_observacao, observacao),
         origem_fechamento  = COALESCE(p_origem, 'financeiro')
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_abertura',  COALESCE(v_caixa.valor_abertura, 0),
    'vendas_dinheiro', v_vendas_din,
    'suprimentos',     v_suprimentos,
    'sangrias',        v_sangrias,
    'valor_esperado',  v_esperado,
    'valor_contado',   p_valor_contado,
    'diferenca',       v_dif,
    'tipo',            v_tipo
  );
END;
$$;

-- Atualizar grant (nova assinatura com 4 params)
GRANT EXECUTE ON FUNCTION public.fechar_caixa_conferido(uuid, numeric, text, text) TO authenticated;

-- 4. RPC suspender_caixa — pausa sem conferência de valores
CREATE OR REPLACE FUNCTION public.suspender_caixa(
  p_controle_id uuid,
  p_observacao  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caixa  public.controle_caixa;
  v_uid    uuid := auth.uid();
  v_nome   text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_caixa.status <> 'Aberto' THEN
    RAISE EXCEPTION 'Caixa não está aberto.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status            = 'Suspenso',
         fechado_por       = v_uid,
         fechado_por_nome  = v_nome,
         fechado_em        = now(),
         observacao        = COALESCE(p_observacao, observacao),
         origem_fechamento = 'operador'
   WHERE id = p_controle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suspender_caixa(uuid, text) TO authenticated;
