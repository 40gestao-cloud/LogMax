-- 480_20260819_quem_compra_e_quem_amarra_o_item_ao_catalogo.sql
--
-- Exceção à trava, aberta pelo professor depois de três rodadas de conversa
-- sobre o fluxo de recebimento. A pergunta dele foi a certa:
--
--   "está certo registrar recebimento → cadastrar produto → confirmar
--    recebimento? Se estou cadastrando o produto, obviamente é porque ele
--    chegou e estou com ele."
--
-- Não está. Em ERP real não se emite pedido de compra de item sem código: o
-- cadastro do material vem ANTES (MM01 no SAP, SB1 no Protheus), junto com a
-- decisão de comprar. Quando a carga chega, o item tem código há semanas — e aí
-- a doca só faz o que é dela, conferir e dar entrada.
--
-- Os DOIS PASSOS do recebimento continuam certos e não são tocados aqui:
-- Registrar diz "chegou", Confirmar diz "conferi, dou entrada e libero o
-- pagamento" (é o goods receipt). O que estava fora de lugar era o cadastro
-- entre um e outro.
--
-- ════════════════════════════════════════════════════════════════════════════
-- O ELO QUE FALTAVA JÁ EXISTIA — SÓ NUNCA ERA PREENCHIDO
--
-- A migr. 396 fez o pedido carregar `produto_id`, copiado da requisição. E
-- funciona: requisição de REPOSIÇÃO escolhe do catálogo, o pedido herda, e o
-- painel de Confirmar abre com o produto travado, sem escolha nenhuma.
--
-- Só que a compra EVENTUAL nasce de texto livre — quem pede não conhece o
-- catálogo, e isso é realista. O que não é realista é ninguém normalizar esse
-- texto depois. Resultado, na turma de Contabilidade: 66 requisições, 66
-- Eventuais, ZERO com `produto_id`. Todo pedido caía na exceção, e o cadastro
-- sobrava para o conferente na doca.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONDE ENTRA A TRAVA
--
-- `gerar_pedido_de_cotacao` é o ponto exato: é Compras emitindo o pedido, com a
-- cotação já aprovada pelo Financeiro. É o papel real do comprador — o setor
-- solicitante escreve o que precisa em português, e quem compra amarra aquilo a
-- um item de catálogo, porque é o código que entra no pedido.
--
-- A função ganha `p_produto_id`, usado só quando a requisição não trouxe o seu:
--
--   v_produto := COALESCE(v_req.produto_id, p_produto_id)
--
-- Nulo nos dois → o pedido não sai, com a mensagem dizendo o que fazer. Vindo
-- do comprador, o vínculo é gravado TAMBÉM na requisição: da próxima vez que a
-- unidade pedir "Detergente Ypê", ela já acha o item no catálogo e a compra
-- nasce como Reposição — o texto livre se esgota sozinho, ciclo a ciclo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ISTO NÃO FAZ
--
-- Não mexe em requisição, cotação, recebimento nem no Confirmar. Não fecha o
-- select de produto do Confirmar: pedido antigo (os 57 da turma) continua sem
-- `produto_id`, e fechar agora deixaria a turma sem saída no meio do ciclo. Ele
-- se esvazia sozinho — pedido novo já nasce amarrado.
--
-- ATENÇÃO ao aplicar: é DROP + CREATE, não CREATE OR REPLACE. Assinatura nova
-- (dois argumentos) conviveria com a antiga como sobrecarga, e aí a chamada de
-- um argumento fica ambígua. O DROP leva os GRANTs junto — eles voltam no fim.


BEGIN;

DROP FUNCTION IF EXISTS public.gerar_pedido_de_cotacao(uuid);

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

-- O DROP levou os GRANTs. `anon` é revogado nominalmente porque REVOKE FROM
-- PUBLIC não basta quando o papel tem grant próprio.
REVOKE ALL ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'gerar_pedido_de_cotacao';
--   -- espera UMA linha: gerar_pedido_de_cotacao(uuid,uuid)
--
-- TESTE MANUAL (Compras, cotação aprovada pelo Financeiro):
--   requisição de Reposição       → Gerar Pedido direto, sem perguntar nada
--   requisição Eventual           → pede o item do catálogo antes de gerar
--   produto de outra unidade      → recusa com o nome das duas filiais
--   depois de gerar               → a requisição fica com `produto_id`, e a
--                                   próxima compra do mesmo item é Reposição
--   Recebimento do pedido novo    → campo "Produto recebido" travado
-- ════════════════════════════════════════════════════════════════════════════
