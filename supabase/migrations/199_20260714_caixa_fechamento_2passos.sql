-- =====================================================================
-- Fechamento de caixa em 2 passos:
--   Passo 1 (operador no PDV) → status 'Aguardando Confirmação'
--   Passo 2 (Financeiro/gerente) → status 'Fechado'
--
-- Motivação: hoje só o Financeiro fecha caixa em ControleCaixaView. O
-- operador do PDV não tem botão nem RPC própria — precisa ir na tela do
-- Financeiro pra encerrar seu próprio turno. Passamos o poder pro PDV
-- (relatório + valor contado + obs), mas o valor final só vira 'Fechado'
-- depois que Financeiro confere e confirma.
-- =====================================================================

BEGIN;

-- ── #1 Expande CHECK do status ──────────────────────────────────────
ALTER TABLE public.controle_caixa DROP CONSTRAINT IF EXISTS controle_caixa_status_check;
ALTER TABLE public.controle_caixa ADD CONSTRAINT controle_caixa_status_check
  CHECK (status = ANY(ARRAY['Aberto','Aguardando Confirmação','Fechado','Suspenso']));

-- ── #2 RPC solicitar_fechamento_caixa (operador do PDV) ─────────────
-- Calcula o esperado (abertura + vendas em dinheiro + suprimentos − sangrias)
-- e transiciona 'Aberto' → 'Aguardando Confirmação'. Preenche valor_contado,
-- valor_esperado, diferenca, tipo_diferenca — Financeiro só revisa. Marca
-- origem_fechamento='operador' pra o badge 'PDV' aparecer na tela do
-- Financeiro.
CREATE OR REPLACE FUNCTION public.solicitar_fechamento_caixa(
  p_controle_id   uuid,
  p_valor_contado numeric,
  p_observacao    text DEFAULT NULL
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
  IF v_caixa.status <> 'Aberto' THEN
    RAISE EXCEPTION 'Só é possível solicitar fechamento de caixa aberto (estado atual: %).', v_caixa.status
      USING ERRCODE = 'P0001';
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
     SET status             = 'Aguardando Confirmação',
         valor_fechamento   = p_valor_contado,
         valor_esperado     = v_esperado,
         diferenca          = v_dif,
         tipo_diferenca     = v_tipo,
         fechado_por        = v_uid,
         fechado_por_nome   = v_nome,
         fechado_em         = now(),
         observacao         = COALESCE(p_observacao, observacao),
         origem_fechamento  = 'operador'
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_abertura',  COALESCE(v_caixa.valor_abertura, 0),
    'vendas_dinheiro', v_vendas_din,
    'suprimentos',     v_suprimentos,
    'sangrias',        v_sangrias,
    'valor_esperado',  v_esperado,
    'valor_contado',   p_valor_contado,
    'diferenca',       v_dif,
    'tipo',            v_tipo,
    'status_novo',     'Aguardando Confirmação'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.solicitar_fechamento_caixa(uuid, numeric, text) TO authenticated;


-- ── #3 RPC confirmar_fechamento_caixa (Financeiro / admin / gerente) ─
-- Promove 'Aguardando Confirmação' → 'Fechado'. Aceita observação extra
-- do Financeiro (anexa à observação do operador). Também aceita ajustar o
-- valor contado se Financeiro reconferir e divergir do que o operador
-- lançou.
CREATE OR REPLACE FUNCTION public.confirmar_fechamento_caixa(
  p_controle_id       uuid,
  p_observacao_extra  text    DEFAULT NULL,
  p_valor_reconferido numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caixa       public.controle_caixa;
  v_uid         uuid := auth.uid();
  v_nome        text;
  v_prof        public.user_profiles;
  v_autorizado  boolean := false;
  v_esperado    numeric(15,2);
  v_valor_final numeric(15,2);
  v_dif         numeric(15,2);
  v_tipo        text;
  v_obs_final   text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_caixa.status <> 'Aguardando Confirmação' THEN
    RAISE EXCEPTION 'Só é possível confirmar caixa em Aguardando Confirmação (estado atual: %).', v_caixa.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prof FROM public.user_profiles WHERE id = v_uid;
  v_autorizado :=
    v_prof.role IN ('admin','ceo')
    OR (v_prof.role = 'gerente' AND (v_prof.filial IS NULL OR v_prof.filial = v_caixa.filial))
    OR (v_prof.setor = 'financeiro' OR 'financeiro' = ANY(COALESCE(v_prof.setores_extras, ARRAY[]::text[])));
  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'Apenas Financeiro, gerente da filial, admin ou CEO podem confirmar o fechamento.'
      USING ERRCODE = 'P0001';
  END IF;

  v_esperado := COALESCE(v_caixa.valor_esperado, 0);
  v_valor_final := COALESCE(p_valor_reconferido, v_caixa.valor_fechamento);
  v_dif  := v_valor_final - v_esperado;
  v_tipo := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  v_obs_final := CASE
    WHEN p_observacao_extra IS NULL OR btrim(p_observacao_extra) = '' THEN v_caixa.observacao
    WHEN v_caixa.observacao IS NULL OR btrim(v_caixa.observacao) = '' THEN p_observacao_extra
    ELSE v_caixa.observacao || E'\n— Financeiro: ' || p_observacao_extra
  END;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status            = 'Fechado',
         valor_fechamento  = v_valor_final,
         diferenca         = v_dif,
         tipo_diferenca    = v_tipo,
         atualizado_por    = v_uid,
         updated_at        = now(),
         observacao        = v_obs_final,
         origem_fechamento = 'financeiro'
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_esperado', v_esperado,
    'valor_final',    v_valor_final,
    'diferenca',      v_dif,
    'tipo',           v_tipo,
    'confirmado_por', v_nome,
    'status_novo',    'Fechado'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_fechamento_caixa(uuid, text, numeric) TO authenticated;

COMMIT;

-- Recarrega cache do PostgREST pra as RPCs novas aparecerem sem restart.
NOTIFY pgrst, 'reload schema';
