-- 450_20260817_o_dinheiro_da_devolucao_saia_da_gaveta_sem_avisar.sql
--
-- DEVOLVER EM DINHEIRO TIRAVA DA GAVETA E O CAIXA NÃO SABIA.
--
-- Terceiro item da auditoria de erro caro e silencioso, irmão do que a migr.
-- 448 corrigiu no cancelamento. Mesmo sintoma, outra origem.
--
-- `criar_devolucao_venda` no modo "Devolver no caixa (dinheiro / à vista)"
-- entrega dinheiro ao cliente e registra uma `contas_pagar` já paga. Só que o
-- esperado do caixa é `abertura + vendas em dinheiro + suprimentos − sangrias`
-- — e a devolução não é nenhuma dessas quatro coisas. O dinheiro sai da gaveta
-- sem que a conta do fechamento fique sabendo:
--
--   abre com 200, vende 500 em dinheiro   → esperado 700
--   devolve 150 em dinheiro ao cliente    → esperado 700, gaveta 550
--   fecha                                 → FALTA de 150
--
-- O operador é acusado de quebrar o caixa por ter feito exatamente o que a
-- tela mandou. E o valor da falta é o valor da devolução, o que torna o erro
-- plausível: parece caixa mal operado, não software errado.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A CORREÇÃO É UMA SANGRIA, NÃO UMA CONTA NOVA
--
-- Dinheiro que sai da gaveta é sangria — é isso que a palavra significa no
-- caixa. E `movimentacoes_caixa` do tipo 'sangria' JÁ é subtraída do esperado
-- pelas duas RPCs de fechamento. Registrando o fato pelo nome certo, o cálculo
-- fica correto sem que uma linha dele mude.
--
-- Nada disso toca o DRE: sangria não é despesa, e o valor devolvido já sai da
-- receita por `v_devolucoes` em `gerar_dre`. Duas portas era o risco a evitar
-- aqui — a devolução não pode ser abatida do resultado duas vezes.
--
-- SEM CAIXA ABERTO, A DEVOLUÇÃO EM DINHEIRO NÃO ACONTECE
--
-- Não se tira dinheiro de gaveta fechada. É a mesma régua que o PDV já aplica
-- do outro lado do balcão — sem caixa aberto a venda não passa — e o erro que
-- ela produz é visível na hora, na tela, em vez de aparecer no fechamento como
-- uma falta que ninguém explica.
--
-- A devolução continua possível: o modo "Cancelar pendências" não depende de
-- caixa. O que fica bloqueado é entregar dinheiro vivo fora do expediente.
--
-- POR QUE O RESÍDUO DO "CANCELAR PENDÊNCIAS" NÃO VIRA SANGRIA
--
-- Naquele modo, quando a venda já estava paga e sobra valor, a função cria uma
-- `contas_pagar` de saída. Tentador tratar igual — e errado. Ali o operador
-- não declarou saída de gaveta: o cliente pode ter pago em cartão ou Pix, e o
-- estorno sair por outro meio. O sistema reage ao que foi DECLARADO; supor a
-- forma do troco seria a mesma adivinhação que esta auditoria existe para não
-- fazer. `devolucoes.forma_estorno` diz qual foi, e só um dos dois valores
-- afirma "dinheiro".
--
-- O GUARD DO CAIXA PRECISOU DE UMA PORTA
--
-- `movimentacao_caixa_guard` exige setor financeiro/vendas ou role gerente.
-- Devolução é autorizada por admin/CEO OU gerente da filial — um CEO sem
-- aqueles setores passaria pela RPC e esbarraria no guard, derrubando a
-- devolução inteira com erro de permissão de caixa.
--
-- A saída é a flag de transação que o projeto já usa em `fn_block_estoque_manual`
-- (`app.allow_estoque_update`): a RPC marca a transação como autorizada, o
-- guard aceita. A autoridade continua sendo checada — no topo da RPC, que é
-- onde ela pertence. A flag é `is_local`: morre no fim da transação e não há
-- caminho por onde um cliente PostgREST a acenda sozinho.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. O guard aceita a sangria que a devolução autorizada emite ────────────
-- Corpo copiado do banco; a única mudança é a cláusula da flag.

CREATE OR REPLACE FUNCTION public.movimentacao_caixa_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial_caixa text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT filial INTO v_filial_caixa
    FROM public.controle_caixa
   WHERE id = NEW.controle_caixa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa % não encontrado.', NEW.controle_caixa_id USING ERRCODE = 'P0002';
  END IF;

  -- A movimentação é da filial do caixa. Divergência é erro de quem chamou.
  IF NEW.filial IS DISTINCT FROM v_filial_caixa THEN
    RAISE EXCEPTION 'Movimentação declarada como % mas o caixa é da unidade %.',
      NEW.filial, v_filial_caixa USING ERRCODE = '42501';
  END IF;

  -- Migr. 450: sangria emitida por `criar_devolucao_venda`, que já exigiu
  -- admin/CEO ou gerente DA FILIAL antes de gravar qualquer coisa. Sem esta
  -- porta, um CEO sem setor financeiro/vendas teria a devolução derrubada
  -- aqui, depois de o estoque já ter voltado.
  IF COALESCE(current_setting('app.devolucao_caixa', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NOT ((public.auth_in_setor('financeiro', 'vendas') OR public.auth_user_role() = 'gerente')
          AND public.auth_pode_filial(v_filial_caixa)) THEN
    RAISE EXCEPTION 'Sem permissão para movimentar o caixa da unidade %.', v_filial_caixa
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. A devolução em dinheiro passa pelo caixa ─────────────────────────────
-- Corpo copiado do banco (o das migrs. 422/426, não o da 203 original).
-- Mudanças: guard de caixa aberto no topo e a sangria no ramo 'devolve_caixa'.

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
    v_qtd_vendida      int;
    v_qtd_total_dev    int;
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

COMMENT ON FUNCTION public.criar_devolucao_venda(uuid, jsonb, text, text, text) IS
    'Devolução parcial ou total de venda PDV. RBAC: gerente da filial ou admin/CEO. Transacional. Migr. 450: o modo "devolve_caixa" exige caixa aberto e lança a sangria correspondente — sem ela o fechamento acusava falta do valor devolvido.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. as duas funções trazem a marca desta migração — esperado: 2 linhas
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('criar_devolucao_venda','movimentacao_caixa_guard')
--      AND prosrc LIKE '%app.devolucao_caixa%';
--
--   -- 2. passivo: devolução em dinheiro sem a sangria correspondente.
--   --    O que aparecer aqui é anterior a esta migração — o esperado daqueles
--   --    caixas foi calculado a maior, e a diferença registrada no fechamento
--   --    é falsa no valor da devolução.
--   SELECT d.created_at::date, d.filial, d.valor_devolvido, d.motivo
--     FROM devolucoes d
--    WHERE d.ativo
--      AND d.forma_estorno = 'devolve_caixa'
--      AND d.valor_devolvido > 0
--      AND NOT EXISTS (
--          SELECT 1 FROM movimentacoes_caixa mc
--            JOIN controle_caixa cc ON cc.id = mc.controle_caixa_id
--           WHERE mc.tipo = 'sangria'
--             AND cc.filial = d.filial
--             AND cc.data = d.created_at::date
--             AND mc.motivo LIKE 'Devolução venda #%')
--    ORDER BY 1 DESC;
--
--   -- 3. caixas cujo fechamento pode ter sido acusado por isso
--   SELECT cc.data, cc.filial, cc.diferenca, cc.tipo_diferenca
--     FROM controle_caixa cc
--    WHERE cc.tipo_diferenca = 'falta'
--      AND EXISTS (SELECT 1 FROM devolucoes d
--                   WHERE d.ativo AND d.forma_estorno = 'devolve_caixa'
--                     AND d.filial = cc.filial AND d.created_at::date = cc.data)
--    ORDER BY 1 DESC;
--
-- Caixa já fechado não é reaberto por migração: o valor contado naquele dia é
-- um fato histórico, e reescrever a diferença apagaria o registro de uma
-- conferência que a turma fez. A sonda 3 mostra quais fechamentos merecem a
-- releitura, e a decisão é de quem estava lá.
--
-- O teste que vale a aula: abrir o caixa, vender em dinheiro, devolver o item
-- pelo modo "Devolver no caixa" e fechar — a sangria aparece no extrato do
-- caixa e o fechamento bate. Depois, tentar a mesma devolução com o caixa
-- fechado e ler a mensagem.
-- =================================================================
