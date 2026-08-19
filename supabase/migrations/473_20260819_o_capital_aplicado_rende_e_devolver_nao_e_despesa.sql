-- 473 — A Matriz aplica capital na filial e cobra juros de verdade.
--
-- O professor transfere R$ 50.000 para uma unidade e quer que aquilo renda
-- 2,3% ao mês. O instrumento já existia (`emprestimos_filial` + a RPC
-- `aprovar_emprestimo`, migr. 326) e nunca foi usado: em 2026-08-19 as 4
-- turmas tinham ZERO empréstimos e `taxa_juros_padrao = 0`. Ao tentar usar,
-- três coisas dariam errado.
--
-- ─── 1. A TAXA NÃO TINHA UNIDADE, E ERA COBRADA UMA VEZ SÓ ──────────────────
--
-- A conta era `valor * (1 + taxa/100)`, e o rótulo na tela dizia só
-- "Taxa juros padrão (%)". Digitando 2,3 pensando "ao mês", em 12 parcelas:
--
--   como estava:   total 51.150,00 · parcela 4.262,50 · juros    1.150,00
--   Price 2,3% a.m.: total 57.786,23 · parcela 4.815,52 · juros  7.786,23
--
-- Seis vezes e meia menos do que o professor pensou estar cobrando. Agora a
-- taxa é **ao mês** e o cálculo é **Tabela Price**: parcela fixa, com o juro
-- caindo e a amortização subindo ao longo do contrato. Price porque é o que o
-- aluno reconhece de um financiamento de banco — e porque é a decomposição
-- que torna possível o item 2.
--
-- ─── 2. DEVOLVER O PRINCIPAL NÃO É DESPESA ─────────────────────────────────
--
-- `gerar_dre` somava TODA conta a pagar sem `pedido_id` como despesa,
-- inclusive as parcelas do empréstimo. `calcular_saldo_capital` fazia o mesmo
-- em `despesas_financeiras`. Com R$ 50.000 circulando, a filial apareceria no
-- prejuízo por estar devolvendo dinheiro que nunca foi custo de nada.
--
-- É o mesmo defeito que a migr. 425 já tinha corrigido para compra de
-- mercadoria ("compra de mercadoria não é despesa"), e ninguém percebeu porque
-- não havia um único empréstimo no banco para expor.
--
-- Agora cada parcela guarda `juros`, `amortizacao` e `saldo_devedor`, e:
--   · só o JURO é despesa financeira (entra na DRE e derruba o lucro);
--   · a AMORTIZAÇÃO sai do caixa mas não do resultado — ela abate a dívida.
--
-- A amortização continua reduzindo o saldo/capital da unidade, porque o
-- dinheiro de fato saiu. Ela só não é mais tratada como custo.
--
-- ─── 3. DO LADO DA MATRIZ, O JURO VIRAVA CAPITAL EM VEZ DE RECEITA ─────────
--
-- `calcular_saldo_capital` já dizia isso em comentário, como pendência:
-- «o juros do empréstimo aparece como capital a mais na holding, não como
-- receita na DRE. Separar principal de juros exigiria guardar os dois por
-- parcela.» É exatamente o que esta migração passa a guardar. Agora a
-- devolução recompõe o capital pelo PRINCIPAL, e o juro entra como receita —
-- que é o lugar onde o lucro da operação de crédito deve aparecer.
--
-- ─── O QUE NÃO ENTROU ──────────────────────────────────────────────────────
--
-- A Matriz continua não podendo ORIGINAR o mútuo: ele nasce de uma
-- solicitação da filial (`emprestimos_filial.solicitado_por`) e a Matriz
-- aprova. Dar iniciativa à holding é caminho novo, não conserto — ficou
-- anotado em `docs/backlog-pos-freeze.md`.
--   → Durou pouco: a migr. 474, no mesmo dia, deu essa iniciativa à holding
--     (`conceder_mutuo_capital`) e criou a distribuição de lucro.
--
-- IOF e preço de transferência ficam fora: ambiente didático, sem ambição de
-- compliance bancário.
--
-- Aporte segue SEM juros de propósito. Aporte é dinheiro de sócio: entra no
-- patrimônio e o retorno dele é distribuição de lucro, não taxa mensal.
-- Cobrar taxa de aporte é, na vida real, mútuo disfarçado de capital — e a
-- diferença entre os dois instrumentos é justamente o que a aula ensina.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A parcela passa a saber quanto dela é juro
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.parcelas_emprestimo
  ADD COLUMN IF NOT EXISTS juros         numeric(15,2),
  ADD COLUMN IF NOT EXISTS amortizacao   numeric(15,2),
  ADD COLUMN IF NOT EXISTS saldo_devedor numeric(15,2);

COMMENT ON COLUMN public.parcelas_emprestimo.juros IS
  'Parte da parcela que é juro do mês (Price). É a única parte que vira despesa financeira. NULL = parcela anterior à migr. 473.';
COMMENT ON COLUMN public.parcelas_emprestimo.amortizacao IS
  'Parte da parcela que devolve principal. Sai do caixa, não do resultado.';
COMMENT ON COLUMN public.parcelas_emprestimo.saldo_devedor IS
  'Quanto ainda se deve DEPOIS desta parcela. Fecha em zero na última.';

-- Sem backfill: em 2026-08-19 não havia nenhuma parcela em nenhuma das 4
-- turmas. Inventar uma decomposição para parcela antiga seria fabricar
-- histórico — as colunas ficam NULL e são lidas como zero de juro.

-- ────────────────────────────────────────────────────────────────────────────
-- 2. `aprovar_emprestimo` — taxa ao mês, Tabela Price
--
-- Corpo copiado do banco; a mudança está no bloco de cálculo e no laço.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aprovar_emprestimo(
  p_emprestimo_id     uuid,
  p_banco_id          uuid,
  p_banco_nome        text,
  p_taxa_juros        numeric,
  p_num_parcelas      integer,
  p_justificativa_resp text,
  -- O DEFAULT existe desde a migr. 326 e faz parte da assinatura: tirá-lo aqui
  -- devolve 42P13 ("cannot remove parameter defaults from existing function").
  p_banco_origem_id   uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_emp        RECORD;
  v_i          numeric;
  v_fator      numeric;
  v_parcela    numeric;
  v_saldo      numeric;
  v_juros      numeric;
  v_amort      numeric;
  v_valor_this numeric;
  i            int;
  v_venc       date;
  v_cp_id      uuid;
  v_cr_id      uuid;
  v_dest_filial text;
  v_dest_ok    boolean;
  v_orig_filial text;
  v_orig_saldo numeric;
  v_orig_nome  text;
  v_desc       text;
BEGIN
  PERFORM public._assert_capital_holding();

  SELECT * INTO v_emp FROM public.emprestimos_filial
   WHERE id = p_emprestimo_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empréstimo não encontrado'; END IF;
  IF v_emp.status <> 'Pendente' THEN RAISE EXCEPTION 'Empréstimo já processado'; END IF;

  -- Segregação: quem pediu não decide.
  PERFORM public._assert_nao_e_o_solicitante(v_emp.solicitado_por);

  IF COALESCE(p_num_parcelas, 0) < 1 THEN
    RAISE EXCEPTION 'O empréstimo precisa de ao menos 1 parcela.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_taxa_juros, 0) < 0 THEN
    RAISE EXCEPTION 'Taxa de juros não pode ser negativa.' USING ERRCODE = 'P0001';
  END IF;

  -- ── Destino: conta da filial que pediu ────────────────────────────
  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de % que recebe o valor.', v_emp.filial USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, true INTO v_dest_filial, v_dest_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT COALESCE(v_dest_ok, false) THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_dest_filial IS NOT NULL AND v_dest_filial <> v_emp.filial THEN
    RAISE EXCEPTION 'A conta de destino é de % e o empréstimo é pra %.', v_dest_filial, v_emp.filial
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Origem: caixa da Matriz, com saldo (migr. 326) ────────────────
  IF p_banco_origem_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta da Matriz de onde sai o empréstimo.' USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, COALESCE(saldo, 0), COALESCE(banco, conta)
    INTO v_orig_filial, v_orig_saldo, v_orig_nome
    FROM public.caixa_bancos
   WHERE id = p_banco_origem_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_orig_filial, '') <> 'Matriz' THEN
    RAISE EXCEPTION 'O empréstimo sai do caixa da Matriz. A conta escolhida é de %.',
      COALESCE(v_orig_filial, 'uso global') USING ERRCODE = 'P0001';
  END IF;
  IF v_orig_saldo < v_emp.valor THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e o empréstimo é de R$ %.',
      v_orig_nome, round(v_orig_saldo, 2), round(v_emp.valor, 2)
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Tabela Price ──────────────────────────────────────────────────
  -- `p_taxa_juros` é % AO MÊS. Antes era aplicada uma vez sobre o contrato
  -- inteiro, o que fazia 2,3% em 12 parcelas custar 2,3%, não 31,4%.
  v_i := COALESCE(p_taxa_juros, 0) / 100;

  IF v_i = 0 THEN
    -- Sem fórmula de Price (divisão por zero): mútuo sem juro é rateio simples.
    v_parcela := ROUND(v_emp.valor / p_num_parcelas, 2);
  ELSE
    v_fator   := power(1 + v_i, p_num_parcelas::numeric);
    v_parcela := ROUND(v_emp.valor * v_i * v_fator / (v_fator - 1), 2);
  END IF;

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

  -- Transferência do principal (sem juros): sai da Matriz, entra na filial.
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) - v_emp.valor
   WHERE id = p_banco_origem_id;
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + v_emp.valor
   WHERE id = p_banco_id;

  -- Parcelas: conta a pagar da filial + conta a receber da Matriz.
  v_saldo := v_emp.valor;

  FOR i IN 1..p_num_parcelas LOOP
    v_venc  := public.acre_today() + ((i) * interval '1 month');
    v_juros := ROUND(v_saldo * v_i, 2);

    -- A última parcela amortiza o que sobrou em vez de repetir o valor fixo:
    -- sem isso o arredondamento de centavos deixa dívida viva ou paga a mais,
    -- e o saldo devedor não fecha em zero.
    IF i = p_num_parcelas THEN
      v_amort      := ROUND(v_saldo, 2);
      v_valor_this := ROUND(v_amort + v_juros, 2);
    ELSE
      v_amort      := ROUND(v_parcela - v_juros, 2);
      v_valor_this := v_parcela;
    END IF;

    v_saldo := ROUND(v_saldo - v_amort, 2);

    -- O juro vai na descrição porque é onde o aluno vê a conta: em Contas a
    -- Pagar ele lê quanto daquela parcela é custo do dinheiro.
    v_desc := 'Parcela ' || i || '/' || p_num_parcelas
           || ' — Empréstimo ' || COALESCE(p_banco_nome, 'Banco')
           || CASE WHEN v_juros > 0
                   THEN ' · juros R$ ' || to_char(v_juros, 'FM999G999G990D00')
                   ELSE '' END;

    INSERT INTO public.contas_pagar (descricao, valor, vencimento, status, filial, origem)
    VALUES (v_desc, v_valor_this, v_venc, 'Pendente', v_emp.filial, 'emprestimo')
    RETURNING id INTO v_cp_id;

    -- Contrapartida na holding: sem ela a filial pagava a parcela pro nada e
    -- o principal emprestado nunca voltava pro caixa da Matriz.
    INSERT INTO public.contas_receber (descricao, valor, vencimento, status, filial, origem)
    VALUES (
      'Parcela ' || i || '/' || p_num_parcelas || ' — Empréstimo a ' || v_emp.filial,
      v_valor_this, v_venc, 'Aberto', 'Matriz', 'emprestimo'
    )
    RETURNING id INTO v_cr_id;

    INSERT INTO public.parcelas_emprestimo
      (emprestimo_id, num_parcela, valor_parcela, data_vencimento,
       contas_pagar_id, contas_receber_id, juros, amortizacao, saldo_devedor)
    VALUES
      (p_emprestimo_id, i, v_valor_this, v_venc,
       v_cp_id, v_cr_id, v_juros, v_amort, v_saldo);
  END LOOP;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. `gerar_dre` — a parcela entra como juro, não como despesa inteira
--
-- Corpo copiado do banco (migr. 426); a mudança está só no bloco de despesas.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gerar_dre(
  p_filial text,
  p_inicio date,
  p_fim    date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receita_bruta   numeric(15,2);
  v_descontos       numeric(15,2);
  v_devolucoes      numeric(15,2);
  v_receita_liquida numeric(15,2);
  v_cmv             numeric(15,2);
  v_cmv_devolvido   numeric(15,2);
  v_lucro_bruto     numeric(15,2);
  v_despesas        numeric(15,2);
  v_resultado       numeric(15,2);
  v_grupos          jsonb;
  v_sem_custo       integer;
  v_itens           integer;
BEGIN
  PERFORM public._assert_rpc();

  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Resultado de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial abrem o resultado da unidade.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(v.total), 0),
         COALESCE(SUM(COALESCE(v.desconto, 0) + COALESCE(v.cupom_desconto, 0)), 0)
    INTO v_receita_bruta, v_descontos
    FROM public.vendas v
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(d.valor_devolvido), 0)
    INTO v_devolucoes
    FROM public.devolucoes d
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  v_receita_liquida := ROUND(v_receita_bruta - v_descontos - v_devolucoes, 2);

  SELECT COALESCE(SUM(iv.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0),
         COUNT(*) FILTER (WHERE iv.custo_unitario IS NULL),
         COUNT(*)
    INTO v_cmv, v_sem_custo, v_itens
    FROM public.itens_venda iv
    JOIN public.vendas v ON v.id = iv.venda_id
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = iv.produto_id
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  -- Mercadoria devolvida voltou para a prateleira: o custo dela sai do CMV.
  -- O custo usado é o carimbado na LINHA DA VENDA original (mesma venda, mesmo
  -- produto), e não o de hoje — senão devolver um item viraria lucro ou
  -- prejuízo contábil só porque o fornecedor reajustou no meio.
  SELECT COALESCE(SUM(idev.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0)
    INTO v_cmv_devolvido
    FROM public.itens_devolucao idev
    JOIN public.devolucoes d ON d.id = idev.devolucao_id
    LEFT JOIN LATERAL (
      SELECT iv2.custo_unitario
        FROM public.itens_venda iv2
       WHERE iv2.venda_id = d.venda_id
         AND iv2.produto_id IS NOT DISTINCT FROM idev.produto_id
       LIMIT 1
    ) iv ON true
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = idev.produto_id
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  v_cmv         := ROUND(GREATEST(v_cmv - v_cmv_devolvido, 0), 2);
  v_lucro_bruto := ROUND(v_receita_liquida - v_cmv, 2);

  -- `pedido_id IS NULL` tira a compra de mercadoria (vira CMV).
  -- `origem <> 'devolucao_pdv'` tira o estorno de devolução de venda, que já
  -- foi subtraído da receita — contá-lo aqui seria a mesma saída duas vezes.
  -- `origem <> 'emprestimo'` tira a parcela do mútuo: só o juro dela é
  -- despesa, e ele entra pelo segundo ramo. Devolver principal não é custo —
  -- mesma regra que já vale para compra de mercadoria (migr. 425).
  SELECT COALESCE(SUM(t.valor), 0),
         COALESCE(jsonb_agg(jsonb_build_object('grupo', t.grupo, 'valor', t.valor)
                            ORDER BY t.valor DESC), '[]'::jsonb)
    INTO v_despesas, v_grupos
    FROM (
      SELECT COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cp.valor), 2) AS valor
        FROM public.contas_pagar cp
        LEFT JOIN public.centros_custo cc ON cc.id = cp.centro_custo_id
       WHERE cp.ativo = true
         AND cp.filial = p_filial
         AND cp.status <> 'Cancelado'
         AND cp.pedido_id IS NULL
         AND COALESCE(cp.origem, '') NOT IN ('devolucao_pdv', 'emprestimo')
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado')

      UNION ALL

      -- Custo do dinheiro emprestado pela Matriz, na competência do vencimento.
      SELECT 'Despesas financeiras'::text AS grupo,
             ROUND(SUM(COALESCE(pe.juros, 0)), 2) AS valor
        FROM public.contas_pagar cp
        JOIN public.parcelas_emprestimo pe ON pe.contas_pagar_id = cp.id
       WHERE cp.ativo = true
         AND cp.filial = p_filial
         AND cp.status <> 'Cancelado'
         AND COALESCE(cp.origem, '') = 'emprestimo'
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
      HAVING ROUND(SUM(COALESCE(pe.juros, 0)), 2) > 0
    ) t;

  v_resultado := ROUND(v_lucro_bruto - v_despesas, 2);

  RETURN jsonb_build_object(
    'filial',           p_filial,
    'inicio',           p_inicio,
    'fim',              p_fim,
    'receita_bruta',    v_receita_bruta,
    'descontos',        v_descontos,
    'devolucoes',       v_devolucoes,
    'receita_liquida',  v_receita_liquida,
    'cmv',              v_cmv,
    'cmv_devolvido',    v_cmv_devolvido,
    'lucro_bruto',      v_lucro_bruto,
    'margem_bruta_pct', CASE WHEN v_receita_liquida > 0
                             THEN ROUND(100 * v_lucro_bruto / v_receita_liquida, 1) END,
    'despesas',         v_despesas,
    'despesas_grupos',  v_grupos,
    'resultado',        v_resultado,
    'margem_liquida_pct', CASE WHEN v_receita_liquida > 0
                               THEN ROUND(100 * v_resultado / v_receita_liquida, 1) END,
    'itens_vendidos',   v_itens,
    'itens_sem_custo',  v_sem_custo
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. `calcular_saldo_capital` — juro é resultado, amortização é caixa
--
-- Corpo copiado do banco; a mudança está nas duas leituras de parcela e no
-- lado da holding.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(p_filial text)
RETURNS TABLE (
  capital_total          numeric,
  despesas_pagas         numeric,
  despesas_operacionais  numeric,
  despesas_financeiras   numeric,
  receitas_pagas         numeric,
  lucro_operacional      numeric,
  lucro_liquido          numeric,
  reserva_valor          numeric,
  reserva_pct            numeric,
  saldo_livre            numeric,
  saldo_real             numeric,
  bloqueado              boolean,
  em_reserva             boolean,
  data_inicio            date,
  data_fim               date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cfg         RECORD;
  v_capital     numeric := 0;
  v_emprest     numeric := 0;
  v_saida_hold  numeric := 0;
  v_aporte_out  numeric := 0;
  v_emp_out     numeric := 0;
  v_emp_back    numeric := 0;
  v_juros_in    numeric := 0;
  v_desp_op     numeric := 0;
  v_juros_pago  numeric := 0;
  v_amort_paga  numeric := 0;
  v_receitas    numeric := 0;
  v_reserva_pct numeric := 0;
  v_reserva_val numeric := 0;
  v_saldo_real  numeric := 0;
  v_saldo_livre numeric := 0;
  v_desp_total  numeric := 0;
  v_lucro_op    numeric := 0;
  v_lucro_liq   numeric := 0;
BEGIN
  PERFORM public._assert_rpc();
  SELECT * INTO v_cfg FROM public.capital_config
   ORDER BY created_at DESC LIMIT 1;

  SELECT COALESCE(SUM(valor), 0) INTO v_capital
    FROM public.capital_filial
   WHERE filial = p_filial
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(valor), 0) INTO v_emprest
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND status = 'Aprovado'
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Saída da holding: só existe pra 'Matriz'. `emprestimos_filial` é sempre
  -- de unidade operacional (o CHECK não aceita 'Matriz'), então somar tudo
  -- aqui é somar o que a Matriz concedeu.
  --
  -- Aporte é definitivo: sai e não volta. Empréstimo VOLTA — e é por isso que
  -- a conta desconta `concedido - devolvido`, não só o concedido.
  --
  -- O que volta agora é só a AMORTIZAÇÃO (migr. 473). Antes voltava a parcela
  -- inteira, e o juro inflava o capital da holding — a própria função dizia
  -- isso em comentário, como pendência a resolver quando a parcela guardasse
  -- os dois valores. Juro não é capital que retorna: é receita, e vai para
  -- `v_receitas` mais abaixo. Nesse modelo receita não aumenta capital (nem
  -- para a filial), então tratá-lo como retorno de principal era contar lucro
  -- como patrimônio.
  IF p_filial = 'Matriz' THEN
    SELECT COALESCE(SUM(cf.valor), 0) INTO v_aporte_out
      FROM public.capital_filial cf
     WHERE cf.filial <> 'Matriz'
       AND (v_cfg IS NULL OR cf.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cf.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    SELECT COALESCE(SUM(e.valor), 0) INTO v_emp_out
      FROM public.emprestimos_filial e
     WHERE e.status = 'Aprovado'
       AND (v_cfg IS NULL OR e.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR e.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    -- Principal devolvido (recompõe capital) e juro recebido (vira receita).
    -- COALESCE(pe.amortizacao, cr.valor): parcela anterior à 473 não tem a
    -- decomposição, e nesse caso a parcela inteira volta a ser principal —
    -- que é exatamente como ela foi tratada quando nasceu.
    SELECT COALESCE(SUM(COALESCE(pe.amortizacao, cr.valor)), 0),
           COALESCE(SUM(COALESCE(pe.juros, 0)), 0)
      INTO v_emp_back, v_juros_in
      FROM public.contas_receber cr
      LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_receber_id = cr.id
     WHERE cr.filial = 'Matriz' AND cr.origem = 'emprestimo'
       AND cr.status IN ('Pago', 'Recebido')
       AND COALESCE(cr.ativo, true) = true
       AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    v_saida_hold := v_aporte_out + v_emp_out - v_emp_back;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN cp.status = 'Pago' THEN cp.valor ELSE COALESCE(cp.valor_pago, 0) END), 0) INTO v_desp_op
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND COALESCE(cp.origem, '') <> 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Parcela paga, separada em juro e principal (migr. 473). O juro é despesa
  -- financeira e derruba o lucro; a amortização sai do caixa e abate a dívida,
  -- mas não é custo de nada — é o mesmo dinheiro voltando pra casa.
  --
  -- Pagamento parcial rateia os dois na proporção do que foi pago: metade da
  -- parcela paga é metade do juro e metade do principal.
  SELECT COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.juros, 0)
                ELSE ROUND(COALESCE(pe.juros, 0)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0),
         COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.amortizacao, cp.valor)
                ELSE ROUND(COALESCE(pe.amortizacao, cp.valor)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0)
    INTO v_juros_pago, v_amort_paga
    FROM public.contas_pagar cp
    LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_pagar_id = cp.id
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND cp.origem = 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- Parcela que volta pra Matriz não é receita de venda: o principal recompõe
  -- capital acima, e só o juro entra como receita (somado adiante).
  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial
     AND cr.status IN ('Pago', 'Recebido')     -- frontend grava 'Pago'
     AND COALESCE(cr.ativo, true) = true
     AND NOT (p_filial = 'Matriz' AND COALESCE(cr.origem, '') = 'emprestimo')
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- O lucro da operação de crédito da holding aparece aqui, e não como
  -- capital que brotou do nada.
  v_receitas    := v_receitas + v_juros_in;

  v_capital     := v_capital - v_saida_hold;   -- zero fora da Matriz
  -- A amortização continua saindo do saldo: o dinheiro deixou a unidade. Ela
  -- só não entra mais no lucro.
  v_desp_total  := v_desp_op + v_juros_pago + v_amort_paga;
  v_reserva_pct := COALESCE(v_cfg.reserva_min_pct, 0);
  v_reserva_val := ROUND((v_capital + v_emprest) * v_reserva_pct / 100, 2);
  v_saldo_real  := (v_capital + v_emprest) - v_desp_total;
  v_saldo_livre := v_saldo_real - v_reserva_val;
  v_lucro_op    := v_receitas - v_desp_op;
  v_lucro_liq   := v_lucro_op - v_juros_pago - v_reserva_val;

  RETURN QUERY SELECT
    (v_capital + v_emprest),
    v_desp_total,
    v_desp_op,
    v_juros_pago,          -- despesas_financeiras = só o juro (migr. 473)
    v_receitas,
    v_lucro_op,
    v_lucro_liq,
    v_reserva_val,
    v_reserva_pct,
    v_saldo_livre,
    v_saldo_real,
    (v_saldo_real < 0),
    (v_saldo_livre <= 0 AND v_saldo_real >= 0),
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_inicio ELSE public.acre_today() END,
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_fim ELSE NULL END;
END;
$function$;

COMMENT ON FUNCTION public.aprovar_emprestimo(uuid, uuid, text, numeric, integer, text, uuid) IS
  'Migr. 473 — aprova o mútuo Matriz→filial. `p_taxa_juros` é % AO MÊS e o cálculo é Tabela Price: parcela fixa, com juro e amortização gravados em parcelas_emprestimo.';

COMMIT;

-- Verificação:
--
--   -- R$ 50.000 a 2,3% a.m. em 12x deve dar parcela 4.815,52 e juros 7.786,23:
--   SELECT num_parcela, valor_parcela, juros, amortizacao, saldo_devedor
--     FROM parcelas_emprestimo WHERE emprestimo_id = '<id>' ORDER BY num_parcela;
--
--   -- As amortizações têm que somar o principal EXATO e o saldo fechar em zero:
--   SELECT SUM(amortizacao), MIN(saldo_devedor) FROM parcelas_emprestimo
--    WHERE emprestimo_id = '<id>';
--
--   -- A DRE da filial só pode contar o juro:
--   SELECT gerar_dre('SuperMax', date_trunc('month', now())::date, acre_today());
