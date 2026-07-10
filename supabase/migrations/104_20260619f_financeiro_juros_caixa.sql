-- =================================================================
-- Bloco Financeiro: juros + multa + sangria/suprimento + conferência de caixa
-- =================================================================
-- Cobertura:
--   1) Tabela `financeiro_config` (singleton) — % juros/dia, % multa,
--      carência. Editável só por admin/CEO/financeiro.
--   2) Função `calcular_valor_atualizado(p_tipo, p_id)` — calcula valor
--      atualizado de uma conta_receber ou conta_pagar com juros + multa
--      se vencida, retorna jsonb com breakdown.
--   3) Tabela `movimentacoes_caixa` — registra sangrias e suprimentos
--      ligados ao controle_caixa do dia.
--   4) Colunas em `controle_caixa`: `valor_fechamento`, `valor_esperado`,
--      `diferenca`, `tipo_diferenca` ('sobra'|'falta'|'exato') —
--      preenchidos pela RPC `fechar_caixa_conferido`.
--
-- Plataforma didática — sem compliance bancário real. Cálculo é
-- pedagógico, usuário aprende a relação parcela → atraso → juros.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. financeiro_config (singleton row id=1) ─────────────────────
CREATE TABLE IF NOT EXISTS public.financeiro_config (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  juros_dia_pct   numeric(8,4) NOT NULL DEFAULT 0.0333,  -- ~1% ao mês
  multa_pct       numeric(8,4) NOT NULL DEFAULT 2.0000,  -- 2% de multa
  carencia_dias   integer      NOT NULL DEFAULT 0,
  ativo           boolean      NOT NULL DEFAULT true,
  atualizado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO public.financeiro_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.financeiro_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fin_config_read"   ON public.financeiro_config;
DROP POLICY IF EXISTS "fin_config_update" ON public.financeiro_config;

-- Leitura livre (todos veem o valor pra exibir nas contas);
-- escrita só admin/CEO/financeiro.
CREATE POLICY "fin_config_read" ON public.financeiro_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "fin_config_update" ON public.financeiro_config
  FOR UPDATE TO authenticated
  USING      (auth_in_setor('financeiro'))
  WITH CHECK (auth_in_setor('financeiro'));

-- ─── 2. Função de cálculo de juros + multa ─────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_valor_atualizado(
  p_tipo text,   -- 'receber' | 'pagar'
  p_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg         public.financeiro_config;
  v_valor       numeric(15,2);
  v_venc        date;
  v_status      text;
  v_hoje        date := public.acre_today();
  v_dias_atraso integer;
  v_multa       numeric(15,2) := 0;
  v_juros       numeric(15,2) := 0;
  v_total       numeric(15,2);
BEGIN
  SELECT * INTO v_cfg FROM public.financeiro_config WHERE id = 1;

  IF p_tipo = 'receber' THEN
    SELECT valor, vencimento, status INTO v_valor, v_venc, v_status
      FROM public.contas_receber WHERE id = p_id;
  ELSIF p_tipo = 'pagar' THEN
    SELECT valor, vencimento, status INTO v_valor, v_venc, v_status
      FROM public.contas_pagar WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF v_valor IS NULL THEN
    RETURN jsonb_build_object('erro', 'Conta não encontrada');
  END IF;

  -- Já pago ou config desativada → não aplica juros.
  IF v_status = 'Pago' OR NOT COALESCE(v_cfg.ativo, false) OR v_venc IS NULL THEN
    RETURN jsonb_build_object(
      'valor_original', v_valor,
      'dias_atraso',    0,
      'multa',          0,
      'juros',          0,
      'total',          v_valor,
      'vencido',        false
    );
  END IF;

  v_dias_atraso := GREATEST(0, v_hoje - v_venc);

  -- Dentro da carência → sem juros nem multa
  IF v_dias_atraso <= v_cfg.carencia_dias THEN
    RETURN jsonb_build_object(
      'valor_original', v_valor,
      'dias_atraso',    v_dias_atraso,
      'multa',          0,
      'juros',          0,
      'total',          v_valor,
      'vencido',        v_dias_atraso > 0
    );
  END IF;

  v_multa := ROUND(v_valor * v_cfg.multa_pct / 100.0, 2);
  v_juros := ROUND(v_valor * v_cfg.juros_dia_pct / 100.0 * (v_dias_atraso - v_cfg.carencia_dias), 2);
  v_total := v_valor + v_multa + v_juros;

  RETURN jsonb_build_object(
    'valor_original', v_valor,
    'dias_atraso',    v_dias_atraso,
    'multa',          v_multa,
    'juros',          v_juros,
    'total',          v_total,
    'vencido',        true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcular_valor_atualizado(text, uuid) TO authenticated;

-- ─── 3. movimentacoes_caixa (sangria + suprimento) ─────────────────
CREATE TABLE IF NOT EXISTS public.movimentacoes_caixa (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controle_caixa_id uuid NOT NULL REFERENCES public.controle_caixa(id) ON DELETE CASCADE,
  tipo              text NOT NULL CHECK (tipo IN ('sangria', 'suprimento')),
  valor             numeric(15,2) NOT NULL CHECK (valor > 0),
  motivo            text,
  filial            text,
  criado_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mov_caixa_controle ON public.movimentacoes_caixa(controle_caixa_id);
CREATE INDEX IF NOT EXISTS idx_mov_caixa_created  ON public.movimentacoes_caixa(created_at DESC);

ALTER TABLE public.movimentacoes_caixa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mov_caixa_all" ON public.movimentacoes_caixa;
CREATE POLICY "mov_caixa_all" ON public.movimentacoes_caixa
  FOR ALL TO authenticated
  USING      (auth_in_setor('financeiro', 'vendas'))
  WITH CHECK (auth_in_setor('financeiro', 'vendas'));

-- Realtime opcional pra atualizar UI quando outro operador mexer
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'movimentacoes_caixa'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.movimentacoes_caixa;
  END IF;
END $$;

-- ─── 4. controle_caixa: colunas de conferência ─────────────────────
ALTER TABLE public.controle_caixa
  ADD COLUMN IF NOT EXISTS valor_fechamento numeric(15,2),
  ADD COLUMN IF NOT EXISTS valor_esperado   numeric(15,2),
  ADD COLUMN IF NOT EXISTS diferenca        numeric(15,2),
  ADD COLUMN IF NOT EXISTS tipo_diferenca   text CHECK (tipo_diferenca IN ('sobra','falta','exato'));

-- ─── 5. RPC fechar_caixa_conferido ─────────────────────────────────
-- Calcula esperado a partir da abertura + vendas dinheiro do dia +
-- suprimentos - sangrias. Compara com valor contado pelo operador.
-- Persiste diferença e marca status='Fechado'.
CREATE OR REPLACE FUNCTION public.fechar_caixa_conferido(
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
  IF v_caixa.status = 'Fechado' THEN
    RAISE EXCEPTION 'Caixa já fechado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_contado IS NULL OR p_valor_contado < 0 THEN
    RAISE EXCEPTION 'Valor contado inválido.' USING ERRCODE = 'P0001';
  END IF;

  -- Soma vendas em dinheiro do dia/filial. PDV grava forma_pagamento.
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
     SET status            = 'Fechado',
         valor_fechamento  = p_valor_contado,
         valor_esperado    = v_esperado,
         diferenca         = v_dif,
         tipo_diferenca    = v_tipo,
         fechado_por       = v_uid,
         fechado_por_nome  = v_nome,
         fechado_em        = now(),
         observacao        = COALESCE(p_observacao, observacao)
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

GRANT EXECUTE ON FUNCTION public.fechar_caixa_conferido(uuid, numeric, text) TO authenticated;

-- ─── 6. RPC registrar_movimentacao_caixa (sangria/suprimento) ──────
CREATE OR REPLACE FUNCTION public.registrar_movimentacao_caixa(
  p_controle_id uuid,
  p_tipo        text,
  p_valor       numeric,
  p_motivo      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caixa public.controle_caixa;
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_id    uuid;
BEGIN
  IF p_tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Tipo inválido (use sangria ou suprimento).' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_caixa.status = 'Fechado' THEN
    RAISE EXCEPTION 'Caixa fechado — operação não permitida.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.movimentacoes_caixa
    (controle_caixa_id, tipo, valor, motivo, filial, criado_por, criado_por_nome)
  VALUES
    (p_controle_id, p_tipo, p_valor, p_motivo, v_caixa.filial, v_uid, v_nome)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_movimentacao_caixa(uuid, text, numeric, text) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Como admin/financeiro:
--   UPDATE financeiro_config SET juros_dia_pct = 0.05, multa_pct = 2.0 WHERE id = 1;
--   SELECT calcular_valor_atualizado('receber', '<uuid-conta-vencida>');
--   SELECT registrar_movimentacao_caixa('<uuid-caixa>', 'sangria', 50, 'Banco');
--   SELECT fechar_caixa_conferido('<uuid-caixa>', 1234.56);
-- =================================================================
