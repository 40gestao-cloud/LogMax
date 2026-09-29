-- 657_20260928_taxa_pelo_mix_e_frete_no_custo.sql
--
-- Fase 2 da formação de preço (656). Duas peças:
--
-- ── 1. TAXA DE CARTÃO PELO MIX DE VENDAS ────────────────────────────────────
--
-- A 656 media a taxa pelo que a adquirente RETEVE na conciliação. É o número
-- realizado, mas chega atrasado (só depois de conciliar) e some quando a turma
-- não concilia — aí o preço saía sem taxa nenhuma.
--
-- Preço se forma com a taxa ESPERADA: quanto a loja vende em cada forma de
-- pagamento × a taxa que o cadastro diz que cada uma cobra.
--
--   taxa% = Σ (receita da forma × taxa da forma) ÷ receita
--
-- O elo entre a venda e o cadastro precisa ser estruturado. A venda do PDV
-- grava um valor fixo ('Cartão Crédito', 'PIX'…), e o cadastro de formas é
-- texto livre por filial ("cartão de credito parcelado", "voucher(Beneficios)").
-- Casar os dois pelo texto é a armadilha da migr. 562. Então o cadastro ganha
-- `tipo`, uma lista fechada que o aluno classifica — e classificar é a aula.
-- A migração sugere o tipo das linhas que já existem (uma vez, à vista, e
-- editável); o que não casa com clareza fica em branco.
--
-- Crédito parcelado se reconhece pelos títulos: venda com mais de um título a
-- receber. Dinheiro e crediário da loja não têm taxa de adquirente, com ou sem
-- cadastro. Venda mista fica fora do mix (a divisão entre as formas só existe
-- como texto) e a tela diz quanto ficou fora.
--
-- O realizado (conciliação) continua sendo mostrado ao lado, para comparar.
--
-- ── 2. FRETE DE TRANSPORTADORA NO CUSTO ─────────────────────────────────────
--
-- A 645 levou ao custo o frete que vem NA NOTA do fornecedor. O frete FOB
-- chega em outro documento: o CT-e da transportadora, com cobrança própria e,
-- muitas vezes, cobrindo a carga de vários pedidos de uma vez.
--
--   `lancar_frete_compra` registra o CT-e, cria a conta a pagar da
--   transportadora (natureza 'estoque': frete de compra é custo da mercadoria,
--   não despesa do mês) e RATEIA o valor entre os pedidos pelo valor de cada
--   um (o da nota conferida; sem nota, o do pedido).
--
--   O rateio chega ao custo pela MESMA régua da 645: `_ajustar_custo_pela_nota`
--   passa a somar o frete rateado ao que a nota cobrou. A parte da carga ainda
--   em estoque reprecifica o custo médio; a já vendida vai para o CMV do mês.
--   Incremental como antes: cancelar o frete devolve o ajuste.
--
--   A conta do frete não muda de valor por fora, e excluí-la cancela o frete
--   (o custo volta). Conta paga não se exclui — régua que já existia.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ════ 1. Taxa pelo mix ═══════════════════════════════════════════════════════

ALTER TABLE public.formas_pagamento ADD COLUMN IF NOT EXISTS tipo text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'formas_pagamento_tipo_check') THEN
    ALTER TABLE public.formas_pagamento
      ADD CONSTRAINT formas_pagamento_tipo_check CHECK (tipo IS NULL OR tipo IN (
        'Dinheiro', 'PIX', 'Cartão de débito', 'Cartão de crédito à vista',
        'Cartão de crédito parcelado', 'Vale / voucher', 'Crediário da loja',
        'Boleto', 'Transferência', 'Outro'));
  END IF;
END $$;

COMMENT ON COLUMN public.formas_pagamento.tipo IS
  'Classificação estruturada da forma (migr. 657). É por ela que a venda do PDV encontra a taxa no cadastro para a taxa média da precificação.';

-- Corpo copiado do banco; entra a última linha (GenericCRUDView manda '' no "Selecione").
CREATE OR REPLACE FUNCTION public.fn_formas_pagamento_normaliza()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.parcelas_max       := GREATEST(1, COALESCE(NEW.parcelas_max, 1));
  NEW.parcelas_sem_juros := GREATEST(1, COALESCE(NEW.parcelas_sem_juros, 1));
  NEW.intervalo_dias     := GREATEST(1, COALESCE(NEW.intervalo_dias, 30));
  NEW.prazo              := GREATEST(0, COALESCE(NEW.prazo, 0));
  NEW.taxa               := GREATEST(0, COALESCE(NEW.taxa, 0));
  NEW.desconto_percentual := GREATEST(0, COALESCE(NEW.desconto_percentual, 0));
  NEW.juros_mensal        := GREATEST(0, COALESCE(NEW.juros_mensal, 0));
  NEW.tipo                := NULLIF(btrim(COALESCE(NEW.tipo, '')), '');
  RETURN NEW;
END;
$function$;

-- Sugestão única para o que já estava cadastrado. Só o que casa sem dúvida.
UPDATE public.formas_pagamento f
   SET tipo = s.tipo
  FROM (
    SELECT id,
      CASE
        WHEN exige_limite_credito OR descricao ~* 'credi[aá]rio'                   THEN 'Crediário da loja'
        WHEN descricao ~* 'cr[eé]dit' AND (descricao ~* 'parcel' OR descricao ~* '\m([2-9]|1[0-2])\s*x') THEN 'Cartão de crédito parcelado'
        WHEN descricao ~* 'cr[eé]dit'                                              THEN 'Cartão de crédito à vista'
        WHEN descricao ~* 'd[eé]bit'                                               THEN 'Cartão de débito'
        WHEN descricao ~* '\mpix\M'                                                THEN 'PIX'
        WHEN descricao ~* 'dinheiro|esp[eé]cie'                                    THEN 'Dinheiro'
        WHEN descricao ~* 'boleto'                                                 THEN 'Boleto'
        WHEN descricao ~* 'transfer|\mted\M|\mdoc\M'                               THEN 'Transferência'
        WHEN descricao ~* 'voucher|vale|benef'                                     THEN 'Vale / voucher'
      END AS tipo
      FROM public.formas_pagamento
  ) s
 WHERE f.id = s.id AND f.tipo IS NULL AND s.tipo IS NOT NULL;

-- Taxa esperada pelo mix de vendas da janela.
CREATE OR REPLACE FUNCTION public._taxa_pelo_mix(p_filial text, p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT v.id,
           v.total - COALESCE(v.desconto, 0) - COALESCE(v.cupom_desconto, 0) AS receita,
           CASE v.forma_pagamento
             WHEN 'Dinheiro'         THEN 'Dinheiro'
             WHEN 'PIX'              THEN 'PIX'
             WHEN 'Cartão Débito'    THEN 'Cartão de débito'
             WHEN 'Cartão Crédito'   THEN
               CASE WHEN (SELECT count(*) FROM public.contas_receber cr
                           WHERE cr.venda_id = v.id AND COALESCE(cr.ativo, true)) > 1
                    THEN 'Cartão de crédito parcelado' ELSE 'Cartão de crédito à vista' END
             WHEN 'Fiado'            THEN 'Crediário da loja'
             WHEN 'Vale-Alimentação' THEN 'Vale / voucher'
           END AS tipo
      FROM public.vendas v
     WHERE v.ativo = true
       AND v.filial = p_filial
       AND v.status <> 'Cancelada'
       AND v.created_at::date BETWEEN p_inicio AND p_fim
  ), cad AS (
    SELECT f.tipo, ROUND(AVG(f.taxa), 3) AS taxa
      FROM public.formas_pagamento f
     WHERE f.filial = p_filial
       AND COALESCE(f.ativo, true)
       AND COALESCE(f.status, 'Ativo') <> 'Inativo'
       AND f.tipo IS NOT NULL
     GROUP BY f.tipo
  ), t AS (
    SELECT v.tipo, SUM(v.receita) AS receita
      FROM v WHERE v.tipo IS NOT NULL
     GROUP BY v.tipo
  ), tt AS (
    SELECT t.tipo, t.receita,
           COALESCE(
             c.taxa,
             -- Parcelado sem linha própria no cadastro usa a do crédito à vista.
             CASE WHEN t.tipo = 'Cartão de crédito parcelado'
                  THEN (SELECT c2.taxa FROM cad c2 WHERE c2.tipo = 'Cartão de crédito à vista') END,
             -- Dinheiro e crediário não passam por adquirente.
             CASE WHEN t.tipo IN ('Dinheiro', 'Crediário da loja') THEN 0 END
           ) AS taxa
      FROM t LEFT JOIN cad c ON c.tipo = t.tipo
  ), tot AS (
    SELECT COALESCE(SUM(receita), 0) AS base FROM tt
  )
  SELECT jsonb_build_object(
    'base',       (SELECT base FROM tot),
    'fora',       COALESCE((SELECT SUM(receita) FROM v WHERE v.tipo IS NULL), 0),
    'taxa_pct',   CASE WHEN (SELECT base FROM tot) > 0
                       THEN ROUND(COALESCE((SELECT SUM(receita * COALESCE(taxa, 0)) FROM tt), 0) / (SELECT base FROM tot), 2) END,
    'itens',      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'tipo', tt.tipo,
                    'participacao_pct', ROUND(100 * tt.receita / NULLIF((SELECT base FROM tot), 0), 1),
                    'taxa_pct', tt.taxa) ORDER BY tt.receita DESC) FROM tt), '[]'::jsonb),
    'sem_cadastro', COALESCE((SELECT jsonb_agg(tt.tipo ORDER BY tt.receita DESC) FROM tt WHERE tt.taxa IS NULL), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public._taxa_pelo_mix(text, date, date) FROM public, anon, authenticated;

-- parametros_precificacao (656) com a taxa pelo mix. Corpo da 656; as linhas
-- novas estão marcadas MIGR 657.
CREATE OR REPLACE FUNCTION public.parametros_precificacao(p_filial text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje       date := public.acre_today();
  v_mes        date := date_trunc('month', public.acre_today())::date;
  -- Janela: os 3 últimos meses FECHADOS. O mês corrente distorce — a
  -- despesa do mês entra de uma vez (aluguel no dia 5) e a venda vem aos poucos.
  v_ini        date := (date_trunc('month', public.acre_today()) - interval '3 months')::date;
  v_fim        date := (date_trunc('month', public.acre_today()) - interval '1 day')::date;
  v_cfg        public.filial_precificacao%ROWTYPE;
  v_rbt12      numeric;
  v_rbt_origem text;
  v_rbt_meses  integer;
  v_faixa      integer;
  v_nominal    numeric;
  v_deduzir    numeric;
  v_efetiva    numeric;
  v_base       numeric;
  v_taxas_hist numeric := 0;
  v_desp_hist  numeric;
  v_desp_pct   numeric;
  v_desp_orig  text;
  v_taxa_pct   numeric;
  v_taxa_orig  text;
  v_gestor     boolean;
  v_mix        jsonb;   -- MIGR 657
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Parâmetros de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Quem abre o DRE vê os valores em reais e edita; os demais veem só os
  -- percentuais, que é o que o cadastro de produto precisa.
  v_gestor := COALESCE(public.auth_in_setor('financeiro'), false)
           OR COALESCE(public.auth_gerente_da(p_filial), false);

  SELECT * INTO v_cfg FROM public.filial_precificacao WHERE filial = p_filial;

  SELECT r.rbt12, r.origem, r.meses INTO v_rbt12, v_rbt_origem, v_rbt_meses
    FROM public._simples_rbt12(p_filial, v_mes) r;
  SELECT a.faixa, a.aliquota_nominal, a.parcela_deduzir, a.aliquota_efetiva
    INTO v_faixa, v_nominal, v_deduzir, v_efetiva
    FROM public.simples_anexo_i(v_rbt12) a;

  v_base := public._receita_simples(p_filial, v_ini, v_fim);

  IF v_base > 0 THEN
    SELECT COALESCE(SUM(cp.valor), 0) INTO v_taxas_hist
      FROM public.contas_pagar cp
     WHERE cp.ativo = true
       AND cp.filial = p_filial
       AND cp.status <> 'Cancelado'
       AND cp.origem = 'conciliacao_maquininha'
       AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN v_ini AND v_fim;
    v_desp_hist := (public._dre_calculo(p_filial, v_ini, v_fim) ->> 'despesas')::numeric - v_taxas_hist;
  END IF;

  IF v_cfg.despesas_pct_manual IS NOT NULL THEN
    v_desp_pct := v_cfg.despesas_pct_manual; v_desp_orig := 'manual';
  ELSIF v_base > 0 THEN
    v_desp_pct := ROUND(100 * GREATEST(v_desp_hist, 0) / v_base, 2); v_desp_orig := 'historico';
  ELSE
    v_desp_orig := 'sem_historico';
  END IF;

  -- MIGR 657: a taxa é a ESPERADA pelo mix de vendas × cadastro. O que a
  -- conciliação reteve vai junto, como conferência (`taxas_realizada_pct`).
  v_mix := public._taxa_pelo_mix(p_filial, v_ini, v_fim);

  IF v_cfg.taxas_pct_manual IS NOT NULL THEN
    v_taxa_pct := v_cfg.taxas_pct_manual; v_taxa_orig := 'manual';
  ELSIF (v_mix ->> 'taxa_pct') IS NOT NULL THEN
    v_taxa_pct := (v_mix ->> 'taxa_pct')::numeric; v_taxa_orig := 'mix';
  ELSE
    v_taxa_orig := 'sem_historico';
  END IF;

  RETURN jsonb_build_object(
    'filial',           p_filial,
    'regime',           COALESCE(v_cfg.regime, 'simples_anexo_i'),
    'rbt12',            CASE WHEN v_gestor THEN v_rbt12 END,
    'rbt12_origem',     v_rbt_origem,
    'rbt12_meses',      v_rbt_meses,
    'faixa',            v_faixa,
    'aliquota_nominal', v_nominal,
    'parcela_deduzir',  v_deduzir,
    'aliquota_efetiva', v_efetiva,
    'acima_do_teto',    COALESCE(v_rbt12, 0) > 4800000,
    'despesas_pct',     v_desp_pct,
    'despesas_origem',  v_desp_orig,
    'taxas_pct',        v_taxa_pct,
    'taxas_origem',     v_taxa_orig,
    -- MIGR 657
    'taxas_mix',        v_mix -> 'itens',
    'taxas_sem_cadastro', v_mix -> 'sem_cadastro',
    'taxas_fora_mix_pct', CASE WHEN ((v_mix ->> 'base')::numeric + (v_mix ->> 'fora')::numeric) > 0
                               THEN ROUND(100 * (v_mix ->> 'fora')::numeric
                                          / ((v_mix ->> 'base')::numeric + (v_mix ->> 'fora')::numeric), 1) END,
    'taxas_realizada_pct', CASE WHEN v_base > 0 THEN ROUND(100 * v_taxas_hist / v_base, 2) END,
    'janela_inicio',    v_ini,
    'janela_fim',       v_fim,
    'pode_editar',      v_gestor,
    'manual',           CASE WHEN v_gestor THEN jsonb_build_object(
                          'rbt12',        v_cfg.rbt12_manual,
                          'despesas_pct', v_cfg.despesas_pct_manual,
                          'taxas_pct',    v_cfg.taxas_pct_manual) END,
    'atualizado_em',    v_cfg.updated_at
  );
END;
$function$;

-- ════ 2. Frete de transportadora ═════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fretes_compra (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial            text NOT NULL,
  transportadora_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  cte_numero        text NOT NULL,
  emissao           date NOT NULL,
  valor             numeric(15,2) NOT NULL CHECK (valor > 0),
  -- CASCADE: o reset por filial apaga a conta com DELETE, e o frete vai junto.
  -- No app a conta só é inativada, e aí quem age é o gatilho da conta.
  conta_pagar_id    uuid REFERENCES public.contas_pagar(id) ON DELETE CASCADE,
  ativo             boolean NOT NULL DEFAULT true,
  cancelado_em      timestamptz,
  cancelado_por     uuid,
  motivo_cancelamento text,
  criado_por        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fretes_compra_cte
  ON public.fretes_compra (filial, transportadora_id, cte_numero) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_fretes_compra_conta ON public.fretes_compra (conta_pagar_id);

CREATE TABLE IF NOT EXISTS public.fretes_compra_rateio (
  frete_id  uuid NOT NULL REFERENCES public.fretes_compra(id) ON DELETE CASCADE,
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  filial    text NOT NULL,
  base      numeric(15,2) NOT NULL,
  valor     numeric(15,2) NOT NULL,
  PRIMARY KEY (frete_id, pedido_id)
);
CREATE INDEX IF NOT EXISTS idx_fretes_rateio_pedido ON public.fretes_compra_rateio (pedido_id);

COMMENT ON TABLE public.fretes_compra IS
  'CT-e de transportadora sobre compras (migr. 657). Escrito só por lancar_frete_compra / _cancelar_frete_compra.';
COMMENT ON TABLE public.fretes_compra_rateio IS
  'Parte do frete de cada pedido, pelo valor. Somada à nota em _ajustar_custo_pela_nota.';

ALTER TABLE public.fretes_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fretes_compra_rateio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fretes_compra, public.fretes_compra_rateio FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.fretes_compra, public.fretes_compra_rateio FROM authenticated;
GRANT SELECT ON TABLE public.fretes_compra, public.fretes_compra_rateio TO authenticated;

DROP POLICY IF EXISTS fretes_compra_select ON public.fretes_compra;
CREATE POLICY fretes_compra_select ON public.fretes_compra
  FOR SELECT TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text, 'logistica'::text, 'estoque'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

DROP POLICY IF EXISTS fretes_rateio_select ON public.fretes_compra_rateio;
CREATE POLICY fretes_rateio_select ON public.fretes_compra_rateio
  FOR SELECT TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text, 'logistica'::text, 'estoque'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

-- A régua da 645 com o frete. Corpo copiado do banco; linhas novas marcadas.
CREATE OR REPLACE FUNCTION public._ajustar_custo_pela_nota(p_pedido_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ped       public.pedidos;
  v_nf        numeric;
  v_qtd_conf  numeric;
  v_encerrado boolean;
  v_base      numeric;
  v_unit_ped  numeric(15,4);
  v_unit_nf   numeric(15,4);
  v_ja        numeric;
  v_delta     numeric(15,2);
  v_est       numeric;
  v_tipo      text;
  v_no_est    numeric;
  v_d_est     numeric(15,2);
  v_d_res     numeric(15,2);
  v_custo     numeric;
  v_frete     numeric(15,2);  -- MIGR 657
  v_unit_real numeric(15,4);  -- MIGR 657
BEGIN
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id;
  -- Serviço não tem estoque nem custo médio; pedido sem valor não tem preço.
  IF v_ped.id IS NULL OR v_ped.produto_id IS NULL
     OR COALESCE(v_ped.item_qtd, 0) <= 0 OR COALESCE(v_ped.valor_total, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT max(cp.nf_valor) INTO v_nf
    FROM public.contas_pagar cp
   WHERE cp.pedido_id = p_pedido_id
     AND COALESCE(cp.ativo, true)
     AND cp.nf_conferida_em IS NOT NULL;

  -- MIGR 657: frete de transportadora rateado para este pedido.
  SELECT COALESCE(sum(fr.valor), 0) INTO v_frete
    FROM public.fretes_compra_rateio fr
    JOIN public.fretes_compra f ON f.id = fr.frete_id AND f.ativo
   WHERE fr.pedido_id = p_pedido_id;

  -- MIGR 657: sem nota conferida E sem frete não há o que ajustar. Com frete
  -- e sem nota, a mercadoria vale o preço do pedido e o frete entra sozinho.
  IF COALESCE(v_nf, 0) <= 0 AND v_frete = 0 THEN
    -- Frete cancelado depois de já ter entrado no custo: o ajuste tem de voltar.
    IF NOT EXISTS (SELECT 1 FROM public.ajustes_custo_compra a WHERE a.pedido_id = p_pedido_id) THEN
      RETURN 0;
    END IF;
  END IF;

  SELECT COALESCE(sum(r.qtd_recebida), 0), COALESCE(bool_or(r.encerrado_com_saldo), false)
    INTO v_qtd_conf, v_encerrado
    FROM public.recebimentos r
   WHERE r.pedido_id = p_pedido_id
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Concluído', 'Parcial');
  IF v_qtd_conf <= 0 THEN
    RETURN 0;
  END IF;

  v_base     := CASE WHEN v_encerrado THEN v_qtd_conf ELSE v_ped.item_qtd END;
  -- O mesmo arredondamento de fn_custo_medio_da_entrada: é por esse unitário
  -- que as cargas entraram no custo médio.
  v_unit_ped := ROUND(v_ped.valor_total / v_ped.item_qtd, 4);
  -- MIGR 657: sem nota conferida, a mercadoria fica no preço do pedido.
  v_unit_nf  := CASE WHEN COALESCE(v_nf, 0) > 0 THEN ROUND(v_nf / v_base, 4) ELSE v_unit_ped END;
  -- MIGR 657: o frete se espalha pelo que chegou (é o que ele transportou).
  v_unit_real := ROUND(v_unit_nf + v_frete / v_qtd_conf, 4);

  SELECT COALESCE(sum(a.valor_estoque + a.valor_resultado), 0) INTO v_ja
    FROM public.ajustes_custo_compra a
   WHERE a.pedido_id = p_pedido_id;

  -- MIGR 657: + v_frete
  v_delta := ROUND((v_unit_nf - v_unit_ped) * v_qtd_conf + v_frete - v_ja, 2);
  IF abs(v_delta) < 0.01 THEN
    RETURN 0;
  END IF;

  SELECT p.estoque, p.tipo INTO v_est, v_tipo
    FROM public.produtos p WHERE p.id = v_ped.produto_id FOR UPDATE;

  v_no_est := LEAST(GREATEST(COALESCE(v_est, 0), 0), v_qtd_conf);
  v_d_est  := ROUND(v_delta * v_no_est / v_qtd_conf, 2);
  v_d_res  := v_delta - v_d_est;

  IF v_d_est <> 0 AND COALESCE(v_est, 0) > 0 THEN
    SELECT pc.preco_custo INTO v_custo
      FROM public.produtos_custo pc WHERE pc.produto_id = v_ped.produto_id;
    INSERT INTO public.produtos_custo AS pc
      (produto_id, preco_custo, origem, ultima_compra_em, ultimo_custo_compra, updated_at)
    VALUES (
      v_ped.produto_id,
      GREATEST(ROUND((v_est * COALESCE(v_custo, v_unit_ped) + v_d_est) / v_est, 4), 0),
      'compra', public.acre_today(), v_unit_real, now()
    )
    ON CONFLICT (produto_id) DO UPDATE
      SET preco_custo         = EXCLUDED.preco_custo,
          origem              = 'compra',
          ultimo_custo_compra = EXCLUDED.ultimo_custo_compra,
          updated_at          = now();
  END IF;

  INSERT INTO public.ajustes_custo_compra
    (pedido_id, produto_id, filial, qtd_conferida, custo_pedido, custo_nota,
     valor_estoque, valor_resultado, destino)
  VALUES
    (p_pedido_id, v_ped.produto_id, v_ped.filial, v_qtd_conf, v_unit_ped, v_unit_real,
     v_d_est, v_d_res, CASE WHEN v_tipo = 'consumo' THEN 'despesa' ELSE 'cmv' END);

  RETURN v_delta;
END;
$$;

REVOKE ALL ON FUNCTION public._ajustar_custo_pela_nota(uuid) FROM public, anon, authenticated;

-- Pedidos que podem receber frete: mercadoria da filial com carga conferida.
CREATE OR REPLACE FUNCTION public.pedidos_para_frete(p_filial text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc('financeiro');
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Pedidos de outra filial.' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.recebido_em DESC NULLS LAST, x.numero)
      FROM (
        SELECT p.id,
               COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6))) AS numero,
               p.item_descricao,
               fo.nome AS fornecedor,
               p.recebido_em,
               (SELECT sum(r.qtd_recebida) FROM public.recebimentos r
                 WHERE r.pedido_id = p.id AND COALESCE(r.ativo, true)
                   AND r.status IN ('Concluído', 'Parcial')) AS qtd_recebida,
               COALESCE((SELECT max(cp.nf_valor) FROM public.contas_pagar cp
                          WHERE cp.pedido_id = p.id AND COALESCE(cp.ativo, true)
                            AND cp.nf_conferida_em IS NOT NULL), p.valor_total) AS valor_base,
               EXISTS (SELECT 1 FROM public.contas_pagar cp
                        WHERE cp.pedido_id = p.id AND COALESCE(cp.ativo, true)
                          AND cp.nf_conferida_em IS NOT NULL) AS nota_conferida,
               COALESCE((SELECT sum(fr.valor) FROM public.fretes_compra_rateio fr
                          JOIN public.fretes_compra f ON f.id = fr.frete_id AND f.ativo
                         WHERE fr.pedido_id = p.id), 0) AS frete_ja
          FROM public.pedidos p
          LEFT JOIN public.fornecedores fo ON fo.id = p.fornecedor_id
         WHERE p.filial = p_filial
           AND COALESCE(p.ativo, true)
           AND p.produto_id IS NOT NULL
           AND COALESCE(p.valor_total, 0) > 0
           AND EXISTS (SELECT 1 FROM public.recebimentos r
                        WHERE r.pedido_id = p.id AND COALESCE(r.ativo, true)
                          AND r.status IN ('Concluído', 'Parcial')
                          AND r.data >= public.acre_today() - 120)
      ) x
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.pedidos_para_frete(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pedidos_para_frete(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.lancar_frete_compra(
  p_filial            text,
  p_transportadora_id uuid,
  p_cte_numero        text,
  p_emissao           date,
  p_vencimento        date,
  p_valor             numeric,
  p_pedidos           uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cte     text := NULLIF(btrim(COALESCE(p_cte_numero, '')), '');
  v_valor   numeric(15,2) := ROUND(COALESCE(p_valor, 0), 2);
  v_transp  text;
  v_n       integer;
  v_ok      integer;
  v_total   numeric(15,2);
  v_frete   uuid;
  v_conta   uuid;
  v_acum    numeric(15,2) := 0;
  v_i       integer := 0;
  v_parte   numeric(15,2);
  v_nums    text;
  v_r       record;
  v_rateio  jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._assert_rpc('financeiro');
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Frete de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF v_cte IS NULL THEN
    RAISE EXCEPTION 'Informe o número do CT-e.' USING ERRCODE = 'P0001';
  END IF;
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'Informe o valor do frete.' USING ERRCODE = 'P0001';
  END IF;
  IF p_emissao IS NULL OR p_emissao > public.acre_today() THEN
    RAISE EXCEPTION 'A emissão do CT-e não pode ser vazia nem futura.' USING ERRCODE = 'P0001';
  END IF;
  IF p_vencimento IS NOT NULL AND p_vencimento < p_emissao THEN
    RAISE EXCEPTION 'O vencimento não pode ser anterior à emissão.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_transp FROM public.fornecedores
   WHERE id = p_transportadora_id AND COALESCE(ativo, true) AND excluido_em IS NULL;
  IF v_transp IS NULL THEN
    RAISE EXCEPTION 'Escolha a transportadora (cadastrada em Fornecedores).' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.fretes_compra
              WHERE filial = p_filial AND transportadora_id = p_transportadora_id
                AND cte_numero = v_cte AND ativo) THEN
    RAISE EXCEPTION 'O CT-e % de % já foi lançado.', v_cte, v_transp USING ERRCODE = 'P0001';
  END IF;

  p_pedidos := ARRAY(SELECT DISTINCT x FROM unnest(p_pedidos) x WHERE x IS NOT NULL);
  v_n := COALESCE(array_length(p_pedidos, 1), 0);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Marque os pedidos que vieram nesta carga.' USING ERRCODE = 'P0001';
  END IF;

  -- Trava os pedidos em ordem fixa (duas pessoas lançando frete ao mesmo tempo).
  PERFORM 1 FROM public.pedidos WHERE id = ANY (p_pedidos) ORDER BY id FOR UPDATE;

  SELECT count(*) INTO v_ok
    FROM public.pedidos p
   WHERE p.id = ANY (p_pedidos)
     AND p.filial = p_filial
     AND COALESCE(p.ativo, true)
     AND p.produto_id IS NOT NULL
     AND COALESCE(p.valor_total, 0) > 0
     AND EXISTS (SELECT 1 FROM public.recebimentos r
                  WHERE r.pedido_id = p.id AND COALESCE(r.ativo, true)
                    AND r.status IN ('Concluído', 'Parcial'));
  IF v_ok <> v_n THEN
    RAISE EXCEPTION 'Só entra no frete pedido de mercadoria desta filial com a carga já conferida no Estoque.'
      USING ERRCODE = 'P0001';
  END IF;

  DROP TABLE IF EXISTS _frete_base;
  CREATE TEMP TABLE _frete_base ON COMMIT DROP AS
    SELECT p.id AS pedido_id,
           COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6))) AS numero,
           COALESCE((SELECT max(cp.nf_valor) FROM public.contas_pagar cp
                      WHERE cp.pedido_id = p.id AND COALESCE(cp.ativo, true)
                        AND cp.nf_conferida_em IS NOT NULL), p.valor_total)::numeric(15,2) AS base
      FROM public.pedidos p
     WHERE p.id = ANY (p_pedidos);

  SELECT sum(base), string_agg(numero, ', ' ORDER BY numero) INTO v_total, v_nums FROM _frete_base;

  INSERT INTO public.fretes_compra (filial, transportadora_id, cte_numero, emissao, valor)
  VALUES (p_filial, p_transportadora_id, v_cte, p_emissao, v_valor)
  RETURNING id INTO v_frete;

  -- A conta da transportadora. Natureza 'estoque': o frete de compra é custo
  -- da mercadoria e chega ao resultado pelo CMV, não como despesa do mês.
  PERFORM set_config('app.frete_compra', 'true', true);
  INSERT INTO public.contas_pagar
    (descricao, valor, vencimento, status, fornecedor_id, filial, natureza, origem)
  VALUES (
    format('Frete CT-e %s — %s (%s)', v_cte, v_transp, v_nums),
    v_valor, COALESCE(p_vencimento, p_emissao + 30), 'Pendente',
    p_transportadora_id, p_filial, 'estoque', 'frete_compra'
  )
  RETURNING id INTO v_conta;
  PERFORM set_config('app.frete_compra', '', true);

  UPDATE public.fretes_compra SET conta_pagar_id = v_conta WHERE id = v_frete;

  -- Rateio pelo valor; o último leva o arredondamento.
  FOR v_r IN SELECT * FROM _frete_base ORDER BY pedido_id LOOP
    v_i := v_i + 1;
    v_parte := CASE WHEN v_i < v_n THEN ROUND(v_valor * v_r.base / v_total, 2) ELSE v_valor - v_acum END;
    v_acum := v_acum + v_parte;
    INSERT INTO public.fretes_compra_rateio (frete_id, pedido_id, filial, base, valor)
    VALUES (v_frete, v_r.pedido_id, p_filial, v_r.base, v_parte);
    PERFORM public._ajustar_custo_pela_nota(v_r.pedido_id);
    v_rateio := v_rateio || jsonb_build_object('pedido', v_r.numero, 'base', v_r.base, 'frete', v_parte);
  END LOOP;

  RETURN jsonb_build_object('frete_id', v_frete, 'conta_pagar_id', v_conta, 'rateio', v_rateio);
END;
$function$;

REVOKE ALL ON FUNCTION public.lancar_frete_compra(text, uuid, text, date, date, numeric, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lancar_frete_compra(text, uuid, text, date, date, numeric, uuid[]) TO authenticated;

-- Desfaz o frete: inativa, devolve o ajuste de custo. Sem guarda — quem chama
-- (a RPC abaixo ou o gatilho da conta) já passou pelas suas.
CREATE OR REPLACE FUNCTION public._cancelar_frete_compra(p_frete_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r record;
BEGIN
  UPDATE public.fretes_compra
     SET ativo = false, cancelado_em = now(), cancelado_por = auth.uid(),
         motivo_cancelamento = NULLIF(btrim(COALESCE(p_motivo, '')), '')
   WHERE id = p_frete_id AND ativo;
  IF NOT FOUND THEN RETURN; END IF;

  FOR v_r IN SELECT pedido_id FROM public.fretes_compra_rateio
            WHERE frete_id = p_frete_id ORDER BY pedido_id LOOP
    PERFORM public._ajustar_custo_pela_nota(v_r.pedido_id);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public._cancelar_frete_compra(uuid, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancelar_frete_compra(p_conta_id uuid, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conta public.contas_pagar;
  v_frete uuid;
BEGIN
  PERFORM public._assert_rpc('financeiro');
  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id FOR UPDATE;
  IF v_conta.id IS NULL OR v_conta.origem IS DISTINCT FROM 'frete_compra' THEN
    RAISE EXCEPTION 'Esta conta não é de frete.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_conta.filial), false) THEN
    RAISE EXCEPTION 'Frete de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_conta.status IN ('Pago', 'Parcial') OR COALESCE(v_conta.valor_pago, 0) > 0 THEN
    RAISE EXCEPTION 'O frete já foi pago (total ou parte). Cancelar agora apagaria o que saiu do caixa — resolva com a transportadora.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_frete FROM public.fretes_compra WHERE conta_pagar_id = p_conta_id AND ativo;
  PERFORM public._cancelar_frete_compra(v_frete, p_motivo);

  PERFORM set_config('app.frete_compra', 'true', true);
  UPDATE public.contas_pagar SET ativo = false, status = 'Cancelado' WHERE id = p_conta_id;
  PERFORM set_config('app.frete_compra', '', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_frete_compra(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_frete_compra(uuid, text) TO authenticated;

-- Conta de frete: nasce só pela RPC, não muda de valor por fora, e inativá-la
-- cancela o frete (o custo volta). Excluir continua barrado para conta paga
-- por `conta_com_dinheiro_nao_exclui`.
CREATE OR REPLACE FUNCTION public.fn_conta_de_frete_congela()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.frete_compra', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.origem = 'frete_compra' THEN
      RAISE EXCEPTION 'Conta de frete nasce em "Frete (CT-e)", que rateia o valor entre os pedidos.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.origem IS DISTINCT FROM OLD.origem
     AND 'frete_compra' IN (COALESCE(NEW.origem, ''), COALESCE(OLD.origem, '')) THEN
    RAISE EXCEPTION 'A origem de uma conta de frete não se muda.' USING ERRCODE = '42501';
  END IF;

  IF OLD.origem = 'frete_compra'
     AND (NEW.valor IS DISTINCT FROM OLD.valor
          OR NEW.fornecedor_id IS DISTINCT FROM OLD.fornecedor_id
          OR NEW.filial IS DISTINCT FROM OLD.filial
          OR NEW.natureza IS DISTINCT FROM OLD.natureza) THEN
    RAISE EXCEPTION 'O valor do frete já foi rateado no custo dos pedidos. Para corrigir, cancele o frete e lance de novo.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_conta_de_frete_congela() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_de_frete_congela ON public.contas_pagar;
CREATE TRIGGER trg_conta_de_frete_congela
  BEFORE INSERT OR UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_de_frete_congela();

CREATE OR REPLACE FUNCTION public.fn_conta_de_frete_inativa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_frete uuid;
BEGIN
  IF OLD.origem = 'frete_compra'
     AND COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)
     AND COALESCE(current_setting('app.frete_compra', true), '') <> 'true' THEN
    SELECT id INTO v_frete FROM public.fretes_compra WHERE conta_pagar_id = NEW.id AND ativo;
    IF v_frete IS NOT NULL THEN
      PERFORM public._cancelar_frete_compra(v_frete, 'Conta do frete excluída em Contas a pagar');
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_conta_de_frete_inativa() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_de_frete_inativa ON public.contas_pagar;
CREATE TRIGGER trg_conta_de_frete_inativa
  AFTER UPDATE OF ativo ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_de_frete_inativa();

NOTIFY pgrst, 'reload schema';
