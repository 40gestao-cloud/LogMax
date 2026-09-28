-- 645_20260928_custo_medio_pela_nota_fiscal.sql
--
-- O custo médio vinha do PREÇO DO PEDIDO (fn_custo_medio_da_entrada, migr.
-- 417) e a conferência da nota (491) mudava só a conta a pagar. Frete na
-- nota, reajuste e entrega a menor ficavam fora do custo: a margem que a loja
-- via era a do pedido, não a da compra.
--
-- REGRA (a da conferência de fatura de ERP, simplificada):
--   • custo unitário real = valor da nota ÷ base. A base é a quantidade
--     PEDIDA — a nota cobre o pedido — ou a quantidade CONFERIDA quando a
--     entrega foi encerrada com falta (a nota então cobre o que veio).
--   • diferença = (unitário da nota − unitário do pedido) × conferido,
--     menos o que já foi ajustado antes (incremental: conferir de novo ou
--     chegar outra carga depois não conta duas vezes).
--   • a parte da diferença que corresponde a unidades AINDA EM ESTOQUE
--     reprecifica o custo médio; a parte já vendida/consumida vai para o
--     resultado do período — CMV (mercadoria) ou despesa (material de consumo).
--   • estimativa das unidades desta compra ainda em estoque: o menor entre o
--     saldo atual do produto e a quantidade conferida (supõe que a compra mais
--     recente é a que ainda está na prateleira).
--
-- Fora de escopo: devolução ao fornecedor depois da conferência não refaz o
-- ajuste (a devolução já abate a conta; o custo das unidades devolvidas sai
-- pelo médio).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

CREATE TABLE IF NOT EXISTS public.ajustes_custo_compra (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  produto_id      uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  filial          text NOT NULL,
  data            date NOT NULL DEFAULT public.acre_today(),
  qtd_conferida   numeric NOT NULL,
  custo_pedido    numeric(15,4) NOT NULL,
  custo_nota      numeric(15,4) NOT NULL,
  valor_estoque   numeric(15,2) NOT NULL DEFAULT 0,
  valor_resultado numeric(15,2) NOT NULL DEFAULT 0,
  destino         text NOT NULL CHECK (destino IN ('cmv', 'despesa')),
  criado_por      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ajustes_custo_compra_pedido ON public.ajustes_custo_compra (pedido_id);
CREATE INDEX IF NOT EXISTS idx_ajustes_custo_compra_filial_data ON public.ajustes_custo_compra (filial, data);

COMMENT ON TABLE public.ajustes_custo_compra IS
  'Diferença entre a nota fiscal conferida e o preço do pedido, levada ao custo (migr. 645). valor_estoque reprecificou o custo médio; valor_resultado entrou no DRE do período (CMV ou despesa). Escrito só por _ajustar_custo_pela_nota.';

ALTER TABLE public.ajustes_custo_compra ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ajustes_custo_compra FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ajustes_custo_compra FROM authenticated;
GRANT SELECT ON TABLE public.ajustes_custo_compra TO authenticated;

DROP POLICY IF EXISTS ajustes_custo_select ON public.ajustes_custo_compra;
CREATE POLICY ajustes_custo_select ON public.ajustes_custo_compra
  FOR SELECT TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text, 'logistica'::text, 'estoque'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

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
  IF COALESCE(v_nf, 0) <= 0 THEN
    RETURN 0;  -- nota ainda não conferida: nada a ajustar por enquanto
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
  v_unit_nf  := ROUND(v_nf / v_base, 4);

  SELECT COALESCE(sum(a.valor_estoque + a.valor_resultado), 0) INTO v_ja
    FROM public.ajustes_custo_compra a
   WHERE a.pedido_id = p_pedido_id;

  v_delta := ROUND((v_unit_nf - v_unit_ped) * v_qtd_conf - v_ja, 2);
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
      'compra', public.acre_today(), v_unit_nf, now()
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
    (p_pedido_id, v_ped.produto_id, v_ped.filial, v_qtd_conf, v_unit_ped, v_unit_nf,
     v_d_est, v_d_res, CASE WHEN v_tipo = 'consumo' THEN 'despesa' ELSE 'cmv' END);

  RETURN v_delta;
END;
$$;

REVOKE ALL ON FUNCTION public._ajustar_custo_pela_nota(uuid) FROM public, anon, authenticated;

-- ═══ Funções existentes, com a inserção marcada "MIGR 645" ═══════════════

CREATE OR REPLACE FUNCTION public.conferir_nota_fiscal(p_conta_id uuid, p_nf_valor numeric, p_observacao text DEFAULT NULL::text)
 RETURNS contas_pagar
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta       public.contas_pagar;
  v_pedido      public.pedidos;
  v_nf_numero   text;
  v_divergencia numeric;
  v_fixo        numeric(15,2);
  v_restante    numeric(15,2);
  v_n           integer;
  v_i           integer := 0;
  v_acum        numeric(15,2) := 0;
  v_parcela     numeric(15,2);
  v_row         record;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  -- MIGR 642: valor e campos da nota de conta de pedido só mudam por aqui (e
  -- pela devolução ao fornecedor). `fn_conta_de_pedido_congela` recusa o resto.
  PERFORM set_config('app.conta_pedido_nf', 'true', true);

  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id FOR UPDATE;
  IF v_conta.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_conta.filial), false) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_conta.ativo, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Conta inativa.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.pedido_id IS NULL THEN
    RAISE EXCEPTION 'Esta conta não vem de pedido de compra — não há pedido nem nota para conferir.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Pago' THEN
    RAISE EXCEPTION 'Conta já quitada — conferir a nota agora não mudaria o que saiu do caixa.'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_nf_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor da nota fiscal.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos WHERE id = v_conta.pedido_id;

  SELECT MAX(r.nf_numero) INTO v_nf_numero
    FROM public.recebimentos r
   WHERE r.pedido_id = v_conta.pedido_id
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Concluído', 'Parcial');

  IF v_nf_numero IS NULL THEN
    RAISE EXCEPTION 'Ainda não há recebimento conferido com nota para este pedido. O estoque confere a carga e registra a nota antes de o financeiro conferir o valor.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Divergência entre o combinado e o cobrado. Não bloqueia — em compra real
  -- ela acontece (frete, imposto, reajuste, entrega a menor). O que não pode é
  -- passar calada.
  v_divergencia := p_nf_valor - COALESCE(v_pedido.valor_total, 0);
  IF abs(v_divergencia) > 0.005
     AND COALESCE(btrim(COALESCE(p_observacao, '')), '') = '' THEN
    RAISE EXCEPTION 'A nota (R$ %) não bate com o pedido (R$ %). Escreva o motivo da diferença antes de liberar o pagamento.',
      to_char(p_nf_valor, 'FM999G999G990D00'),
      to_char(COALESCE(v_pedido.valor_total, 0), 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 584: a nota cobre o pedido inteiro, e o pedido pode ter virado 2 ou 3
  -- títulos. Parcela que já recebeu dinheiro não se mexe (o que saiu do caixa
  -- saiu); o valor da nota se distribui entre as que ainda não foram tocadas.
  SELECT COALESCE(sum(valor), 0) INTO v_fixo
    FROM public.contas_pagar
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true)
     AND (COALESCE(valor_pago, 0) > 0 OR status IN ('Pago', 'Parcial'));

  SELECT count(*) INTO v_n
    FROM public.contas_pagar
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true)
     AND COALESCE(valor_pago, 0) = 0
     AND status NOT IN ('Pago', 'Parcial');

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Todas as parcelas deste pedido já têm pagamento. A diferença da nota tem de ser resolvida com o fornecedor, não reescrevendo o que já saiu do caixa.'
      USING ERRCODE = 'P0001';
  END IF;

  v_restante := ROUND(p_nf_valor - v_fixo, 2);
  IF v_restante <= 0 THEN
    RAISE EXCEPTION 'A nota (R$ %) é menor do que o que já foi pago deste pedido (R$ %). Confira o valor com o fornecedor.',
      to_char(p_nf_valor, 'FM999G999G990D00'), to_char(v_fixo, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT id FROM public.contas_pagar
     WHERE pedido_id = v_conta.pedido_id
       AND COALESCE(ativo, true)
       AND COALESCE(valor_pago, 0) = 0
       AND status NOT IN ('Pago', 'Parcial')
     ORDER BY vencimento, created_at
     FOR UPDATE
  LOOP
    v_i := v_i + 1;
    v_parcela := CASE WHEN v_i < v_n THEN ROUND(v_restante / v_n, 2)
                      ELSE v_restante - v_acum END;
    v_acum := v_acum + v_parcela;

    UPDATE public.contas_pagar
       SET valor = v_parcela
     WHERE id = v_row.id;
  END LOOP;

  -- A conferência é do documento: carimba em todas as parcelas vivas, para
  -- qualquer uma delas mostrar que a nota deste pedido já foi conferida.
  UPDATE public.contas_pagar
     SET nf_valor         = p_nf_valor,
         nf_conferida_em  = now(),
         nf_conferida_por = auth.uid(),
         nf_observacao    = NULLIF(btrim(COALESCE(p_observacao, '')), '')
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true);

  -- MIGR 645: a nota é o custo de verdade (frete, reajuste, entrega a menor).
  -- Até aqui ela só mudava a conta; agora chega ao custo do produto.
  PERFORM public._ajustar_custo_pela_nota(v_conta.pedido_id);

  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id;
  RETURN v_conta;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recebimento_da_entrada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ped public.pedidos;
BEGIN
  IF COALESCE(NEW.ativo, true) IS NOT TRUE
     OR COALESCE(NEW.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NULL;
  END IF;
  -- Só na passagem para conferido (ou na reativação de um conferido, espelho
  -- do estorno de fn_recebimento_inativo_estorna_entrada). Editar a nota de
  -- um recebimento já conferido não dá outra entrada.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.ativo, true)
     AND COALESCE(OLD.status, '') IN ('Concluído', 'Parcial') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_ped FROM public.pedidos WHERE id = NEW.pedido_id;
  -- Serviço não tem saldo; o aceite só libera o pagamento.
  IF v_ped.produto_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A PWA com o bundle antigo grava a entrada ANTES de confirmar. Ela já
  -- está lá: não duplica (uq_mov_estoque_por_recebimento recusaria mesmo).
  IF NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque
                  WHERE recebimento_id = NEW.id AND COALESCE(ativo, true)) THEN
    PERFORM set_config('app.entrada_recebimento', 'true', true);
    INSERT INTO public.movimentacoes_estoque (
      produto_id, tipo, qtd, origem, destino, data, recebimento_id, filial
    ) VALUES (
      v_ped.produto_id, 'Entrada', NEW.qtd_recebida,
      COALESCE(v_ped.numero, 'Pedido #' || upper(right(v_ped.id::text, 6))),
      'Almoxarifado', public.acre_today(), NEW.id, NEW.filial
    );
    PERFORM set_config('app.entrada_recebimento', '', true);
  END IF;

  -- MIGR 645: a carga entra pelo preço do pedido (fn_custo_medio_da_entrada).
  -- Se a nota deste pedido já foi conferida, a diferença desta carga vai ao
  -- custo agora — o ajuste é incremental e não conta duas vezes o que já foi.
  PERFORM public._ajustar_custo_pela_nota(NEW.pedido_id);

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_dre(p_filial text, p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_consumo         numeric(15,2);
  v_consumo_sem     integer;
  v_cmv_ajuste      numeric(15,2);
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

  -- MIGR 645: diferença entre a nota e o pedido na parte da mercadoria que já
  -- tinha sido vendida quando a nota foi conferida. O que ainda estava em
  -- estoque foi para o custo médio e sai no CMV das vendas seguintes.
  SELECT COALESCE(SUM(a.valor_resultado), 0)
    INTO v_cmv_ajuste
    FROM public.ajustes_custo_compra a
   WHERE a.filial = p_filial
     AND a.destino = 'cmv'
     AND a.data BETWEEN p_inicio AND p_fim;
  v_cmv := ROUND(v_cmv + v_cmv_ajuste, 2);

  v_lucro_bruto := ROUND(v_receita_liquida - v_cmv, 2);

  -- Migr. 442/447/508: material de consumo que saiu para os setores no período.
  SELECT COALESCE(SUM(cm.valor), 0),
         COUNT(*) FILTER (WHERE cm.custo_unitario IS NULL)
    INTO v_consumo, v_consumo_sem
    FROM public.consumos_material cm
   WHERE cm.ativo = true
     AND cm.filial = p_filial
     AND cm.data BETWEEN p_inicio AND p_fim;

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
         AND COALESCE(cp.natureza, 'despesa') NOT IN ('estoque', 'imobilizado')
         AND COALESCE(cp.origem, '') NOT IN ('devolucao_pdv', 'emprestimo')
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado')

      UNION ALL

      SELECT COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cm.valor), 2) AS valor
        FROM public.consumos_material cm
        LEFT JOIN public.centros_custo cc2 ON cc2.id = cm.centro_custo_id
       WHERE cm.ativo = true
         AND cm.filial = p_filial
         AND cm.data BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado')

      UNION ALL

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

      UNION ALL

      -- MIGR 645: mesma diferença, para material de consumo já consumido.
      SELECT 'Ajuste de custo de compras'::text AS grupo, ROUND(SUM(a.valor_resultado), 2) AS valor
        FROM public.ajustes_custo_compra a
       WHERE a.filial = p_filial
         AND a.destino = 'despesa'
         AND a.data BETWEEN p_inicio AND p_fim
      HAVING ROUND(SUM(a.valor_resultado), 2) <> 0

      UNION ALL

      SELECT 'Depreciação'::text AS grupo, ROUND(SUM(dep.valor_dia), 2) AS valor
        FROM (
          SELECT GREATEST(0,
                   LEAST(p_fim,
                         COALESCE(p.patrimonio_baixado_em, 'infinity'::date),
                         (p.created_at::date + (p.patrimonio_vida_util_meses || ' months')::interval - '1 day'::interval)::date)
                   - GREATEST(p_inicio, p.created_at::date) + 1
                 ) * (COALESCE(pc.preco_custo, 0))
                   / p.patrimonio_vida_util_meses / 30.0 AS valor_dia
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND COALESCE(p.ativo, true)
             AND p.filial = p_filial
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
             AND p.created_at::date <= p_fim
             AND (p.patrimonio_baixado_em IS NULL OR p.patrimonio_baixado_em >= p_inicio)
        ) dep
      HAVING ROUND(SUM(dep.valor_dia), 2) > 0

      UNION ALL

      SELECT 'Baixa de imobilizado'::text AS grupo, ROUND(SUM(bx.resultado), 2) AS valor
        FROM (
          SELECT (COALESCE(pc.preco_custo, 0))
                 * GREATEST(0, 1 - (p.patrimonio_baixado_em - p.created_at::date)::numeric
                                   / (p.patrimonio_vida_util_meses * 30.0))
                 - COALESCE(p.patrimonio_valor_venda, 0) AS resultado
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND COALESCE(p.ativo, true)
             AND p.filial = p_filial
             AND p.patrimonio_baixado_em BETWEEN p_inicio AND p_fim
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
        ) bx
      HAVING ROUND(SUM(bx.resultado), 2) <> 0
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
    'cmv_ajuste_compras', v_cmv_ajuste,
    'lucro_bruto',      v_lucro_bruto,
    'margem_bruta_pct', CASE WHEN v_receita_liquida > 0
                             THEN ROUND(100 * v_lucro_bruto / v_receita_liquida, 1) END,
    'despesas',         v_despesas,
    'despesas_grupos',  v_grupos,
    'consumo_material', v_consumo,
    'consumos_sem_custo', v_consumo_sem,
    'resultado',        v_resultado,
    'margem_liquida_pct', CASE WHEN v_receita_liquida > 0
                               THEN ROUND(100 * v_resultado / v_receita_liquida, 1) END,
    'itens_vendidos',   v_itens,
    'itens_sem_custo',  v_sem_custo
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
