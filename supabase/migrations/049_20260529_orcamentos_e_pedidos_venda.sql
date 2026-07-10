-- ─────────────────────────────────────────────────────────────────────────────
-- LogMax — Orçamentos & Propostas + Pedidos de Venda
-- Data: 2026-05-29
--
-- Implementa o módulo de Orçamentos (Vendas) com fluxo:
--   Rascunho → Aguardando Financeiro → (Aprovado | Reprovado c/ feedback)
--     → Enviado ao Cliente → (Aprovado | Reprovado) Cliente
--     → Convertido em Pedido (gera linha em pedidos_venda + conta a receber)
--
-- "Cliente Especial" (admin/CEO) atua no orçamento como se fosse o cliente.
-- Sem coluna nova: o decidido_cliente_simulado=true sinaliza essa origem.
--
-- Itens ficam em JSONB inline (sem tabela orcamento_itens separada): cada
-- elemento é {produto_id, nome, qtd, preco_unitario, subtotal}. Mantém o
-- snapshot independente do catálogo evoluir e simplifica RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Orçamentos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamentos (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id                  uuid        REFERENCES public.clientes(id) ON DELETE SET NULL,
  vendedor_id                 uuid,
  vendedor_nome               text,
  validade_dias               int         NOT NULL DEFAULT 3 CHECK (validade_dias > 0),
  data_emissao                date        NOT NULL DEFAULT CURRENT_DATE,
  itens                       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  subtotal                    numeric(12,2) NOT NULL DEFAULT 0,
  desconto                    numeric(12,2) NOT NULL DEFAULT 0,
  valor_total                 numeric(12,2) NOT NULL DEFAULT 0,
  observacoes                 text,
  status                      text        NOT NULL DEFAULT 'Rascunho'
                                          CHECK (status IN (
                                            'Rascunho',
                                            'Aguardando Financeiro',
                                            'Aprovado Financeiro',
                                            'Reprovado Financeiro',
                                            'Enviado ao Cliente',
                                            'Aprovado Cliente',
                                            'Reprovado Cliente',
                                            'Convertido em Pedido',
                                            'Expirado',
                                            'Cancelado'
                                          )),
  feedback_financeiro         text,
  decidido_financeiro_em      timestamptz,
  decidido_financeiro_por     uuid,
  enviado_cliente_em          timestamptz,
  feedback_cliente            text,
  decidido_cliente_em         timestamptz,
  decidido_cliente_por        uuid,
  decidido_cliente_simulado   boolean     NOT NULL DEFAULT false,
  pedido_venda_id             uuid,
  ativo                       boolean     NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orcamentos_status_created    ON public.orcamentos(status, created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente           ON public.orcamentos(cliente_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_orcamentos_vendedor          ON public.orcamentos(vendedor_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_orcamentos_created_at        ON public.orcamentos(created_at DESC);

ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;

-- SELECT: vendas + financeiro veem; admin/CEO sempre via auth_in_setor.
DROP POLICY IF EXISTS "orc_select" ON public.orcamentos;
CREATE POLICY "orc_select" ON public.orcamentos
  FOR SELECT TO authenticated
  USING (auth_in_setor('vendas', 'financeiro'));

-- INSERT: vendas cria; admin/CEO também (cobertos por auth_is_admin via auth_in_setor)
DROP POLICY IF EXISTS "orc_insert" ON public.orcamentos;
CREATE POLICY "orc_insert" ON public.orcamentos
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('vendas'));

-- UPDATE: vendas pode editar (rascunho/seu fluxo) + financeiro (decisão) + admin/CEO
DROP POLICY IF EXISTS "orc_update" ON public.orcamentos;
CREATE POLICY "orc_update" ON public.orcamentos
  FOR UPDATE TO authenticated
  USING (auth_in_setor('vendas', 'financeiro'))
  WITH CHECK (auth_in_setor('vendas', 'financeiro'));

-- DELETE (soft via ativo=false na app): vendas + admin/CEO
DROP POLICY IF EXISTS "orc_delete" ON public.orcamentos;
CREATE POLICY "orc_delete" ON public.orcamentos
  FOR DELETE TO authenticated
  USING (auth_in_setor('vendas'));

-- 2) Pedidos de Venda ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedidos_venda (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id        uuid          REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  cliente_id          uuid          REFERENCES public.clientes(id) ON DELETE SET NULL,
  vendedor_id         uuid,
  vendedor_nome       text,
  itens               jsonb         NOT NULL DEFAULT '[]'::jsonb,
  valor_total         numeric(12,2) NOT NULL DEFAULT 0,
  status              text          NOT NULL DEFAULT 'Aguardando Separação'
                                    CHECK (status IN (
                                      'Aguardando Separação',
                                      'Separado',
                                      'Pago',
                                      'Concluído',
                                      'Cancelado'
                                    )),
  separado_em         timestamptz,
  separado_por        uuid,
  separado_por_nome   text,
  pago_em             timestamptz,
  pago_por            uuid,
  pago_por_nome       text,
  conta_receber_id    uuid          REFERENCES public.contas_receber(id) ON DELETE SET NULL,
  ativo               boolean       NOT NULL DEFAULT true,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_venda_status_created  ON public.pedidos_venda(status, created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_pedidos_venda_cliente         ON public.pedidos_venda(cliente_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_pedidos_venda_orcamento       ON public.pedidos_venda(orcamento_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_venda_created_at      ON public.pedidos_venda(created_at DESC);

ALTER TABLE public.pedidos_venda ENABLE ROW LEVEL SECURITY;

-- SELECT: vendas (vê o que gerou), logistica (separa), financeiro (cobra)
DROP POLICY IF EXISTS "pv_select" ON public.pedidos_venda;
CREATE POLICY "pv_select" ON public.pedidos_venda
  FOR SELECT TO authenticated
  USING (auth_in_setor('vendas', 'logistica', 'financeiro'));

-- INSERT: feito pela RPC abaixo via SECURITY DEFINER; mantém policy
-- permissiva pro service role / admin path.
DROP POLICY IF EXISTS "pv_insert" ON public.pedidos_venda;
CREATE POLICY "pv_insert" ON public.pedidos_venda
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- UPDATE: logistica marca separado, financeiro marca pago, admin/CEO sempre
DROP POLICY IF EXISTS "pv_update" ON public.pedidos_venda;
CREATE POLICY "pv_update" ON public.pedidos_venda
  FOR UPDATE TO authenticated
  USING (auth_in_setor('vendas', 'logistica', 'financeiro'))
  WITH CHECK (auth_in_setor('vendas', 'logistica', 'financeiro'));

-- DELETE: admin/CEO via auth_in_setor + setor 'vendas' (caso o vendedor cancele)
DROP POLICY IF EXISTS "pv_delete" ON public.pedidos_venda;
CREATE POLICY "pv_delete" ON public.pedidos_venda
  FOR DELETE TO authenticated
  USING (auth_in_setor('vendas'));

-- 3) RPC: converte orçamento aprovado pelo cliente em pedido_venda + conta a receber
-- Idempotente: se já há pedido_venda pra esse orcamento, retorna o existente.
-- Lança erro se orcamento não estiver em 'Aprovado Cliente'.
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_pedido(
  p_orcamento_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc            public.orcamentos;
  v_pedido_id      uuid;
  v_conta_id       uuid;
  v_cliente_nome   text;
  v_desc           text;
  v_vencimento     date;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_orc.pedido_venda_id IS NOT NULL THEN
    -- Idempotente: devolve o pedido existente.
    RETURN v_orc.pedido_venda_id;
  END IF;

  IF v_orc.status <> 'Aprovado Cliente' THEN
    RAISE EXCEPTION 'Só é possível converter orçamentos aprovados pelo cliente. Status atual: %.', v_orc.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Insere o pedido de venda copiando itens, total, vendedor e cliente.
  INSERT INTO public.pedidos_venda (
    orcamento_id, cliente_id, vendedor_id, vendedor_nome,
    itens, valor_total, status
  )
  VALUES (
    v_orc.id, v_orc.cliente_id, v_orc.vendedor_id, v_orc.vendedor_nome,
    v_orc.itens, v_orc.valor_total, 'Aguardando Separação'
  )
  RETURNING id INTO v_pedido_id;

  -- Gera conta a receber pro Financeiro acompanhar.
  -- Vencimento: data_emissao do pedido + 30d. Descrição traz o ID curto.
  SELECT nome INTO v_cliente_nome FROM public.clientes WHERE id = v_orc.cliente_id;
  v_desc       := 'Pedido Venda #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                  || COALESCE(' - ' || v_cliente_nome, '');
  v_vencimento := CURRENT_DATE + 30;

  INSERT INTO public.contas_receber (cliente_id, descricao, valor, vencimento, status)
  VALUES (v_orc.cliente_id, v_desc, v_orc.valor_total, v_vencimento, 'Aberto')
  RETURNING id INTO v_conta_id;

  -- Liga conta_receber ao pedido_venda.
  UPDATE public.pedidos_venda
     SET conta_receber_id = v_conta_id
   WHERE id = v_pedido_id;

  -- Marca orçamento como convertido.
  UPDATE public.orcamentos
     SET status = 'Convertido em Pedido',
         pedido_venda_id = v_pedido_id
   WHERE id = v_orc.id;

  -- Notifica logística pra separar e financeiro pra acompanhar pagamento.
  -- notificar_setor existe desde 20260520_ti_e_notificacoes.sql.
  PERFORM public.notificar_setor(
    p_setor      => 'logistica',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Novo pedido de venda para separar',
    p_mensagem   => 'Pedido #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                    || COALESCE(' - ' || v_cliente_nome, ''),
    p_link_view  => 'vendas-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id,
    p_motivo     => NULL
  );

  PERFORM public.notificar_setor(
    p_setor      => 'financeiro',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Pedido de venda aguardando pagamento',
    p_mensagem   => 'Pedido #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
                    || COALESCE(' - ' || v_cliente_nome, '')
                    || ' (Conta a Receber #' || UPPER(SUBSTRING(v_conta_id::text, 1, 6)) || ')',
    p_link_view  => 'vendas-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id,
    p_motivo     => NULL
  );

  RETURN v_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_pedido(uuid) TO authenticated;
