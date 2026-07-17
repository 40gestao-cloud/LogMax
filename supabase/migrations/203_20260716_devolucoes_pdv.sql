-- 203_20260716_devolucoes_pdv.sql
-- Módulo de devoluções do PDV — devolução parcial em 1 passo:
--   * tabelas devolucoes + itens_devolucao (soft-delete, snapshot de nome/preço)
--   * RPC criar_devolucao_venda(): valida saldo por item, insere devolução,
--     entrada de estoque e trata estorno financeiro (cancela contas_receber
--     pendentes OU cria contas_pagar de saída de caixa)
-- Autorização: admin/CEO ou gerente da filial (colaborador NÃO devolve).
-- Idempotente.

BEGIN;

-- 1. Devolução (cabeçalho)
CREATE TABLE IF NOT EXISTS public.devolucoes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    venda_id          uuid NOT NULL REFERENCES public.vendas(id),
    motivo            text NOT NULL,
    tipo              text NOT NULL DEFAULT 'Parcial'
                          CHECK (tipo IN ('Parcial','Total')),
    valor_devolvido   numeric(15,2) NOT NULL,
    forma_estorno     text NOT NULL
                          CHECK (forma_estorno IN ('cancela_pendencias','devolve_caixa')),
    status            text NOT NULL DEFAULT 'Concluída'
                          CHECK (status IN ('Concluída','Cancelada')),
    autorizada_por    uuid REFERENCES auth.users(id),
    filial            text NOT NULL,
    ativo             boolean NOT NULL DEFAULT true,
    criado_por        uuid REFERENCES auth.users(id),
    atualizado_por    uuid REFERENCES auth.users(id),
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devolucoes_venda    ON public.devolucoes(venda_id) WHERE ativo=true;
CREATE INDEX IF NOT EXISTS idx_devolucoes_filial   ON public.devolucoes(filial)   WHERE ativo=true;

-- 2. Itens da devolução
CREATE TABLE IF NOT EXISTS public.itens_devolucao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    devolucao_id    uuid NOT NULL REFERENCES public.devolucoes(id) ON DELETE CASCADE,
    produto_id      uuid REFERENCES public.produtos(id),
    nome_produto    text NOT NULL,
    qtd             numeric(15,3) NOT NULL CHECK (qtd > 0),
    preco_unitario  numeric(15,2) NOT NULL,
    subtotal        numeric(15,2) NOT NULL,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itens_devolucao_devolucao ON public.itens_devolucao(devolucao_id);

-- 3. RLS
ALTER TABLE public.devolucoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens_devolucao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devolucoes_select    ON public.devolucoes;
DROP POLICY IF EXISTS devolucoes_insert    ON public.devolucoes;
DROP POLICY IF EXISTS devolucoes_update    ON public.devolucoes;

-- SELECT: quem pode ver a filial vê as devoluções da filial
CREATE POLICY devolucoes_select ON public.devolucoes
    FOR SELECT USING (public.auth_pode_filial(filial));

-- INSERT / UPDATE: só admin/CEO ou gerente da filial (RBAC gerencial).
-- O caminho normal é via RPC criar_devolucao_venda (SECURITY DEFINER); esta
-- policy é defesa em profundidade caso algum caller tente insert direto.
CREATE POLICY devolucoes_insert ON public.devolucoes
    FOR INSERT WITH CHECK (public.auth_is_admin() OR public.auth_gerente_da(filial));

CREATE POLICY devolucoes_update ON public.devolucoes
    FOR UPDATE USING (public.auth_is_admin() OR public.auth_gerente_da(filial))
    WITH CHECK (public.auth_is_admin() OR public.auth_gerente_da(filial));

DROP POLICY IF EXISTS itens_devolucao_select ON public.itens_devolucao;
DROP POLICY IF EXISTS itens_devolucao_write  ON public.itens_devolucao;

CREATE POLICY itens_devolucao_select ON public.itens_devolucao
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.devolucoes d
                WHERE d.id = devolucao_id
                  AND public.auth_pode_filial(d.filial))
    );

CREATE POLICY itens_devolucao_write ON public.itens_devolucao
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.devolucoes d
                WHERE d.id = devolucao_id
                  AND (public.auth_is_admin() OR public.auth_gerente_da(d.filial)))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.devolucoes d
                WHERE d.id = devolucao_id
                  AND (public.auth_is_admin() OR public.auth_gerente_da(d.filial)))
    );

GRANT SELECT, INSERT, UPDATE ON public.devolucoes      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.itens_devolucao TO authenticated;

-- 4. View helper: quanto de cada item de venda já foi devolvido
CREATE OR REPLACE VIEW public.v_venda_saldo_devolucao AS
SELECT
    iv.id                                 AS item_venda_id,
    iv.venda_id                           AS venda_id,
    iv.produto_id                         AS produto_id,
    iv.nome_produto                       AS nome_produto,
    iv.qtd                                AS qtd_vendida,
    iv.preco_unitario                     AS preco_unitario,
    COALESCE(SUM(id2.qtd) FILTER (
        WHERE d.ativo = true AND d.status = 'Concluída'
    ), 0)::numeric(15,3)                  AS qtd_devolvida,
    GREATEST(
        iv.qtd - COALESCE(SUM(id2.qtd) FILTER (
            WHERE d.ativo = true AND d.status = 'Concluída'
        ), 0),
        0
    )::numeric(15,3)                      AS qtd_saldo
FROM public.itens_venda iv
LEFT JOIN public.itens_devolucao id2
       ON id2.produto_id IS NOT DISTINCT FROM iv.produto_id
      AND id2.nome_produto = iv.nome_produto
LEFT JOIN public.devolucoes d
       ON d.id = id2.devolucao_id
      AND d.venda_id = iv.venda_id
GROUP BY iv.id, iv.venda_id, iv.produto_id, iv.nome_produto, iv.qtd, iv.preco_unitario;

COMMENT ON VIEW public.v_venda_saldo_devolucao IS
    'Saldo devolvível por item de venda. Frontend usa antes de abrir devolução.';

GRANT SELECT ON public.v_venda_saldo_devolucao TO authenticated;

-- 5. RPC — cria devolução transacional
CREATE OR REPLACE FUNCTION public.criar_devolucao_venda(
    p_venda_id       uuid,
    p_itens          jsonb,        -- [{produto_id?, nome_produto, qtd, preco_unitario}]
    p_motivo         text,
    p_forma_estorno  text,         -- 'cancela_pendencias' | 'devolve_caixa'
    p_filial         text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_dev_id           uuid;
    v_valor_total      numeric(15,2) := 0;
    v_venda            public.vendas%ROWTYPE;
    v_short_id         text;
    v_today            date := CURRENT_DATE;
    v_item             jsonb;
    v_produto_id       uuid;
    v_nome             text;
    v_qtd              numeric(15,3);
    v_preco            numeric(15,2);
    v_subtotal         numeric(15,2);
    v_saldo_dispon     numeric(15,3);
    v_qtd_vendida      int;
    v_qtd_devolvida    int := 0;
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

    -- 1) Insere cabeçalho (tipo definido depois; começa Parcial)
    INSERT INTO public.devolucoes (
        venda_id, motivo, tipo, valor_devolvido, forma_estorno, status,
        autorizada_por, filial, criado_por
    ) VALUES (
        p_venda_id, p_motivo, 'Parcial', 0, p_forma_estorno, 'Concluída',
        auth.uid(), p_filial, auth.uid()
    ) RETURNING id INTO v_dev_id;

    -- 2) Itera itens, valida saldo, insere itens_devolucao + entrada de estoque
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
        v_produto_id := NULLIF(v_item->>'produto_id','')::uuid;
        v_nome       := v_item->>'nome_produto';
        v_qtd        := (v_item->>'qtd')::numeric;
        v_preco      := (v_item->>'preco_unitario')::numeric;
        v_subtotal   := ROUND(v_qtd * v_preco, 2);

        IF v_qtd <= 0 THEN
            RAISE EXCEPTION 'Quantidade inválida para %: %', v_nome, v_qtd;
        END IF;

        -- Saldo devolvível (a devolução em curso ainda não conta — foi
        -- inserida com status Concluída acima mas os itens ainda não
        -- estão em itens_devolucao, então v_saldo_dispon exclui só as
        -- devoluções anteriores).
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

        -- Estoque: devolve como Entrada (se produto_id conhecido)
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

    -- 3) Tipo Total ou Parcial: soma qtd devolvida (esta + anteriores) == qtd vendida?
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

    -- 4) Estorno financeiro
    v_restante := v_valor_total;

    IF p_forma_estorno = 'cancela_pendencias' THEN
        -- Zera contas_receber Aberto ligadas à venda (via descrição).
        -- Vencimentos mais distantes cancelam primeiro (proteje as próximas).
        FOR v_conta IN
            SELECT * FROM public.contas_receber
            WHERE ativo = true
              AND status = 'Aberto'
              AND descricao LIKE '%#' || v_short_id || '%'
            ORDER BY vencimento DESC NULLS LAST
        LOOP
            EXIT WHEN v_restante <= 0;
            IF v_conta.valor <= v_restante THEN
                UPDATE public.contas_receber
                SET status = 'Cancelado', updated_at = now()
                WHERE id = v_conta.id;
                v_restante := v_restante - v_conta.valor;
            ELSE
                UPDATE public.contas_receber
                SET valor = valor - v_restante, updated_at = now()
                WHERE id = v_conta.id;
                v_restante := 0;
            END IF;
        END LOOP;
        -- Se ainda sobrou (venda já estava paga), cria contas_pagar como saída.
        IF v_restante > 0 THEN
            INSERT INTO public.contas_pagar (
                descricao, valor, vencimento, status, filial, origem
            ) VALUES (
                v_desc_dev || ' (saída — venda já paga)',
                v_restante, v_today, 'Pago', p_filial, 'devolucao_pdv'
            );
        END IF;

    ELSIF p_forma_estorno = 'devolve_caixa' THEN
        -- Saída direta em contas_pagar, já paga (dinheiro entregue ao cliente).
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
$$;

COMMENT ON FUNCTION public.criar_devolucao_venda(uuid,jsonb,text,text,text) IS
    'Devolução parcial ou total de venda PDV. RBAC: gerente da filial ou admin/CEO. Transacional.';

GRANT EXECUTE ON FUNCTION public.criar_devolucao_venda(uuid,jsonb,text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
