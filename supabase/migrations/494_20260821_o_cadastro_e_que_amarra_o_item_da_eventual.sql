-- 494_20260821_o_cadastro_e_que_amarra_o_item_da_eventual.sql
--
-- Continuação direta da migr. 480, fechando o buraco que ela abriu na tela.
--
-- A 480 acertou a regra: pedido não sai sem código de item. Só que ela deixou o
-- Gerar Pedido da compra EVENTUAL se comportando igual ao da Reposição — um
-- `select` do catálogo. E a compra eventual é, por definição, o item que ainda
-- NÃO está no catálogo: o comprador abre a lista, não acha nada, e a tela manda
-- ele cadastrar em Cadastros > Produtos "e voltar aqui".
--
-- Lá também não havia por onde. O único vínculo que Cadastros > Produtos sabia
-- fazer era com o passivo pré-480 ("Já chegou e não está no catálogo", montado a
-- partir de pedidos JÁ RECEBIDOS). A requisição eventual esperando o pedido sair
-- não tem pedido nenhum — então não aparecia ali. Resultado: o comprador
-- redigitava o nome à mão, salvava um produto que não sabia de qual requisição
-- estava falando, voltava para a cotação e ainda tinha que achar o item no
-- `select`. Três chances de grafia nova, que é exatamente a duplicata que a 480
-- existe para evitar.
--
-- O que falta é o vínculo poder nascer no CADASTRO — que é o momento em que o
-- comprador está olhando para o item. Feito isso, a requisição já chega em
-- Cotações com `produto_id`, e o Gerar Pedido passa direto, sem modal: o mesmo
-- caminho da Reposição, que é o certo.
--
-- ── O que esta migração faz ─────────────────────────────────────────────────
-- Uma RPC só: `vincular_produto_requisicao`. É o mesmo UPDATE que a 480 já faz
-- lá dentro de `gerar_pedido_de_cotacao`, isolado para poder ser chamado antes
-- do pedido existir. Nada de gatilho, nada de coluna nova.
--
-- Por que RPC e não UPDATE direto da tela: `requisicoes` é escrita do setor
-- solicitante, e quem cadastra produto é Compras/Logística. Abrir a policy de
-- UPDATE para eles daria de lambuja o direito de mexer em item, quantidade e
-- status de requisição alheia — inclusive requisição já aprovada, que é decisão
-- do gerente. A RPC toca UMA coluna e só quando ela está nula.


BEGIN;

CREATE OR REPLACE FUNCTION public.vincular_produto_requisicao(
  p_requisicao_id uuid,
  p_produto_id    uuid
)
 RETURNS public.requisicoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req  public.requisicoes;
  v_prod public.produtos;
BEGIN
  -- Mesmo papel de `gerar_pedido_de_cotacao`: quem amarra o texto livre ao
  -- catálogo é quem compra. Admin/CEO passam por dentro de auth_in_setor.
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_req FROM public.requisicoes WHERE id = p_requisicao_id FOR UPDATE;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisição não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- COALESCE: `auth_pode_filial` é `auth_is_admin() OR auth_user_filial() = X`,
  -- e conta sem alocação (migr. 411) tem filial NULL — o OR devolve NULL, e
  -- `IF NOT NULL` não entra no bloco. Sem isto o guard passa batido justamente
  -- para quem não tem unidade nenhuma.
  IF NOT COALESCE(public.auth_pode_filial(v_req.filial), false) THEN
    RAISE EXCEPTION 'Requisição de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_req.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Requisição excluída não recebe vínculo.' USING ERRCODE = 'P0001';
  END IF;
  -- Atendida já virou pedido: o vínculo dela, se faltou, é problema do pedido,
  -- não desta porta. Negada não vai comprar nada.
  IF v_req.status IN ('Atendida', 'Negado') THEN
    RAISE EXCEPTION 'Requisição % está % — o vínculo com o catálogo só vale enquanto ela pode virar pedido.',
      COALESCE(v_req.numero, '#' || upper(right(v_req.id::text, 6))), lower(v_req.status)
      USING ERRCODE = 'P0001';
  END IF;

  -- Já amarrada: não sobrescreve. Trocar o produto de uma requisição que o
  -- gerente aprovou é trocar a decisão dele por outra, calado.
  IF v_req.produto_id IS NOT NULL THEN
    IF v_req.produto_id = p_produto_id THEN
      RETURN v_req;
    END IF;
    RAISE EXCEPTION 'Esta requisição já aponta para um produto do catálogo.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF v_prod.id IS NULL OR v_prod.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Produto não encontrado ou inativo.' USING ERRCODE = 'P0001';
  END IF;
  -- Mesma régua da 480: catálogo é por unidade. Amarrar no produto da vizinha
  -- faria a entrada do recebimento mexer no estoque dela.
  IF v_prod.filial IS DISTINCT FROM v_req.filial THEN
    RAISE EXCEPTION 'O produto "%" é do catálogo da %, e esta requisição é da %.',
      v_prod.nome, v_prod.filial, v_req.filial USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.requisicoes
     SET produto_id = p_produto_id
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$function$;

-- `anon` revogado nominalmente: REVOKE FROM PUBLIC não basta quando o papel tem
-- grant próprio (RPC nova nasce aberta para ele).
REVOKE ALL ON FUNCTION public.vincular_produto_requisicao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_produto_requisicao(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.vincular_produto_requisicao(uuid, uuid) IS
  'Amarra uma requisição de texto livre (compra Eventual) a um item do catálogo, antes do pedido existir. Mesmo UPDATE que gerar_pedido_de_cotacao faz (migr. 480), isolado para ser chamado no cadastro do produto. Só preenche quando produto_id está nulo.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'vincular_produto_requisicao';
--   -- espera: vincular_produto_requisicao(uuid,uuid)
--
-- TESTE MANUAL (Compras/Logística, requisição Eventual aprovada e cotada):
--   Cadastros > Produtos > Novo, escolher a requisição em "Origem deste
--   cadastro" e salvar   → a requisição fica com produto_id
--   Cotações > Gerar Pedido nessa cotação → sai DIRETO, sem o modal do catálogo
--   Repetir o vínculo na mesma requisição  → recusa ("já aponta para um produto")
--   Produto de outra unidade               → recusa com o nome das duas filiais
--   Requisição já Atendida                 → recusa
-- ════════════════════════════════════════════════════════════════════════════
