-- 495_20260821_o_guard_de_filial_nao_barrava_quem_nao_tem_filial.sql
--
-- Achado durante a revisão da migr. 494, no mesmo bloco de guard.
--
-- `auth_pode_filial(x)` é `auth_is_admin() OR auth_user_filial() = x`. Conta sem
-- alocação (migr. 411) tem `filial` NULL: o lado direito vira NULL, `false OR
-- NULL` é NULL — e `IF NOT NULL THEN ... END IF` NÃO entra no bloco. O guard não
-- barra ninguém; ele desaparece, calado, exatamente para quem não tem unidade
-- nenhuma. É a armadilha que a régua do projeto já nomeia: COALESCE(expr,false)
-- em todo guard.
--
-- O que passa por essa porta: emitir pedido de compra de qualquer filial, com a
-- conta a pagar junto. Não é privilégio pequeno.
--
-- Fora isso a função não muda — mesmo corpo da 480, mesma assinatura, mesmos
-- dois argumentos. É CREATE OR REPLACE (não DROP + CREATE): a assinatura é a
-- mesma, então os GRANTs ficam de pé sozinhos.
--
-- ── Nota de convergência ────────────────────────────────────────────────────
-- Conferido antes de escrever: as 4 turmas tinham a MESMA lógica, mas três
-- delas guardavam o corpo sem os comentários (3706 bytes contra 4565 da
-- Contabilidade) — sinal de que a 480 entrou lá por um caminho que os removeu.
-- Este REPLACE reconverge o texto junto com a correção; depois de aplicar, o
-- md5(prosrc) tem de bater nas 4.


BEGIN;

CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(
  p_cotacao_id uuid,
  -- Só é lido quando a requisição não trouxe produto. Default nulo mantém a
  -- chamada de um argumento válida para a Reposição, que não precisa dele.
  p_produto_id uuid DEFAULT NULL
)
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
  v_prazo_forn integer;
  v_vencimento date;
  v_produto_id uuid;
  v_prod       public.produtos;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_cotacao_id FOR UPDATE;

  IF v_cot.id IS NULL THEN
    RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- COALESCE porque `auth_pode_filial` devolve NULL para conta sem filial
  -- (migr. 411), e `IF NOT NULL` não entra no bloco — o guard sumiria justamente
  -- para quem não tem unidade.
  IF NOT COALESCE(public.auth_pode_filial(v_cot.filial), false) THEN
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

  -- ── O vínculo com o catálogo ──────────────────────────────────────────────
  -- Reposição já vem resolvida da requisição. Eventual depende do comprador.
  v_produto_id := COALESCE(v_req.produto_id, p_produto_id);

  IF v_produto_id IS NULL THEN
    RAISE EXCEPTION
      'O pedido precisa apontar para um produto do catálogo. Escolha qual item de catálogo é "%" — ou cadastre-o em Cadastros > Produtos e gere o pedido de novo.',
      COALESCE(v_req.item, 'este item')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = v_produto_id;
  IF v_prod.id IS NULL OR v_prod.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Produto não encontrado ou inativo.' USING ERRCODE = 'P0001';
  END IF;
  -- Catálogo é por unidade: comprar contra o produto da vizinha faria a entrada
  -- do recebimento mexer no estoque dela.
  IF v_prod.filial IS DISTINCT FROM v_cot.filial THEN
    RAISE EXCEPTION 'O produto "%" é do catálogo da %, e este pedido é da %.',
      v_prod.nome, v_prod.filial, v_cot.filial USING ERRCODE = 'P0001';
  END IF;

  -- O comprador normalizou um texto livre: a requisição passa a saber de qual
  -- item ela estava falando. É o que faz a próxima compra do mesmo item nascer
  -- como Reposição, sem ninguém redigitar nome nenhum.
  IF v_req.id IS NOT NULL AND v_req.produto_id IS NULL THEN
    UPDATE public.requisicoes SET produto_id = v_produto_id WHERE id = v_req.id;
  END IF;

  v_prazo := CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
                  THEN v_cot.prazo_entrega::date END;

  -- Cotação sem data prometida: usa o prazo médio do fornecedor. É o campo que
  -- Cadastros pede e que até aqui não servia para nada. Fornecedor sem prazo
  -- cadastrado continua gerando pedido sem data — e é o pedido que ninguém
  -- consegue cobrar, o que é a própria lição.
  IF v_prazo IS NULL AND v_cot.fornecedor_id IS NOT NULL THEN
    SELECT prazo_entrega_dias INTO v_prazo_forn
      FROM public.fornecedores WHERE id = v_cot.fornecedor_id;
    IF COALESCE(v_prazo_forn, 0) > 0 THEN
      v_prazo := public.acre_today() + v_prazo_forn;
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd, produto_id
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd, v_produto_id
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

-- CREATE OR REPLACE mantém os GRANTs (não houve DROP). Repetidos assim mesmo:
-- é barato, e uma turma que tenha perdido o grant por outro caminho volta ao
-- lugar aqui.
REVOKE ALL ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT md5(prosrc) FROM pg_proc WHERE proname = 'gerar_pedido_de_cotacao';
--   -- mesmo md5 nas 4
--
--   SELECT prosrc LIKE '%COALESCE(public.auth_pode_filial%'
--     FROM pg_proc WHERE proname = 'gerar_pedido_de_cotacao';
--   -- true
--
-- TESTE MANUAL: gerar pedido continua funcionando para Compras/Logística da
-- própria filial, e continua recusando cotação de outra unidade.
-- ════════════════════════════════════════════════════════════════════════════
