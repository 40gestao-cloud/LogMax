-- 664_20260929_precificacao_custo_direto_variaveis_servico.sql
--
-- Lacunas da tela de Precificação para a formação do preço pelo markup
-- divisor ficar completa:
--
-- 1. CUSTO DIRETO TOTAL À VISTA. O frete do CT-e já entra no custo médio
--    (657), mas o aluno só via um número. `composicao_custo_produto` abre a
--    última compra conferida: preço do pedido, valor da nota (com IPI/ST que
--    vierem nela), frete rateado, por unidade — e o custo médio atual.
--    Mesma régua de quem vê custo (`produtos_custo_select`).
--
-- 2. DESPESAS FIXAS × VARIÁVEIS. As despesas do DRE ÷ faturamento continuam
--    sendo o % fixo (agora com os grupos que o formam). Nasce o % VARIÁVEL
--    (comissão sobre a venda, embalagem, entrega) — informado pela gestão,
--    porque cresce com cada venda e não sai do histórico de contas. Entra no
--    divisor como mais uma fatia.
--
-- 3. SERVIÇO COM CUSTO E LUCRO. `servicos.custo` (material + mão de obra
--    direta) e `filial_precificacao.lucro_servico_pct` (serviço não tem
--    categoria de produto): o cadastro de serviço sugere o preço pelo divisor
--    no Anexo III.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ════ Estrutura ══════════════════════════════════════════════════════════════
ALTER TABLE public.filial_precificacao
  ADD COLUMN IF NOT EXISTS variaveis_pct_manual numeric(5,2)
    CHECK (variaveis_pct_manual IS NULL OR (variaveis_pct_manual >= 0 AND variaveis_pct_manual < 100)),
  ADD COLUMN IF NOT EXISTS lucro_servico_pct numeric(5,2)
    CHECK (lucro_servico_pct IS NULL OR (lucro_servico_pct >= 0 AND lucro_servico_pct < 100));
COMMENT ON COLUMN public.filial_precificacao.variaveis_pct_manual IS
  'Despesas variáveis sobre a venda (comissão, embalagem, entrega), % do preço. Migr. 664.';
COMMENT ON COLUMN public.filial_precificacao.lucro_servico_pct IS
  'Lucro líquido desejado para serviço prestado, % do preço (Anexo III). Migr. 664.';

ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS custo numeric(15,2) CHECK (custo IS NULL OR custo >= 0);
COMMENT ON COLUMN public.servicos.custo IS
  'Custo direto do serviço prestado (material + mão de obra direta), base do markup divisor. Migr. 664.';

-- ════ parametros_precificacao (+ variáveis, grupos das fixas, lucro de serviço)
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
  v_nominal3   numeric;   -- MIGR 659
  v_deduzir3   numeric;   -- MIGR 659
  v_efetiva3   numeric;   -- MIGR 659
  v_base       numeric;
  v_taxas_hist numeric := 0;
  v_desp_hist  numeric;
  v_desp_pct   numeric;
  v_desp_orig  text;
  v_taxa_pct   numeric;
  v_taxa_orig  text;
  v_gestor     boolean;
  v_mix        jsonb;   -- MIGR 657
  v_dre        jsonb;   -- MIGR 664
  v_grupos     jsonb := '[]'::jsonb;  -- MIGR 664
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
  -- MIGR 659: a mesma faixa na tabela do serviço.
  SELECT a.aliquota_nominal, a.parcela_deduzir, a.aliquota_efetiva
    INTO v_nominal3, v_deduzir3, v_efetiva3
    FROM public.simples_anexo_iii(v_rbt12) a;

  v_base := public._receita_simples(p_filial, v_ini, v_fim);

  IF v_base > 0 THEN
    SELECT COALESCE(SUM(cp.valor), 0) INTO v_taxas_hist
      FROM public.contas_pagar cp
     WHERE cp.ativo = true
       AND cp.filial = p_filial
       AND cp.status <> 'Cancelado'
       AND cp.origem = 'conciliacao_maquininha'
       AND COALESCE(cp.vencimento, (cp.created_at AT TIME ZONE 'America/Rio_Branco')::date) BETWEEN v_ini AND v_fim;
    v_dre := public._dre_calculo(p_filial, v_ini, v_fim);
    v_desp_hist := (v_dre ->> 'despesas')::numeric - v_taxas_hist;

    -- MIGR 664: de que grupos do DRE sai o % fixo, cada um em % da receita.
    -- A taxa da maquininha está dentro de algum grupo e sai à parte: ela já
    -- é a fatia "Taxas".
    SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g->>'grupo',
                     'pct', ROUND(100 * (g->>'valor')::numeric / v_base, 2))
                     ORDER BY (g->>'valor')::numeric DESC), '[]'::jsonb)
      INTO v_grupos
      FROM jsonb_array_elements(COALESCE(v_dre -> 'despesas_grupos', '[]'::jsonb)) g
     WHERE (g->>'valor')::numeric <> 0;
    IF v_taxas_hist > 0 THEN
      v_grupos := v_grupos || jsonb_build_array(jsonb_build_object(
        'grupo', '(−) taxa da maquininha, já contada em Taxas',
        'pct', -ROUND(100 * v_taxas_hist / v_base, 2)));
    END IF;
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
    -- MIGR 659
    'aliquota_nominal_iii', v_nominal3,
    'parcela_deduzir_iii',  v_deduzir3,
    'aliquota_efetiva_iii', v_efetiva3,
    'vende_servico',    EXISTS (SELECT 1 FROM public.servicos s
                                 WHERE s.filial = p_filial
                                   AND COALESCE(s.natureza, 'prestado') = 'prestado'
                                   AND COALESCE(s.ativo, true) AND s.excluido_em IS NULL
                                   AND COALESCE(s.status, 'Ativo') = 'Ativo'),
    'acima_do_teto',    COALESCE(v_rbt12, 0) > 4800000,
    'despesas_pct',     v_desp_pct,
    'despesas_origem',  v_desp_orig,
    -- MIGR 664
    'despesas_grupos',  v_grupos,
    'variaveis_pct',    v_cfg.variaveis_pct_manual,
    'variaveis_origem', CASE WHEN v_cfg.variaveis_pct_manual IS NOT NULL THEN 'manual' ELSE 'nao_informado' END,
    'lucro_servico_pct', v_cfg.lucro_servico_pct,
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
                          'rbt12',         v_cfg.rbt12_manual,
                          'despesas_pct',  v_cfg.despesas_pct_manual,
                          'taxas_pct',     v_cfg.taxas_pct_manual,
                          'variaveis_pct', v_cfg.variaveis_pct_manual) END,
    'atualizado_em',    v_cfg.updated_at
  );
END;
$function$;

-- ════ salvar_parametros_precificacao (+ variáveis) ═══════════════════════════
DROP FUNCTION IF EXISTS public.salvar_parametros_precificacao(text, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.salvar_parametros_precificacao(
  p_filial text, p_rbt12_manual numeric, p_despesas_pct_manual numeric, p_taxas_pct_manual numeric,
  p_variaveis_pct_manual numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Parâmetros de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial ajustam a formação de preço.'
      USING ERRCODE = '42501';
  END IF;
  IF p_rbt12_manual < 0 THEN
    RAISE EXCEPTION 'Receita dos 12 meses não pode ser negativa.' USING ERRCODE = 'P0001';
  END IF;
  IF p_despesas_pct_manual < 0 OR p_despesas_pct_manual >= 100
     OR p_taxas_pct_manual < 0 OR p_taxas_pct_manual >= 100
     OR p_variaveis_pct_manual < 0 OR p_variaveis_pct_manual >= 100 THEN
    RAISE EXCEPTION 'Percentual fora de 0 a 99,99.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.filial_precificacao AS fp
    (filial, rbt12_manual, despesas_pct_manual, taxas_pct_manual, variaveis_pct_manual, updated_at, updated_by)
  VALUES (p_filial, p_rbt12_manual, p_despesas_pct_manual, p_taxas_pct_manual, p_variaveis_pct_manual, now(), auth.uid())
  ON CONFLICT (filial) DO UPDATE
    SET rbt12_manual         = EXCLUDED.rbt12_manual,
        despesas_pct_manual  = EXCLUDED.despesas_pct_manual,
        taxas_pct_manual     = EXCLUDED.taxas_pct_manual,
        variaveis_pct_manual = EXCLUDED.variaveis_pct_manual,
        updated_at           = EXCLUDED.updated_at,
        updated_by           = EXCLUDED.updated_by;

  RETURN public.parametros_precificacao(p_filial);
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_parametros_precificacao(text, numeric, numeric, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salvar_parametros_precificacao(text, numeric, numeric, numeric, numeric) TO authenticated;

-- ════ Lucro desejado do serviço ══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.salvar_lucro_servico(p_filial text, p_pct numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Parâmetros de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial ajustam a formação de preço.'
      USING ERRCODE = '42501';
  END IF;
  IF p_pct < 0 OR p_pct >= 100 THEN
    RAISE EXCEPTION 'O lucro precisa ficar entre 0 e 99,99%%.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.filial_precificacao AS fp (filial, lucro_servico_pct, updated_at, updated_by)
  VALUES (p_filial, p_pct, now(), auth.uid())
  ON CONFLICT (filial) DO UPDATE
    SET lucro_servico_pct = EXCLUDED.lucro_servico_pct,
        updated_at        = EXCLUDED.updated_at,
        updated_by        = EXCLUDED.updated_by;

  RETURN public.parametros_precificacao(p_filial);
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_lucro_servico(text, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salvar_lucro_servico(text, numeric) TO authenticated;

-- ════ Custo direto total do produto (última compra conferida) ════════════════
CREATE OR REPLACE FUNCTION public.composicao_custo_produto(p_produto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prod     public.produtos;
  v_custo    public.produtos_custo;
  v_ped      public.pedidos;
  v_qtd      numeric;
  v_enc      boolean;
  v_rec_em   date;
  v_nf       numeric;
  v_frete    numeric;
  v_base     numeric;
  v_unit_ped numeric;
  v_unit_nf  numeric;
  v_forn     text;
BEGIN
  PERFORM public._assert_rpc();
  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_prod.filial), false) THEN
    RAISE EXCEPTION 'Produto de outra filial.' USING ERRCODE = '42501';
  END IF;
  -- Mesma régua de quem lê custo (policy produtos_custo_select).
  IF NOT COALESCE(public.auth_in_setor('financeiro', 'marketing', 'logistica'), false) THEN
    RAISE EXCEPTION 'Custo de produto é visível ao Financeiro, Marketing e Logística.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_custo FROM public.produtos_custo WHERE produto_id = p_produto_id;

  -- Última compra com a carga conferida no Estoque.
  SELECT p.* INTO v_ped
    FROM public.pedidos p
   WHERE p.produto_id = p_produto_id
     AND COALESCE(p.ativo, true)
     AND COALESCE(p.item_qtd, 0) > 0
     AND COALESCE(p.valor_total, 0) > 0
     AND EXISTS (SELECT 1 FROM public.recebimentos r
                  WHERE r.pedido_id = p.id AND COALESCE(r.ativo, true)
                    AND r.status IN ('Concluído', 'Parcial'))
   ORDER BY (SELECT max(r.data) FROM public.recebimentos r
              WHERE r.pedido_id = p.id AND COALESCE(r.ativo, true)) DESC NULLS LAST,
            p.created_at DESC
   LIMIT 1;

  IF v_ped.id IS NULL THEN
    RETURN jsonb_build_object(
      'custo_medio', v_custo.preco_custo,
      'custo_origem', v_custo.origem,
      'ultima_compra', NULL);
  END IF;

  SELECT COALESCE(sum(r.qtd_recebida), 0), COALESCE(bool_or(r.encerrado_com_saldo), false), max(r.data)
    INTO v_qtd, v_enc, v_rec_em
    FROM public.recebimentos r
   WHERE r.pedido_id = v_ped.id AND COALESCE(r.ativo, true) AND r.status IN ('Concluído', 'Parcial');

  SELECT max(cp.nf_valor) INTO v_nf
    FROM public.contas_pagar cp
   WHERE cp.pedido_id = v_ped.id AND COALESCE(cp.ativo, true) AND cp.nf_conferida_em IS NOT NULL;

  SELECT COALESCE(sum(fr.valor), 0) INTO v_frete
    FROM public.fretes_compra_rateio fr
    JOIN public.fretes_compra f ON f.id = fr.frete_id AND f.ativo
   WHERE fr.pedido_id = v_ped.id;

  SELECT nome INTO v_forn FROM public.fornecedores WHERE id = v_ped.fornecedor_id;

  -- As mesmas contas de `_ajustar_custo_pela_nota`, que é quem leva isto ao
  -- custo médio: nota pela quantidade faturada, frete pelo que chegou.
  v_base     := CASE WHEN v_enc THEN v_qtd ELSE v_ped.item_qtd END;
  v_unit_ped := ROUND(v_ped.valor_total / v_ped.item_qtd, 4);
  v_unit_nf  := CASE WHEN COALESCE(v_nf, 0) > 0 AND v_base > 0 THEN ROUND(v_nf / v_base, 4) END;

  RETURN jsonb_build_object(
    'custo_medio',  v_custo.preco_custo,
    'custo_origem', v_custo.origem,
    'ultima_compra', jsonb_build_object(
      'pedido',         COALESCE(v_ped.numero, 'Pedido #' || upper(right(v_ped.id::text, 6))),
      'fornecedor',     v_forn,
      'recebido_em',    v_rec_em,
      'qtd',            v_qtd,
      'unit_pedido',    v_unit_ped,
      'unit_nota',      v_unit_nf,
      'frete_total',    v_frete,
      'frete_unit',     CASE WHEN v_qtd > 0 THEN ROUND(v_frete / v_qtd, 4) ELSE 0 END,
      'custo_direto_unit', ROUND(COALESCE(v_unit_nf, v_unit_ped) + CASE WHEN v_qtd > 0 THEN v_frete / v_qtd ELSE 0 END, 4)
    ));
END;
$function$;

REVOKE ALL ON FUNCTION public.composicao_custo_produto(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.composicao_custo_produto(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
