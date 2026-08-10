-- =================================================================
-- 396 — O pedido carrega o produto, e o recebimento não escolhe outro.
--
-- A requisição de Reposição nasce do catálogo e guarda `produto_id`
-- (358). A cotação aponta pra requisição, o pedido aponta pra cotação —
-- mas `pedidos` só guardava `item_descricao` e `item_qtd`, TEXTO. O elo
-- com o produto morria ali.
--
-- Consequência no almoxarifado: ao confirmar o recebimento, o select de
-- produto listava o CATÁLOGO INTEIRO da filial, sem relação nenhuma com
-- o que foi comprado. Dava pra receber o pedido de arroz e dar entrada
-- em notebook — a quantidade era criticada contra o saldo do pedido
-- (v_pedido_saldo, migr. 202), o produto não era criticado contra nada.
-- O estoque subia no item errado e nada acusava: a movimentação fica
-- "correta" (tem recebimento_id, tem qtd), só aponta pro produto errado.
--
-- Três peças:
--   1. `pedidos.produto_id`, herdado da requisição no momento em que o
--      pedido nasce.
--   2. A trava no banco. Só travar a tela não resolve: a movimentação é
--      um INSERT direto de `/api/movimentacoesestoqueview`, então o F12
--      passa por cima do select. A trigger é quem tem dente.
--   3. Compra EVENTUAL continua livre — e isso é regra, não brecha. Ela
--      não vem do catálogo (358), então `produto_id` é NULL e não há o
--      que casar: o almoxarife escolhe o produto, ou cria na hora pelo
--      modal de produto rápido. A trava só morde quando existe produto
--      declarado no pedido.
--
-- Não recalcula nem corrige movimentação antiga: entrada já feita é
-- história do estoque, e reapontá-la mudaria saldo sem lastro.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. O elo que faltava ──────────────────────────────────────────
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public.produtos(id);

COMMENT ON COLUMN public.pedidos.produto_id IS
  'Produto do catalogo herdado da requisicao de Reposicao. NULL em compra Eventual, que nao nasce do catalogo.';

CREATE INDEX IF NOT EXISTS idx_pedidos_produto_id
  ON public.pedidos (produto_id) WHERE produto_id IS NOT NULL;

-- Pedido que já existe e veio de requisição com produto declarado passa
-- a apontar pra ele. Só preenche o que está vazio.
UPDATE public.pedidos p
   SET produto_id = r.produto_id
  FROM public.requisicoes r
 WHERE r.id = p.requisicao_id
   AND p.produto_id IS NULL
   AND r.produto_id IS NOT NULL;

-- ── 2. O pedido nasce com o produto ───────────────────────────────
-- Corpo copiado do estado vigente no banco (336). A única mudança é
-- `produto_id` no INSERT — o resto vai igual porque REPLACE de função é
-- substituição integral, e reescrever de memória é como se perde regra.
CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(p_cotacao_id uuid)
RETURNS pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cot        public.cotacoes;
  v_req        public.requisicoes;
  v_pedido     public.pedidos;
  v_prazo      date;
  v_vencimento date;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_cotacao_id FOR UPDATE;

  IF v_cot.id IS NULL THEN
    RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(v_cot.filial) THEN
    RAISE EXCEPTION 'Cotação de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_cot.ativo IS NOT TRUE OR v_cot.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só cotação aprovada e ativa gera pedido (status atual: %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pedidos WHERE cotacao_id = v_cot.id AND ativo) THEN
    RAISE EXCEPTION 'Esta cotação já tem pedido gerado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cot.requisicao_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.pedidos WHERE requisicao_id = v_cot.requisicao_id AND ativo
     ) THEN
    RAISE EXCEPTION 'Esta requisição já foi atendida por outro pedido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = v_cot.requisicao_id;

  v_prazo := CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
                  THEN v_cot.prazo_entrega::date END;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd, produto_id
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd, v_req.produto_id
  )
  RETURNING * INTO v_pedido;

  IF v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.requisicoes SET status = 'Atendida'
     WHERE id = v_cot.requisicao_id AND status = 'Aprovado';
  END IF;

  -- +30 dias quando a cotação não trouxe prazo — a conta precisa de vencimento.
  v_vencimento := COALESCE(v_prazo, public.acre_today() + 30);

  INSERT INTO public.contas_pagar (
    fornecedor_id, descricao, valor, vencimento, status, pedido_id, filial
  ) VALUES (
    v_cot.fornecedor_id,
    COALESCE(v_pedido.numero, 'Pedido #' || upper(right(v_pedido.id::text, 6)))
      || ' — ' || COALESCE(v_req.item, 'Compra')
      || COALESCE(' (' || v_req.numero || ')', ''),
    v_cot.valor_total, v_vencimento, 'Pendente', v_pedido.id, v_cot.filial
  );

  RETURN v_pedido;
END;
$function$;

-- ── 3. A trava, onde ela morde ────────────────────────────────────
-- A entrada de recebimento é INSERT direto na tabela (o front chama
-- `/api/movimentacoesestoqueview`), então travar o <select> da tela não
-- basta: quem abrir o F12 monta o INSERT com qualquer produto_id. Aqui
-- não passa.
--
-- `SET search_path` é obrigatório em trigger function: sem ele o INSERT
-- quebra em contexto com search_path diferente.
CREATE OR REPLACE FUNCTION public._mov_estoque_casa_com_pedido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_produto_pedido uuid;
  v_numero         text;
  v_esperado       text;
BEGIN
  -- Movimentação que não vem de recebimento (venda, ajuste de inventário,
  -- requisição de material) não tem pedido pra comparar.
  IF NEW.recebimento_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.produto_id, COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6)))
    INTO v_produto_pedido, v_numero
    FROM public.recebimentos r
    JOIN public.pedidos p ON p.id = r.pedido_id
   WHERE r.id = NEW.recebimento_id;

  -- Compra eventual (produto_id NULL) segue livre: não nasceu do catálogo,
  -- não há produto declarado pra cobrar.
  IF v_produto_pedido IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.produto_id IS DISTINCT FROM v_produto_pedido THEN
    SELECT nome INTO v_esperado FROM public.produtos WHERE id = v_produto_pedido;
    RAISE EXCEPTION
      'Entrada não confere com o pedido: % foi comprado para "%". Dê entrada nesse produto ou registre a divergência.',
      v_numero, COALESCE(v_esperado, 'produto do pedido')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mov_estoque_casa_com_pedido ON public.movimentacoes_estoque;
CREATE TRIGGER trg_mov_estoque_casa_com_pedido
  BEFORE INSERT ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public._mov_estoque_casa_com_pedido();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- pedido de Reposição nasce com produto:
--   SELECT numero, item_descricao, produto_id FROM pedidos ORDER BY created_at DESC LIMIT 5;
--
--   -- a trava morde (deve levantar P0001):
--   INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, recebimento_id, filial)
--   VALUES ('<produto QUALQUER>', 'Entrada', 1, '<recebimento de pedido com produto_id>', 'SuperMax');
