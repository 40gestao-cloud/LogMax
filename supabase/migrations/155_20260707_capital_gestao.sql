-- =================================================================
-- Capital Gestão: configuração de período, empréstimos por filial,
-- parcelas, DRE e bloqueio de saldo.
-- =================================================================

BEGIN;

-- ── 1. Configuração de período de capital ─────────────────────────
CREATE TABLE IF NOT EXISTS public.capital_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_inicio       date NOT NULL,
  data_fim          date,                       -- null = sem prazo
  reserva_min_pct   numeric(5,2) NOT NULL DEFAULT 0 CHECK (reserva_min_pct >= 0 AND reserva_min_pct < 100),
  taxa_juros_padrao numeric(5,2) NOT NULL DEFAULT 0 CHECK (taxa_juros_padrao >= 0),
  criado_por        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  criado_por_nome   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_config_created ON public.capital_config(created_at DESC);

ALTER TABLE public.capital_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capital_config_select ON public.capital_config;
CREATE POLICY capital_config_select ON public.capital_config
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid()
      AND (p.role IN ('admin','ceo','conselheiro','gerente')
           OR p.setor = 'financeiro'
           OR 'financeiro' = ANY(p.setores_extras))
  ));

DROP POLICY IF EXISTS capital_config_insert ON public.capital_config;
CREATE POLICY capital_config_insert ON public.capital_config
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid()
      AND p.role IN ('admin','ceo')
  ));

DROP POLICY IF EXISTS capital_config_update ON public.capital_config;
CREATE POLICY capital_config_update ON public.capital_config
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid()
      AND p.role IN ('admin','ceo')
  ));

DROP POLICY IF EXISTS capital_config_delete ON public.capital_config;
CREATE POLICY capital_config_delete ON public.capital_config
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid()
      AND p.role IN ('admin','ceo')
  ));

-- ── 2. Empréstimos por filial ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emprestimos_filial (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial                text NOT NULL CHECK (filial IN ('SuperMax','MaxLook','TechMax')),
  valor                 numeric(15,2) NOT NULL CHECK (valor > 0),
  num_parcelas          int NOT NULL DEFAULT 1 CHECK (num_parcelas BETWEEN 1 AND 60),
  taxa_juros            numeric(5,2) NOT NULL DEFAULT 0 CHECK (taxa_juros >= 0),
  justificativa         text NOT NULL,
  banco_id              uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  banco_nome            text,
  status                text NOT NULL DEFAULT 'Pendente'
                          CHECK (status IN ('Pendente','Aprovado','Negado')),
  solicitado_por        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  solicitado_por_nome   text,
  aprovado_por          uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  aprovado_por_nome     text,
  justificativa_resposta text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emprestimos_filial_filial ON public.emprestimos_filial(filial, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emprestimos_filial_status ON public.emprestimos_filial(status);

ALTER TABLE public.emprestimos_filial ENABLE ROW LEVEL SECURITY;

-- Leitura: filial própria (gerente/financeiro) + admin/CEO/conselheiro (tudo)
DROP POLICY IF EXISTS emprestimos_select ON public.emprestimos_filial;
CREATE POLICY emprestimos_select ON public.emprestimos_filial
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin','ceo','conselheiro')
        OR (p.role = 'gerente' AND p.is_conselheiro = true)
        OR (p.filial = emprestimos_filial.filial
            AND p.role IN ('gerente'))
        OR (p.filial = emprestimos_filial.filial
            AND (p.setor = 'financeiro' OR 'financeiro' = ANY(p.setores_extras)))
      )
  ));

-- Inserção: gerente/financeiro da própria filial
DROP POLICY IF EXISTS emprestimos_insert ON public.emprestimos_filial;
CREATE POLICY emprestimos_insert ON public.emprestimos_filial
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid()
      AND p.filial = emprestimos_filial.filial
      AND p.role IN ('gerente','admin','ceo')
  ));

-- Update: admin/CEO/conselheiro (para aprovação/reprovação)
DROP POLICY IF EXISTS emprestimos_update ON public.emprestimos_filial;
CREATE POLICY emprestimos_update ON public.emprestimos_filial
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid()
      AND (p.role IN ('admin','ceo','conselheiro')
           OR (p.role = 'gerente' AND p.is_conselheiro = true))
  ));

-- ── 3. Parcelas de empréstimo ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parcelas_emprestimo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emprestimo_id   uuid NOT NULL REFERENCES public.emprestimos_filial(id) ON DELETE CASCADE,
  num_parcela     int NOT NULL,
  valor_parcela   numeric(15,2) NOT NULL CHECK (valor_parcela > 0),
  data_vencimento date NOT NULL,
  status          text NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente','Paga')),
  contas_pagar_id uuid REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcelas_emprestimo_emp ON public.parcelas_emprestimo(emprestimo_id);

ALTER TABLE public.parcelas_emprestimo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parcelas_select ON public.parcelas_emprestimo;
CREATE POLICY parcelas_select ON public.parcelas_emprestimo
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p
    JOIN public.emprestimos_filial e ON e.id = parcelas_emprestimo.emprestimo_id
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin','ceo','conselheiro')
        OR (p.role = 'gerente' AND p.is_conselheiro = true)
        OR p.filial = e.filial
      )
  ));

DROP POLICY IF EXISTS parcelas_insert ON public.parcelas_emprestimo;
CREATE POLICY parcelas_insert ON public.parcelas_emprestimo
  FOR INSERT TO authenticated
  WITH CHECK (true); -- controlado via RPC

DROP POLICY IF EXISTS parcelas_update ON public.parcelas_emprestimo;
CREATE POLICY parcelas_update ON public.parcelas_emprestimo
  FOR UPDATE TO authenticated
  USING (true); -- controlado via RPC

-- ── 4. RPC: calcular_saldo_capital ────────────────────────────────
-- Retorna saldo disponível por filial dentro do período ativo.
CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(p_filial text)
RETURNS TABLE (
  capital_total   numeric,
  despesas_pagas  numeric,
  receitas_pagas  numeric,
  reserva_valor   numeric,
  reserva_pct     numeric,
  saldo_livre     numeric,
  bloqueado       boolean,
  data_inicio     date,
  data_fim        date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg         RECORD;
  v_capital     numeric := 0;
  v_emprest     numeric := 0;
  v_despesas    numeric := 0;
  v_receitas    numeric := 0;
  v_reserva_pct numeric := 0;
  v_reserva_val numeric := 0;
  v_saldo       numeric := 0;
BEGIN
  -- Config ativa (a mais recente)
  SELECT * INTO v_cfg FROM public.capital_config
   ORDER BY created_at DESC LIMIT 1;

  -- Total de aportes de capital da filial
  SELECT COALESCE(SUM(valor), 0) INTO v_capital
    FROM public.capital_filial
   WHERE filial = p_filial
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Empréstimos aprovados
  SELECT COALESCE(SUM(valor), 0) INTO v_emprest
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND status = 'Aprovado'
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Despesas pagas no período
  SELECT COALESCE(SUM(cp.valor), 0) INTO v_despesas
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status = 'Pago'
     AND COALESCE(cp.ativo, true) = true
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Receitas recebidas no período
  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial AND cr.status = 'Recebido'
     AND COALESCE(cr.ativo, true) = true
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  v_reserva_pct := COALESCE(v_cfg.reserva_min_pct, 0);
  v_reserva_val := ROUND((v_capital + v_emprest) * v_reserva_pct / 100, 2);
  v_saldo := (v_capital + v_emprest) - v_despesas - v_reserva_val;

  RETURN QUERY SELECT
    (v_capital + v_emprest),
    v_despesas,
    v_receitas,
    v_reserva_val,
    v_reserva_pct,
    v_saldo,
    (v_saldo <= 0),
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_inicio ELSE CURRENT_DATE END,
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_fim ELSE NULL END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcular_saldo_capital(text) TO authenticated;

-- ── 5. RPC: aprovar_emprestimo ────────────────────────────────────
-- Aprova o empréstimo, gera parcelas e insere em contas_pagar.
CREATE OR REPLACE FUNCTION public.aprovar_emprestimo(
  p_emprestimo_id       uuid,
  p_banco_id            uuid,
  p_banco_nome          text,
  p_taxa_juros          numeric,
  p_num_parcelas        int,
  p_justificativa_resp  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp       RECORD;
  v_valor_par numeric;
  v_valor_tot numeric;
  i           int;
  v_venc      date;
  v_cp_id     uuid;
BEGIN
  SELECT * INTO v_emp FROM public.emprestimos_filial WHERE id = p_emprestimo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empréstimo não encontrado'; END IF;
  IF v_emp.status <> 'Pendente' THEN RAISE EXCEPTION 'Empréstimo já processado'; END IF;

  -- Valor com juros simples sobre o total
  v_valor_tot := ROUND(v_emp.valor * (1 + p_taxa_juros / 100), 2);
  v_valor_par := ROUND(v_valor_tot / p_num_parcelas, 2);

  -- Atualiza empréstimo
  UPDATE public.emprestimos_filial SET
    status                 = 'Aprovado',
    banco_id               = p_banco_id,
    banco_nome             = p_banco_nome,
    taxa_juros             = p_taxa_juros,
    num_parcelas           = p_num_parcelas,
    aprovado_por           = auth.uid(),
    aprovado_por_nome      = (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
    justificativa_resposta = p_justificativa_resp
  WHERE id = p_emprestimo_id;

  -- Gera parcelas + contas_pagar
  FOR i IN 1..p_num_parcelas LOOP
    v_venc := CURRENT_DATE + ((i) * interval '1 month');

    INSERT INTO public.contas_pagar (descricao, valor, vencimento, status, filial, origem)
    VALUES (
      'Parcela ' || i || '/' || p_num_parcelas || ' — Empréstimo ' || COALESCE(p_banco_nome, 'Banco'),
      v_valor_par,
      v_venc,
      'Pendente',
      v_emp.filial,
      'emprestimo'
    )
    RETURNING id INTO v_cp_id;

    INSERT INTO public.parcelas_emprestimo
      (emprestimo_id, num_parcela, valor_parcela, data_vencimento, contas_pagar_id)
    VALUES
      (p_emprestimo_id, i, v_valor_par, v_venc, v_cp_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aprovar_emprestimo(uuid,uuid,text,numeric,int,text) TO authenticated;

-- ── 6. RPC: negar_emprestimo ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.negar_emprestimo(
  p_emprestimo_id      uuid,
  p_justificativa_resp text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.emprestimos_filial SET
    status                 = 'Negado',
    aprovado_por           = auth.uid(),
    aprovado_por_nome      = (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
    justificativa_resposta = p_justificativa_resp
  WHERE id = p_emprestimo_id AND status = 'Pendente';
END;
$$;

GRANT EXECUTE ON FUNCTION public.negar_emprestimo(uuid,text) TO authenticated;

-- ── 7. Coluna `origem` em contas_pagar (se não existir) ───────────
ALTER TABLE public.contas_pagar ADD COLUMN IF NOT EXISTS origem text;

COMMIT;
