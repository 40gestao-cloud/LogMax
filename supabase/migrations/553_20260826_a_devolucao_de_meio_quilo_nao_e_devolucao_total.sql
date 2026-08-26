-- 553 — A devolução de meio quilo não é devolução total.
--
-- `criar_devolucao_venda` decide se a devolução é 'Parcial' ou 'Total' contando
-- as duas pontas — e conta em INTEIROS:
--
--     v_qtd_vendida   int;
--     v_qtd_total_dev int;
--     ...
--     SELECT COALESCE(SUM(qtd), 0)::int INTO v_qtd_vendida   FROM itens_venda ...
--     SELECT COALESCE(SUM(id2.qtd), 0)::int INTO v_qtd_total_dev FROM itens_devolucao ...
--     v_tipo := CASE WHEN v_qtd_total_dev >= v_qtd_vendida THEN 'Total' ELSE 'Parcial' END;
--
-- Mas `itens_venda.qtd` é `numeric(15,3)`, e é assim desde a migr. 079
-- justamente porque a mercearia vende por peso. O `::int` arredonda antes de
-- comparar, e o rótulo do documento sai errado nos dois sentidos:
--
--   · venda de 0,4 kg, devolução de 0,0 →  0 >= 0  → 'Total' sem devolver nada
--   · venda de 2,4 kg, devolução de 0,6 →  1 >= 2  → fica 'Parcial' (certo por
--     acidente, mas 2,4 devolvidos de 2,4 dá 2 >= 2 → 'Total', também por
--     acidente — o acerto e o erro vêm do mesmo arredondamento)
--
-- Nada disso move dinheiro nem estoque: valor e movimentação usam `v_qtd`
-- numérico, intactos. O que sai errado é o TIPO gravado em `devolucoes.tipo` —
-- que é o que o aluno lê na tela, e o que separa "o cliente devolveu a compra"
-- de "o cliente trocou um item". Rótulo errado num documento é o defeito da
-- migr. 530 outra vez: número sem correspondência com o fato ensina a ignorar
-- o número.
--
-- A comparação passa a ser numérica com a mesma tolerância que o resto do
-- sistema usa para fechar saldo (0,0005 — vide `fn_recebimento_status_pelo_saldo`,
-- migr. 489), porque `numeric` some não fecha exato quando a venda foi em
-- frações de quilo.
--
-- ─── E UM COMENTÁRIO QUE VAI ENGANAR A PRÓXIMA PESSOA ──────────────────────
--
-- Dentro de `fn_venda_cancelada_desfaz`, o bloco 1.3 diz:
--
--     -- 1.3 Cobrança. O elo com a venda é a descrição — `contas_receber` não
--     -- tem `venda_id`, e é assim que a 203 já casa as duas pontas.
--
-- Três linhas acima de `WHERE cr.venda_id = NEW.id`. A coluna foi criada
-- depois, o código migrou para ela e o comentário ficou. Custo zero hoje; o
-- custo é a próxima pessoa que ler o comentário, acreditar, e escrever o
-- próximo desfazimento casando por texto — reintroduzindo o elo frágil que já
-- foi substituído. Só o comentário muda.
--
-- Zero vendas e zero devoluções nas quatro turmas em 26/08.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Parcial x Total conta em numeric
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_devolucao_venda(
  p_venda_id uuid, p_itens jsonb, p_motivo text, p_forma_estorno text, p_filial text)
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
    -- MIGR 553: eram `int`. A mercearia vende por peso desde a migr. 079.
    v_qtd_vendida      numeric(15,3);
    v_qtd_total_dev    numeric(15,3);
    v_tipo             text;
    v_restante         numeric(15,2);
    v_conta            record;
    v_desc_dev         text;
    v_caixa_id         uuid;
    v_nome_operador    text;
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

    -- Migr. 450: dinheiro vivo exige gaveta aberta, e a checagem vem ANTES de
    -- gravar qualquer coisa — falhar no meio deixaria o estoque de volta e o
    -- dinheiro sem registro, que é o oposto do que esta migração corrige.
    IF p_forma_estorno = 'devolve_caixa' THEN
        SELECT id INTO v_caixa_id
          FROM public.controle_caixa
         WHERE filial = p_filial
           AND data = v_today
           AND status = 'Aberto'
           AND COALESCE(ativo, true)
         ORDER BY aberto_em DESC NULLS LAST
         LIMIT 1;

        IF v_caixa_id IS NULL THEN
            RAISE EXCEPTION
              'Não há caixa aberto na % hoje: não se tira dinheiro de gaveta fechada. Abra o caixa, ou devolva por "Cancelar pendências".',
              p_filial USING ERRCODE = 'P0001';
        END IF;
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

    -- MIGR 553: sem `::int`. Meio quilo devolvido de meio quilo vendido é
    -- devolução total; meio quilo de dois quilos e meio não é.
    SELECT COALESCE(SUM(qtd), 0) INTO v_qtd_vendida
    FROM public.itens_venda WHERE venda_id = p_venda_id;

    SELECT COALESCE(SUM(id2.qtd), 0) INTO v_qtd_total_dev
    FROM public.itens_devolucao id2
    JOIN public.devolucoes d ON d.id = id2.devolucao_id
    WHERE d.venda_id = p_venda_id AND d.ativo = true AND d.status = 'Concluída';

    -- Tolerância de 0,0005, a mesma que a migr. 489 usa para fechar saldo:
    -- soma de numeric em frações de quilo não bate exato.
    v_tipo := CASE WHEN v_qtd_total_dev >= v_qtd_vendida - 0.0005
                   THEN 'Total' ELSE 'Parcial' END;

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
              AND c.venda_id = p_venda_id
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

        -- Sobra de venda já paga. NÃO vira sangria: ver o cabeçalho — aqui o
        -- operador não declarou saída de gaveta, e supor a forma do troco é a
        -- adivinhação que esta auditoria não faz.
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

        -- Migr. 450: o dinheiro que saiu da gaveta, dito pelo nome que o
        -- fechamento entende. As duas RPCs de fechamento já descontam sangrias
        -- do esperado — nada nelas precisou mudar.
        IF v_valor_total > 0 THEN
            SELECT nome INTO v_nome_operador
              FROM public.user_profiles WHERE id = auth.uid();

            PERFORM set_config('app.devolucao_caixa', 'true', true);

            INSERT INTO public.movimentacoes_caixa (
                controle_caixa_id, tipo, valor, motivo, filial,
                criado_por, criado_por_nome
            ) VALUES (
                v_caixa_id, 'sangria', v_valor_total, v_desc_dev, p_filial,
                auth.uid(), v_nome_operador
            );

            PERFORM set_config('app.devolucao_caixa', 'false', true);
        END IF;
    ELSE
        RAISE EXCEPTION 'forma_estorno inválida: %', p_forma_estorno;
    END IF;

    RETURN v_dev_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O comentário passa a dizer o que o código faz
-- ────────────────────────────────────────────────────────────────────────────
-- Só o bloco 1.3 muda. Nenhuma linha de código é tocada.
CREATE OR REPLACE FUNCTION public.fn_venda_cancelada_desfaz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_short   text := upper(right(NEW.id::text, 6));
  v_hoje    date := public.acre_today();
  v_origem  text;
  v_item    record;
  v_marca   text;
BEGIN
  v_origem := 'Estorno — Venda #' || v_short || ' cancelada';
  v_marca  := ' [venda #' || v_short || ' cancelada — devolver ao cliente]';

  -- 1.1 Estoque de volta. Uma Entrada por item, com guard de idempotência pela
  -- origem: se a tela antiga já estornou este item, não estorna de novo.
  FOR v_item IN
    SELECT iv.produto_id, SUM(iv.qtd) AS qtd
      FROM public.itens_venda iv
     WHERE iv.venda_id = NEW.id
       AND iv.produto_id IS NOT NULL
     GROUP BY iv.produto_id
    HAVING SUM(iv.qtd) > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.movimentacoes_estoque me
       WHERE me.produto_id = v_item.produto_id
         AND me.origem = v_origem
         AND COALESCE(me.ativo, true)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.movimentacoes_estoque
      (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES
      (v_item.produto_id, 'Entrada', v_item.qtd, v_origem, 'Almoxarifado',
       v_hoje, COALESCE(NEW.filial, 'SuperMax'));
  END LOOP;

  -- 1.2 Aparelho de volta para 'Em estoque'. Mesma decisão da 446: o vínculo
  -- com a venda antiga PERMANECE (o recibo já emitido lê `venda_id` para
  -- imprimir o IMEI); só o estado muda, e a próxima venda sobrescreve.
  UPDATE public.produto_unidades pu
     SET status     = 'Em estoque',
         vendida_em = NULL,
         observacao = trim(both ' ' from COALESCE(pu.observacao || ' | ', '')
           || 'Venda ' || v_short || ' cancelada em '
           || to_char(v_hoje, 'DD/MM/YYYY'))
   WHERE pu.ativo
     AND pu.venda_id = NEW.id
     AND pu.status = 'Vendida';

  -- 1.3 Cobrança. O elo é `contas_receber.venda_id` — a coluna existe e
  -- `criar_venda_pdv` a grava em toda venda. (Até a migr. 553 este comentário
  -- dizia que a coluna NÃO existia e que o elo era a descrição: era verdade
  -- quando a 448 foi escrita, e deixou de ser quando a coluna nasceu. O código
  -- migrou; o comentário não. Quem escrever o próximo desfazimento usa
  -- `venda_id`, não texto.)
  UPDATE public.contas_receber cr
     SET status     = 'Cancelado',
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.venda_id = NEW.id
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) = 0;

  -- Dinheiro que entrou fica, e fica VISÍVEL. `position` em vez de LIKE para
  -- não marcar duas vezes se o gatilho rodar de novo.
  UPDATE public.contas_receber cr
     SET descricao  = cr.descricao || v_marca,
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.venda_id = NEW.id
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) > 0
     AND position(v_marca in cr.descricao) = 0;

  RETURN NEW;
END;
$function$;

COMMIT;
