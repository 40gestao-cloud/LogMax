-- 423_20260814_chegou_errado_agora_tem_consequencia.sql
--
-- "CHEGOU AVARIADO" NÃO TINHA PARA ONDE IR.
--
-- O Recebimento sabe receber parcial desde a migr. 202, e a tela até avisa:
-- "Chegou outra coisa? Não confirme — registre a divergência com Compras."
-- Só que não existe lugar nenhum para registrar essa divergência. Na prática o
-- almoxarife tem duas saídas, ambas ruins:
--
--   • confirma assim mesmo — e o estoque passa a contar caixa quebrada como
--     mercadoria boa, e o fornecedor recebe por ela;
--   • não confirma — e o pedido fica com saldo em aberto para sempre, a conta
--     a pagar segue cheia, e ninguém cobra ninguém.
--
-- Nenhuma das duas ensina o que a empresa faz de verdade: devolve, abate da
-- nota e cobra reposição — ou encerra o pedido com o que veio.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A DECISÃO QUE O ALUNO PRECISA TOMAR
--
-- `reenvio_esperado` é o coração desta migração:
--
--   • **true** — o fornecedor vai repor. A quantidade devolvida volta a contar
--     como saldo em aberto do pedido, e o Recebimento espera a carga de novo.
--   • **false** — não vem mais. O saldo NÃO reabre e o pedido encerra com o
--     que chegou.
--
-- É essa escolha que fecha o buraco descrito no gap: sem ela, devolver deixaria
-- o pedido eternamente pendente — que é o mesmo problema, com outro nome.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE A DEVOLUÇÃO MOVE
--
--   1. Estoque: saída pela quantidade devolvida. A devolução só existe depois
--      da confirmação — antes dela o estoque nem subiu, e o caso "chegou errado
--      e eu nem dou entrada" já se resolve não confirmando.
--   2. Financeiro: a conta a pagar do pedido, se ainda pendente, cai pelo valor
--      devolvido (preço unitário do pedido × quantidade). Se já foi paga, a
--      função NÃO mexe: crédito com fornecedor pago é negociação, não
--      lançamento automático — e a RPC devolve isso escrito para a tela avisar.
--   3. Pedido: encerra quando não há mais nada a esperar.
--
-- A saída de estoque vai com `recebimento_id` NULL de propósito: existe índice
-- único por recebimento (uma entrada por recebimento, migr. da idempotência), e
-- reaproveitar o id aqui derrubaria o insert. O rastro fica no destino do
-- movimento, que cita o pedido.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O documento da devolução
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.devolucoes_fornecedor (
  id               uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  pedido_id        uuid NOT NULL REFERENCES public.pedidos(id)      ON DELETE CASCADE,
  recebimento_id   uuid NOT NULL REFERENCES public.recebimentos(id) ON DELETE CASCADE,
  produto_id       uuid          REFERENCES public.produtos(id)     ON DELETE SET NULL,
  -- Integer como o resto do ciclo de compras (`pedidos.item_qtd` e
  -- `recebimentos.qtd_recebida` são inteiros). Item fracionado não chega aqui.
  qtd              integer NOT NULL CHECK (qtd > 0),
  motivo           text    NOT NULL,
  observacao       text,
  reenvio_esperado boolean NOT NULL DEFAULT true,
  valor_estimado   numeric(15,2) NOT NULL DEFAULT 0,
  filial           text    NOT NULL DEFAULT 'SuperMax',
  criado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  ativo            boolean NOT NULL DEFAULT true,
  CONSTRAINT devolucoes_fornecedor_motivo_valido CHECK (
    motivo IN ('Avaria', 'Item errado', 'Quantidade a maior', 'Fora da validade', 'Outro')
  )
);

CREATE INDEX IF NOT EXISTS idx_devolucoes_fornecedor_pedido      ON public.devolucoes_fornecedor (pedido_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_fornecedor_recebimento ON public.devolucoes_fornecedor (recebimento_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_fornecedor_created_at  ON public.devolucoes_fornecedor (created_at DESC);

COMMENT ON TABLE public.devolucoes_fornecedor IS
  'Devolução de mercadoria ao fornecedor a partir de um recebimento confirmado. Escrita só pela RPC registrar_devolucao_fornecedor.';
COMMENT ON COLUMN public.devolucoes_fornecedor.reenvio_esperado IS
  'true = fornecedor vai repor, o saldo do pedido reabre. false = não vem mais, o pedido encerra com o que chegou.';

ALTER TABLE public.devolucoes_fornecedor ENABLE ROW LEVEL SECURITY;

-- Leitura pela régua de filial; escrita só pela RPC, que confere setor, saldo
-- e quantidade. Devolução lançada à mão é estoque que sai sem conferência.
DROP POLICY IF EXISTS devfor_select ON public.devolucoes_fornecedor;
CREATE POLICY devfor_select ON public.devolucoes_fornecedor
  FOR SELECT TO authenticated
  USING (public.auth_pode_filial(filial));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O saldo do pedido passa a enxergar a devolução
--
-- Colunas novas entram no FIM (CREATE OR REPLACE VIEW não reordena), e
-- `qtd_saldo` muda de expressão mantendo nome e tipo. Só a devolução COM
-- reenvio esperado reabre saldo — é o que separa "vai chegar de novo" de
-- "não vem mais".
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_pedido_saldo
WITH (security_invoker = true) AS
  SELECT p.id AS pedido_id,
         p.filial,
         COALESCE(p.item_qtd, 0) AS qtd_pedida,
         COALESCE(sum(r.qtd_recebida) FILTER (WHERE r.ativo = true), 0::bigint)::integer AS qtd_recebida_total,
         GREATEST(
           COALESCE(p.item_qtd, 0)
           - COALESCE(sum(r.qtd_recebida) FILTER (WHERE r.ativo = true), 0::bigint)::integer
           + COALESCE((
               SELECT sum(d.qtd)::integer
                 FROM public.devolucoes_fornecedor d
                WHERE d.pedido_id = p.id AND d.ativo AND d.reenvio_esperado
             ), 0),
           0) AS qtd_saldo,
         COALESCE((
           SELECT sum(d.qtd)::integer
             FROM public.devolucoes_fornecedor d
            WHERE d.pedido_id = p.id AND d.ativo
         ), 0) AS qtd_devolvida,
         COALESCE((
           SELECT sum(d.qtd)::integer
             FROM public.devolucoes_fornecedor d
            WHERE d.pedido_id = p.id AND d.ativo AND d.reenvio_esperado
         ), 0) AS qtd_devolvida_reenvio
    FROM pedidos p
    LEFT JOIN recebimentos r ON r.pedido_id = p.id
   WHERE p.ativo = true
   GROUP BY p.id, p.filial, p.item_qtd;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. A devolução
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_devolucao_fornecedor(
  p_recebimento_id   uuid,
  p_qtd              integer,
  p_motivo           text,
  p_reenvio_esperado boolean DEFAULT true,
  p_observacao       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receb        recebimentos;
  v_pedido       pedidos;
  v_produto_id   uuid;
  v_ja_devolvido integer;
  v_disponivel   integer;
  v_unitario     numeric(15,4);
  v_valor        numeric(15,2);
  v_conta        contas_pagar;
  v_conta_novo   numeric(15,2);
  v_conta_efeito text := 'nenhum';
  v_saldo        integer;
  v_pedido_fecha boolean := false;
  v_devolucao_id uuid;
BEGIN
  -- Sem lista de setores aqui: a régua real depende da filial do recebimento e
  -- é conferida abaixo — Logística OU o gerente daquela unidade, como no resto
  -- do módulo. (`_assert_rpc` sem argumento ainda barra anônimo, desligado e
  -- apagão didático.)
  PERFORM public._assert_rpc();

  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade devolvida precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_motivo, '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da devolução.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_receb FROM public.recebimentos
   WHERE id = p_recebimento_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_receb.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Só depois de confirmado: é a confirmação que sobe o estoque, e devolver o
  -- que nunca entrou tiraria saldo que não existe.
  IF v_receb.status NOT IN ('Concluído', 'Parcial') THEN
    RAISE EXCEPTION 'Este recebimento ainda não foi confirmado. Se a carga chegou errada, não confirme — a divergência aqui é para o que já entrou no estoque.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_receb.filial), false) THEN
    RAISE EXCEPTION 'Recebimento de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('logistica'), false)
          OR COALESCE(public.auth_gerente_da(v_receb.filial), false)) THEN
    RAISE EXCEPTION 'Apenas a Logística ou o gerente da filial registram devolução ao fornecedor.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos WHERE id = v_receb.pedido_id FOR UPDATE;
  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'Pedido do recebimento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Teto: o que aquele recebimento trouxe, menos o que já foi devolvido dele.
  SELECT COALESCE(sum(qtd), 0) INTO v_ja_devolvido
    FROM public.devolucoes_fornecedor
   WHERE recebimento_id = p_recebimento_id AND ativo;

  v_disponivel := COALESCE(v_receb.qtd_recebida, 0) - v_ja_devolvido;
  IF p_qtd > v_disponivel THEN
    RAISE EXCEPTION 'Este recebimento tem % unidade(s) disponível(is) para devolução (recebeu %, já devolveu %).',
      v_disponivel, COALESCE(v_receb.qtd_recebida, 0), v_ja_devolvido USING ERRCODE = 'P0001';
  END IF;

  -- Produto: o que de fato entrou por este recebimento. Mais confiável que o
  -- produto do pedido, que é NULL em compra eventual.
  SELECT produto_id INTO v_produto_id
    FROM public.movimentacoes_estoque
   WHERE recebimento_id = p_recebimento_id AND tipo = 'Entrada'
   ORDER BY created_at LIMIT 1;

  -- Valor devolvido pelo preço unitário do pedido.
  IF COALESCE(v_pedido.item_qtd, 0) > 0 AND COALESCE(v_pedido.valor_total, 0) > 0 THEN
    v_unitario := ROUND(v_pedido.valor_total / v_pedido.item_qtd, 4);
    v_valor    := ROUND(v_unitario * p_qtd, 2);
  ELSE
    v_valor := 0;
  END IF;

  INSERT INTO public.devolucoes_fornecedor
    (pedido_id, recebimento_id, produto_id, qtd, motivo, observacao,
     reenvio_esperado, valor_estimado, filial, criado_por)
  VALUES
    (v_pedido.id, p_recebimento_id, v_produto_id, p_qtd, p_motivo, p_observacao,
     COALESCE(p_reenvio_esperado, true), v_valor, v_receb.filial, auth.uid())
  RETURNING id INTO v_devolucao_id;

  -- ── Estoque ──
  IF v_produto_id IS NOT NULL THEN
    INSERT INTO public.movimentacoes_estoque
      (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES
      (v_produto_id, 'Saída', p_qtd, 'Almoxarifado',
       'Devolução ao fornecedor — ' || COALESCE(v_pedido.numero, 'Pedido #' || upper(right(v_pedido.id::text, 6))),
       public.acre_today(), v_receb.filial);
  END IF;

  -- ── Financeiro ──
  IF v_valor > 0 THEN
    SELECT * INTO v_conta
      FROM public.contas_pagar
     WHERE pedido_id = v_pedido.id AND COALESCE(ativo, true) AND status = 'Pendente'
     ORDER BY created_at LIMIT 1
     FOR UPDATE;

    IF v_conta.id IS NOT NULL THEN
      v_conta_novo := ROUND(GREATEST(v_conta.valor - v_valor, 0), 2);
      IF v_conta_novo <= 0.005 THEN
        -- Devolveu tudo: a conta deixa de existir, com o motivo no texto.
        UPDATE public.contas_pagar
           SET ativo = false,
               descricao = descricao || ' — cancelada por devolução ao fornecedor',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := 'cancelada';
      ELSE
        UPDATE public.contas_pagar
           SET valor = v_conta_novo,
               descricao = descricao || ' — abatido R$ ' || to_char(v_valor, 'FM999G999G990D00') || ' (devolução)',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := 'abatida';
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM public.contas_pagar
       WHERE pedido_id = v_pedido.id AND COALESCE(ativo, true) AND status <> 'Pendente'
    ) THEN
      -- Conta já paga: crédito com fornecedor é negociação, não lançamento
      -- automático. A tela avisa, e alguém resolve com o fornecedor.
      v_conta_efeito := 'ja_paga';
    END IF;
  END IF;

  -- ── Pedido ──
  -- Sem reenvio, o que foi devolvido não volta: se não sobrou saldo, o pedido
  -- encerra em vez de ficar pendente para sempre — que era o gap.
  SELECT qtd_saldo INTO v_saldo FROM public.v_pedido_saldo WHERE pedido_id = v_pedido.id;

  IF COALESCE(v_saldo, 0) <= 0 AND v_pedido.status NOT IN ('Recebido', 'Cancelado') THEN
    UPDATE public.pedidos SET status = 'Recebido' WHERE id = v_pedido.id;
    v_pedido_fecha := true;
  ELSIF COALESCE(p_reenvio_esperado, true) AND v_pedido.status = 'Recebido' THEN
    -- Reabriu: a carga volta a ser esperada e o Estoque precisa ver o pedido.
    UPDATE public.pedidos SET status = 'Em Entrega' WHERE id = v_pedido.id;
  END IF;

  RETURN jsonb_build_object(
    'devolucao_id',   v_devolucao_id,
    'qtd',            p_qtd,
    'valor',          v_valor,
    'conta_efeito',   v_conta_efeito,
    'saldo_pedido',   COALESCE(v_saldo, 0),
    'pedido_fechado', v_pedido_fecha,
    'estoque_baixado', v_produto_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_devolucao_fornecedor(uuid, integer, text, boolean, text) FROM public;
REVOKE ALL ON FUNCTION public.registrar_devolucao_fornecedor(uuid, integer, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_devolucao_fornecedor(uuid, integer, text, boolean, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
