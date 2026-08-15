-- 426_20260814_o_que_a_auditoria_do_dia_encontrou.sql
--
-- Revisão das migrações 416–425 cruzando-as entre si e com o que já existia.
-- Duas delas se chocam com a `criar_devolucao_venda` (migr. 203), que nenhuma
-- tocou e que nenhuma previu. Os dois defeitos são de dinheiro.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DEFEITO 1 — O DRE CONTA A DEVOLUÇÃO DE VENDA DUAS VEZES
--
-- `criar_devolucao_venda` lança o estorno como `contas_pagar` com
-- `origem = 'devolucao_pdv'`. A migr. 425 subtrai as devoluções da receita E
-- soma todas as contas a pagar sem pedido como despesa — então a mesma
-- devolução entra duas vezes, uma em cada ponta.
--
-- Numa filial que devolveu R$ 1.000 no mês, o resultado sai R$ 1.000 pior do
-- que foi. O erro cresce com o uso da tela de Devoluções, que é justamente o
-- que se quer que a turma use.
--
-- Junto disso, o CMV não devolvia nada: a receita caía com a devolução e o
-- custo da mercadoria que voltou para a prateleira continuava lá. Agora sai.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DEFEITO 2 — DEVOLVER UMA VENDA COM BAIXA PARCIAL PAGA O CLIENTE DUAS VEZES
--
-- `criar_devolucao_venda` varre `contas_receber` com `status = 'Aberto'` para
-- cancelar o que ainda seria cobrado. A migr. 422 criou o status **'Parcial'**,
-- que essa varredura não conhece.
--
-- O estrago: cliente compra R$ 1.000 a prazo, paga R$ 300, devolve a
-- mercadoria. A conta (agora 'Parcial') é ignorada, o valor inteiro cai no
-- ramo "venda já paga" e o sistema gera R$ 1.000 de saída de caixa para
-- devolver ao cliente — que só tinha pagado R$ 300. A loja perde R$ 700 e o
-- título fica em aberto.
--
-- A correção trata a conta pelo SALDO (valor − o que já foi recebido) e, na
-- conta que já recebeu alguma coisa, **não cancela**: baixa o valor até o que
-- foi pago e marca como quitada. O cliente fica quite pelo que pagou, e o que
-- sobrar de estorno segue para o ramo de devolução em dinheiro — que aí sim é
-- dinheiro que entrou.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE FOI OLHADO E ESTÁ CERTO (para a próxima auditoria não repetir)
--
--   • 417 × 423: a devolução ao fornecedor entra como 'Saída' e não mexe no
--     custo médio, que só reage a 'Entrada' com recebimento.
--   • 422 × trigger de saldo: baixa após baixa credita a diferença, porque a
--     função compara o valor antigo com o novo.
--   • 423 × índice único por recebimento: a saída da devolução vai com
--     `recebimento_id` NULL, então não colide com a entrada.
--   • 425 × compra de mercadoria: contas com `pedido_id` já estavam fora das
--     despesas (viram CMV).
--   • 416 × 422: `cliente_saldo_devedor` desconta as baixas, então pagar
--     libera limite.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. DRE: devolução de venda entra uma vez só, e devolve o custo junto
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
         AND COALESCE(cp.origem, '') <> 'devolucao_pdv'
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado')
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
-- 2. Devolução de venda passa a enxergar a conta parcialmente recebida
--
-- Corpo copiado do banco; a mudança está só no laço de `cancela_pendencias`.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.criar_devolucao_venda(
  p_venda_id uuid, p_itens jsonb, p_motivo text, p_forma_estorno text, p_filial text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_dev_id           uuid;
    v_valor_total      numeric(15,2) := 0;
    v_venda            public.vendas%ROWTYPE;
    v_short_id         text;
    v_today            date := public.acre_today();
    v_item             jsonb;
    v_produto_id       uuid;
    v_nome             text;
    v_qtd              numeric(15,3);
    v_preco            numeric(15,2);
    v_subtotal         numeric(15,2);
    v_saldo_dispon     numeric(15,3);
    v_qtd_vendida      int;
    v_qtd_total_dev    int;
    v_tipo             text;
    v_restante         numeric(15,2);
    v_conta            record;
    v_desc_dev         text;
BEGIN
    -- RBAC: só admin/CEO ou gerente da filial
    IF NOT (public.auth_is_admin() OR public.auth_gerente_da(p_filial)) THEN
        RAISE EXCEPTION 'Sem permissão para autorizar devolução na filial %.', p_filial
            USING ERRCODE = '42501';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Motivo da devolução é obrigatório.';
    END IF;

    IF jsonb_array_length(COALESCE(p_itens, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Informe ao menos 1 item para devolução.';
    END IF;

    SELECT * INTO v_venda FROM public.vendas WHERE id = p_venda_id AND ativo = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venda não encontrada ou inativa.';
    END IF;

    v_short_id := UPPER(RIGHT(v_venda.id::text, 6));

    INSERT INTO public.devolucoes (
        venda_id, motivo, tipo, valor_devolvido, forma_estorno, status,
        autorizada_por, filial, criado_por
    ) VALUES (
        p_venda_id, p_motivo, 'Parcial', 0, p_forma_estorno, 'Concluída',
        auth.uid(), p_filial, auth.uid()
    ) RETURNING id INTO v_dev_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
        v_produto_id := NULLIF(v_item->>'produto_id','')::uuid;
        v_nome       := v_item->>'nome_produto';
        v_qtd        := (v_item->>'qtd')::numeric;
        v_preco      := (v_item->>'preco_unitario')::numeric;
        v_subtotal   := ROUND(v_qtd * v_preco, 2);

        IF v_qtd <= 0 THEN
            RAISE EXCEPTION 'Quantidade inválida para %: %', v_nome, v_qtd;
        END IF;

        SELECT COALESCE(SUM(qtd_saldo), 0) INTO v_saldo_dispon
        FROM public.v_venda_saldo_devolucao
        WHERE venda_id = p_venda_id
          AND nome_produto = v_nome
          AND (v_produto_id IS NULL OR produto_id IS NOT DISTINCT FROM v_produto_id);

        IF v_qtd > v_saldo_dispon THEN
            RAISE EXCEPTION 'Item "%" excede o saldo devolvível (max: %).',
                v_nome, v_saldo_dispon;
        END IF;

        INSERT INTO public.itens_devolucao (
            devolucao_id, produto_id, nome_produto, qtd, preco_unitario, subtotal
        ) VALUES (
            v_dev_id, v_produto_id, v_nome, v_qtd, v_preco, v_subtotal
        );

        IF v_produto_id IS NOT NULL THEN
            INSERT INTO public.movimentacoes_estoque (
                produto_id, tipo, qtd, origem, destino, data, filial
            ) VALUES (
                v_produto_id, 'Entrada', v_qtd,
                'Devolução venda #' || v_short_id, 'Estoque',
                v_today, p_filial
            );
        END IF;

        v_valor_total := v_valor_total + v_subtotal;
    END LOOP;

    SELECT COALESCE(SUM(qtd), 0)::int INTO v_qtd_vendida
    FROM public.itens_venda WHERE venda_id = p_venda_id;

    SELECT COALESCE(SUM(id2.qtd), 0)::int INTO v_qtd_total_dev
    FROM public.itens_devolucao id2
    JOIN public.devolucoes d ON d.id = id2.devolucao_id
    WHERE d.venda_id = p_venda_id AND d.ativo = true AND d.status = 'Concluída';

    v_tipo := CASE WHEN v_qtd_total_dev >= v_qtd_vendida THEN 'Total' ELSE 'Parcial' END;

    UPDATE public.devolucoes
    SET valor_devolvido = v_valor_total, tipo = v_tipo, updated_at = now()
    WHERE id = v_dev_id;

    v_desc_dev := 'Devolução venda #' || v_short_id || ' — ' || p_motivo;

    v_restante := v_valor_total;

    IF p_forma_estorno = 'cancela_pendencias' THEN
        -- 'Parcial' entra na varredura (migr. 422/426). O que se cancela é o
        -- SALDO — valor menos o que já foi recebido —, nunca o valor cheio de
        -- uma conta que já teve baixa: era assim que a loja devolvia dinheiro
        -- que nunca entrou.
        FOR v_conta IN
            SELECT c.*, GREATEST(c.valor - COALESCE(c.valor_pago, 0), 0) AS saldo
            FROM public.contas_receber c
            WHERE c.ativo = true
              AND c.status IN ('Aberto', 'Parcial')
              AND c.descricao LIKE '%#' || v_short_id || '%'
            ORDER BY c.vencimento DESC NULLS LAST
        LOOP
            EXIT WHEN v_restante <= 0;
            CONTINUE WHEN v_conta.saldo <= 0;

            IF v_conta.saldo <= v_restante THEN
                IF COALESCE(v_conta.valor_pago, 0) > 0 THEN
                    -- Já recebeu parte: em vez de cancelar (o que faria o
                    -- trigger de saldo estornar do banco dinheiro real), a
                    -- conta passa a valer o que foi pago e fica quitada.
                    UPDATE public.contas_receber
                    SET valor = v_conta.valor_pago,
                        status = 'Pago',
                        pago_em = COALESCE(pago_em, v_today),
                        updated_at = now()
                    WHERE id = v_conta.id;
                ELSE
                    UPDATE public.contas_receber
                    SET status = 'Cancelado', updated_at = now()
                    WHERE id = v_conta.id;
                END IF;
                v_restante := v_restante - v_conta.saldo;
            ELSE
                UPDATE public.contas_receber
                SET valor = v_conta.valor - v_restante, updated_at = now()
                WHERE id = v_conta.id;
                v_restante := 0;
            END IF;
        END LOOP;

        IF v_restante > 0 THEN
            INSERT INTO public.contas_pagar (
                descricao, valor, vencimento, status, filial, origem
            ) VALUES (
                v_desc_dev || ' (saída — venda já paga)',
                v_restante, v_today, 'Pago', p_filial, 'devolucao_pdv'
            );
        END IF;

    ELSIF p_forma_estorno = 'devolve_caixa' THEN
        INSERT INTO public.contas_pagar (
            descricao, valor, vencimento, status, filial, origem
        ) VALUES (
            v_desc_dev, v_valor_total, v_today, 'Pago', p_filial, 'devolucao_pdv'
        );
    ELSE
        RAISE EXCEPTION 'forma_estorno inválida: %', p_forma_estorno;
    END IF;

    RETURN v_dev_id;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
