-- MIGR 676 — o vínculo de produto pelo nome confere também a MARCA.
--
-- Turma ERP, 05/10: duas requisições eventuais com o MESMO texto de item,
-- "Óleo de soja 900ml", uma pedindo Liza (COT-SM-2026-0220) e outra Soya
-- (COT-SM-2026-0217), as duas aprovadas. O catálogo tinha um só produto com
-- esse nome — 028, marca Liza — e a régua da 627 (nome idêntico) ligava as
-- DUAS a ele. O pedido da Soya entraria no saldo da Liza, com o custo médio
-- misturando as duas propostas.
--
-- Regra do catálogo (decidida em 05/10): a marca vai NO NOME do produto. O
-- índice `uq_produtos_nome_filial_ativo` não deixa dois produtos ativos com o
-- mesmo nome na unidade, então o Soya só cabe ao lado do Liza como "Óleo de
-- soja 900ml Soya". Daí a régua nova, `vinculo_item_confere`:
--   • nome: o do produto é o item da requisição, ou o item + a marca pedida;
--   • marca: sem marca pedida, qualquer uma serve; com marca, o produto é
--     dela — pela coluna `marca`, ou pelo nome quando a coluna está vazia.
-- A marca pedida é a da proposta aprovada (migr. 526), senão a da requisição
-- (migr. 582). Espelho em src/lib/vinculoCatalogo.ts (`produtoConfere`).
--
-- Só troca o bloco "MIGR 627" do produto em gerar_pedido_de_cotacao; o resto
-- é cópia do banco (md5 9dcf90f92680e43a37b5d6b1ac466a0e nos 4 em 05/10).
-- Serviço segue na 628 (serviço não tem marca).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

CREATE OR REPLACE FUNCTION public.vinculo_item_confere(
  p_item text, p_marca text, p_produto_nome text, p_produto_marca text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  WITH n AS (
    SELECT public.nome_item_normalizado(p_item)          AS i,
           public.nome_item_normalizado(p_marca)         AS m,
           public.nome_item_normalizado(p_produto_nome)  AS pn,
           public.nome_item_normalizado(p_produto_marca) AS pm
  ), c AS (
    -- O item com a marca no fim, a não ser que o texto já traga a marca.
    SELECT n.*,
           CASE WHEN n.m = '' OR (' ' || n.i || ' ') LIKE ('% ' || n.m || ' %')
                THEN n.i ELSE btrim(n.i || ' ' || n.m) END AS im
      FROM n
  )
  SELECT c.i <> '' AND c.pn <> ''
         AND (c.pn = c.i OR c.pn = c.im)
         AND (c.m = '' OR c.pm = c.m OR (c.pm = '' AND c.pn = c.im))
    FROM c
$function$;

REVOKE ALL ON FUNCTION public.vinculo_item_confere(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vinculo_item_confere(text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(p_cotacao_id uuid, p_produto_id uuid DEFAULT NULL::uuid, p_servico_id uuid DEFAULT NULL::uuid)
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
  v_servico_id uuid;
  v_prod       public.produtos;
  v_serv       public.servicos;
  v_cc_id      uuid;
  v_dias       integer[];
  v_n          integer;
  v_i          integer;
  v_parcela    numeric(15,2);
  v_acumulado  numeric(15,2) := 0;
  v_descricao  text;
  v_do_modal   boolean;
  v_outra      public.requisicoes;
  v_marca      text;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_cotacao_id FOR UPDATE;

  IF v_cot.id IS NULL THEN
    RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_cot.filial), false) THEN
    RAISE EXCEPTION 'Cotação de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_cot.ativo IS NOT TRUE OR v_cot.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só cotação aprovada e ativa gera pedido (status atual: %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 544: `status <> 'Cancelado'`, e não só `ativo`. Pedido cancelado é
  -- rastro, não ocupação de vaga — cancelar existe justamente para poder
  -- recomeçar a compra.
  IF EXISTS (SELECT 1 FROM public.pedidos
              WHERE cotacao_id = v_cot.id AND ativo AND status <> 'Cancelado') THEN
    RAISE EXCEPTION 'Esta cotação já tem pedido gerado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cot.requisicao_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.pedidos
        WHERE requisicao_id = v_cot.requisicao_id AND ativo AND status <> 'Cancelado'
     ) THEN
    RAISE EXCEPTION 'Esta requisição já foi atendida por outro pedido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = v_cot.requisicao_id;

  -- MIGR 596: o vínculo está sendo feito AGORA, no modal de Gerar Pedido, e é
  -- só ele que as duas recusas abaixo examinam. Requisição de reposição já
  -- trouxe o código do catálogo e não passa por aqui.
  v_do_modal   := v_req.id IS NOT NULL
                  AND v_req.produto_id IS NULL AND v_req.servico_id IS NULL;

  v_produto_id := COALESCE(v_req.produto_id, p_produto_id);
  v_servico_id := COALESCE(v_req.servico_id, p_servico_id);

  IF v_produto_id IS NOT NULL AND v_servico_id IS NOT NULL THEN
    RAISE EXCEPTION 'O pedido é de um produto OU de um serviço, não dos dois.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_produto_id IS NULL AND v_servico_id IS NULL THEN
    IF upper(COALESCE(v_req.unidade, '')) = 'SV' THEN
      RAISE EXCEPTION
        'O pedido precisa apontar para um serviço do catálogo. Diga qual serviço é "%" — ou cadastre-o em Cadastros > Serviços e gere o pedido de novo.',
        COALESCE(v_req.item, 'este item')
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION
      'O pedido precisa apontar para um item do catálogo. Escolha qual produto é "%" — ou, se for contratação de serviço, escolha o serviço. Não achou? Cadastre em Cadastros > Produtos (ou > Serviços) e gere o pedido de novo.',
      COALESCE(v_req.item, 'este item')
      USING ERRCODE = 'P0001';
  END IF;

  IF v_produto_id IS NOT NULL THEN
    SELECT * INTO v_prod FROM public.produtos WHERE id = v_produto_id;
    IF v_prod.id IS NULL OR v_prod.ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'Produto não encontrado ou inativo.' USING ERRCODE = 'P0001';
    END IF;
    IF v_prod.filial IS DISTINCT FROM v_cot.filial THEN
      RAISE EXCEPTION 'O produto "%" é do catálogo da %, e este pedido é da %.',
        v_prod.nome, v_prod.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
    -- MIGR 515: bem de uso não tem saldo (migr. 046/440), e o Confirmar do
    -- recebimento daria entrada de mercadoria num freezer.
    IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
      RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e bem não entra pelo pedido de compra: ele não tem saldo de estoque, então o Confirmar do recebimento daria entrada de mercadoria num item que nunca vai ter saldo. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado — o bem aparece em Financeiro > Patrimônio, com vida útil e depreciação. Se o que está sendo comprado é mercadoria ou material de consumo, corrija o Tipo do produto em Cadastros > Produtos.',
        v_prod.nome USING ERRCODE = 'P0001';
    END IF;

    -- MIGR 676 (substitui o bloco da 627): o vínculo feito agora só vale com o
    -- NOME IDÊNTICO — o item, ou o item + a marca — e com a MARCA pedida.
    -- Óleo Soya com o texto do Óleo Liza entraria no saldo da Liza.
    v_marca := COALESCE(NULLIF(btrim(v_cot.marca), ''), v_req.marca);
    IF v_do_modal
       AND NOT public.vinculo_item_confere(v_req.item, v_marca, v_prod.nome, v_prod.marca) THEN
      RAISE EXCEPTION 'A requisição pediu "%"% e o produto do catálogo é "%"%. O pedido só liga um produto quando o nome é o mesmo da requisição e a marca é a pedida — nome parecido ou marca trocada é como o item sai errado. Se o produto ainda não existe, cadastre-o em Cadastros > Produtos > Novo com a marca no nome, escolhendo esta requisição no campo "Origem deste cadastro". Se quem pediu escreveu o nome errado, devolva a requisição para correção em Compras > Requisições.',
        COALESCE(v_req.item, 'este item'),
        COALESCE(' (marca ' || NULLIF(btrim(v_marca), '') || ')', ''),
        v_prod.nome,
        COALESCE(' (marca ' || NULLIF(btrim(v_prod.marca), '') || ')', '')
        USING ERRCODE = 'P0001';
    END IF;

    -- MIGR 596, segunda recusa: este código JÁ é o de outra requisição, de
    -- outro item. Foi assim que a corrente virou bermuda — o mesmo produto
    -- atendendo duas requisições diferentes. Reposição repete o código à
    -- vontade (é para isso que ela existe): a recusa só olha o vínculo feito
    -- no modal, e só quando o texto da outra requisição descreve outra coisa.
    IF v_do_modal THEN
      SELECT * INTO v_outra
        FROM public.requisicoes r
       WHERE r.produto_id = v_produto_id
         AND r.id <> v_req.id
         AND COALESCE(r.ativo, true)
         AND NOT public.vinculo_item_parece(r.item, COALESCE(v_req.item, ''))
       ORDER BY r.created_at
       LIMIT 1;
      IF v_outra.id IS NOT NULL THEN
        RAISE EXCEPTION 'O produto "%" já é o código da requisição % ("%"), que é outro item. Um código do catálogo identifica um produto só — reaproveitá-lo aqui faria as duas compras entrarem no mesmo saldo de estoque. Cadastre o item desta requisição em Cadastros > Produtos > Novo, escolhendo esta requisição no campo "Origem deste cadastro".',
          v_prod.nome, COALESCE(v_outra.numero, 'anterior'), v_outra.item
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_serv FROM public.servicos WHERE id = v_servico_id;
    IF v_serv.id IS NULL OR v_serv.ativo IS NOT TRUE OR COALESCE(v_serv.status, 'Ativo') = 'Inativo' THEN
      RAISE EXCEPTION 'Serviço não encontrado ou inativo.' USING ERRCODE = 'P0001';
    END IF;
    IF v_serv.filial IS NOT NULL AND v_serv.filial <> v_cot.filial THEN
      RAISE EXCEPTION 'O serviço "%" é do catálogo da %, e este pedido é da %.',
        v_serv.nome, v_serv.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
    -- MIGR 516: o catálogo de venda não é lista de compras. Serviço prestado é
    -- a saída da unidade — comprá-lo de um fornecedor seria a loja contratando
    -- o próprio serviço que ela oferece.
    IF COALESCE(v_serv.natureza, 'prestado') <> 'contratado' THEN
      RAISE EXCEPTION '"%" é um serviço PRESTADO pela unidade (é o que ela vende ao cliente), e não um serviço contratado de terceiro. Só serviço contratado vira pedido de compra. Cadastre o que está sendo contratado em Cadastros > Serviços, marcando a natureza como "Contratado de terceiro" — ou, se este cadastro já é o certo, corrija a natureza dele.',
        v_serv.nome USING ERRCODE = 'P0001';
    END IF;

    -- MIGR 628 (substitui a primeira recusa da 596 para serviço): mesma régua
    -- do produto na 627 — o vínculo feito agora só vale com o NOME IDÊNTICO.
    -- A segunda recusa continua não valendo aqui: dedetização é um cadastro
    -- só, contratado todo mês por requisições diferentes, e isso está certo.
    IF v_do_modal
       AND public.nome_item_normalizado(v_req.item) IS DISTINCT FROM public.nome_item_normalizado(v_serv.nome) THEN
      RAISE EXCEPTION 'A requisição pediu "%" e o serviço do catálogo é "%". O pedido só liga um serviço quando o nome é o mesmo da requisição. Se o serviço ainda não existe, cadastre-o em Cadastros > Serviços > Novo com a natureza "Contratado de terceiro" e o nome da requisição. Se quem pediu escreveu o nome errado, devolva a requisição para correção em Compras > Requisições.',
        COALESCE(v_req.item, 'este item'), v_serv.nome USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_req.id IS NOT NULL AND v_req.produto_id IS NULL AND v_req.servico_id IS NULL THEN
    UPDATE public.requisicoes
       SET produto_id = v_produto_id, servico_id = v_servico_id
     WHERE id = v_req.id;
  END IF;

  v_prazo := CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
                  THEN v_cot.prazo_entrega::date END;

  IF v_prazo IS NULL AND v_cot.fornecedor_id IS NOT NULL THEN
    SELECT prazo_entrega_dias INTO v_prazo_forn
      FROM public.fornecedores WHERE id = v_cot.fornecedor_id;
    IF COALESCE(v_prazo_forn, 0) > 0 THEN
      v_prazo := public.acre_today() + v_prazo_forn;
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd, produto_id, servico_id,
    condicao_pagamento
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd,
    v_produto_id, v_servico_id,
    v_cot.condicao_pagamento
  )
  RETURNING * INTO v_pedido;

  IF v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.requisicoes SET status = 'Atendida'
     WHERE id = v_cot.requisicao_id AND status = 'Aprovado';
  END IF;

  -- MIGR 584: a condição negociada vira os vencimentos. A base é a entrega
  -- prevista — é a data que já existe quando o título nasce; a nota chega
  -- depois. Sem condição (cotação antiga), a lista é {0}: vence na entrega,
  -- exatamente como antes.
  v_vencimento := COALESCE(v_prazo, public.acre_today() + 30);
  v_dias       := public.condicao_pagamento_dias(v_cot.condicao_pagamento);
  v_n          := COALESCE(array_length(v_dias, 1), 1);

  IF btrim(COALESCE(v_req.centro_custo, '')) <> '' THEN
    SELECT id INTO v_cc_id
      FROM public.centros_custo
     WHERE lower(btrim(nome)) = lower(btrim(v_req.centro_custo))
       AND COALESCE(ativo, true)
       AND COALESCE(status, 'Ativo') <> 'Inativo'
     LIMIT 1;
  END IF;

  v_descricao := COALESCE(v_pedido.numero, 'Pedido #' || upper(right(v_pedido.id::text, 6)))
                 || ' — ' || COALESCE(v_req.item, 'Compra')
                 || COALESCE(' (' || v_req.numero || ')', '');

  FOR v_i IN 1..v_n LOOP
    -- Centavo da divisão vai na última parcela: a soma tem de fechar com o
    -- pedido, senão a dívida nasce diferente do que foi comprado.
    v_parcela := CASE WHEN v_i < v_n
                      THEN ROUND(v_cot.valor_total / v_n, 2)
                      ELSE v_cot.valor_total - v_acumulado END;
    v_acumulado := v_acumulado + v_parcela;

    INSERT INTO public.contas_pagar (
      fornecedor_id, descricao, valor, vencimento, status, pedido_id, filial,
      centro_custo_id
    ) VALUES (
      v_cot.fornecedor_id,
      v_descricao || CASE WHEN v_n > 1 THEN format(' (%s/%s)', v_i, v_n) ELSE '' END,
      v_parcela, v_vencimento + v_dias[v_i], 'Pendente', v_pedido.id, v_cot.filial,
      v_cc_id
    );
  END LOOP;

  RETURN v_pedido;
END;
$function$;

NOTIFY pgrst, 'reload schema';
