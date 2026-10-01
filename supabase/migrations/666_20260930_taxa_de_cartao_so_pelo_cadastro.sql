-- 666_20260930_taxa_de_cartao_so_pelo_cadastro.sql
--
-- A taxa de cartão da formação de preço passa a sair SÓ do cadastro de
-- Empresa › Formas de Pagamento.
--
-- Até aqui (657/664) havia um "Ajustar manualmente" que, preenchido, vencia o
-- mix de vendas para sempre: o aluno mudava a taxa do crédito no cadastro e o
-- preço não se mexia, sem nada na tela dizendo por quê. E o número pedido —
-- a média pesada pelo mix, em % da receita — não é a taxa da maquininha que
-- quem digita tem na cabeça.
--
-- O manual existia para a filial sem venda na janela, onde o mix não tem com
-- que pesar. Agora ela usa a média das formas ATIVAS que cobram taxa (taxa >
-- 0): conservadora de propósito — preço de loja nova peca por baixo, e o mix
-- corrige sozinho quando as vendas começam. Origem nova: 'cadastro'.
--
-- `salvar_parametros_precificacao` mantém a assinatura (o front em produção
-- continua chamando com `p_taxas_pct_manual`) e passa a ignorá-lo. A coluna
-- `filial_precificacao.taxas_pct_manual` fica — sem leitor — e é zerada.
--
-- Funções copiadas do banco (md5 igual nas 4 turmas antes desta migração).

-- 1. O que estava digitado deixa de valer.
UPDATE public.filial_precificacao
   SET taxas_pct_manual = NULL
 WHERE taxas_pct_manual IS NOT NULL;

COMMENT ON COLUMN public.filial_precificacao.taxas_pct_manual IS
  'Sem uso desde a migr. 666: a taxa de cartão sai só de Formas de Pagamento (mix de vendas, ou média das formas com taxa quando não há venda).';

-- 2. Parâmetros: mix → média do cadastro → sem taxa.
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
  v_cad_taxa   numeric; -- MIGR 666
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

  -- MIGR 666: sem manual. Sem venda na janela, a média das formas que cobram
  -- taxa no cadastro — o pior caso razoável, até o mix existir.
  SELECT ROUND(AVG(f.taxa), 2) INTO v_cad_taxa
    FROM public.formas_pagamento f
   WHERE f.filial = p_filial
     AND COALESCE(f.ativo, true)
     AND COALESCE(f.status, 'Ativo') <> 'Inativo'
     AND f.taxa > 0;

  IF (v_mix ->> 'taxa_pct') IS NOT NULL THEN
    v_taxa_pct := (v_mix ->> 'taxa_pct')::numeric; v_taxa_orig := 'mix';
  ELSIF v_cad_taxa IS NOT NULL THEN
    v_taxa_pct := v_cad_taxa; v_taxa_orig := 'cadastro';
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
    -- MIGR 666: sem 'taxas_pct' — a taxa não se ajusta mais à mão.
    'manual',           CASE WHEN v_gestor THEN jsonb_build_object(
                          'rbt12',         v_cfg.rbt12_manual,
                          'despesas_pct',  v_cfg.despesas_pct_manual,
                          'variaveis_pct', v_cfg.variaveis_pct_manual) END,
    'atualizado_em',    v_cfg.updated_at
  );
END;
$function$;

-- 3. Salvar: mesma assinatura, a taxa sempre grava NULL.
CREATE OR REPLACE FUNCTION public.salvar_parametros_precificacao(p_filial text, p_rbt12_manual numeric, p_despesas_pct_manual numeric, p_taxas_pct_manual numeric, p_variaveis_pct_manual numeric DEFAULT NULL::numeric)
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
     OR p_variaveis_pct_manual < 0 OR p_variaveis_pct_manual >= 100 THEN
    RAISE EXCEPTION 'Percentual fora de 0 a 99,99.' USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 666: `p_taxas_pct_manual` fica na assinatura e é ignorado — a taxa
  -- de cartão sai só de Formas de Pagamento.
  INSERT INTO public.filial_precificacao AS fp
    (filial, rbt12_manual, despesas_pct_manual, taxas_pct_manual, variaveis_pct_manual, updated_at, updated_by)
  VALUES (p_filial, p_rbt12_manual, p_despesas_pct_manual, NULL, p_variaveis_pct_manual, now(), auth.uid())
  ON CONFLICT (filial) DO UPDATE
    SET rbt12_manual         = EXCLUDED.rbt12_manual,
        despesas_pct_manual  = EXCLUDED.despesas_pct_manual,
        taxas_pct_manual     = NULL,
        variaveis_pct_manual = EXCLUDED.variaveis_pct_manual,
        updated_at           = EXCLUDED.updated_at,
        updated_by           = EXCLUDED.updated_by;

  RETURN public.parametros_precificacao(p_filial);
END;
$function$;
