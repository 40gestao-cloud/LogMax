-- 596 — O pedido recusa o item que não é o que o setor pediu.
--
-- O que aconteceu em aula (turma da contabilidade, MaxLook, 09/09):
-- a REQ-ML-2026-0232 pedia "Corrente Masculina Tommy Hilfiger 3D Flag Metal" e
-- foi amarrada, no modal de Gerar Pedido, ao produto "Bermuda masculino Dry fit
-- importado" — o mesmo código que a requisição vizinha (0233) já usava. Nasceu
-- o PC-ML-2026-0025, o recebimento confirmou 20 bermudas no estoque e o título
-- foi para o contas a pagar. O erro é silencioso e definitivo: a RPC ainda
-- grava o vínculo de volta na requisição, então a próxima compra da corrente
-- já nasceria como reposição de bermuda.
--
-- Por que a defesa que existia não segurou: ela era um aviso. A tela comparava
-- as duas frases, pintava o alerta de vermelho e pedia uma caixinha de
-- "Conferi". Um clique derrubava tudo, e o banco aceitava qualquer produto
-- ativo da própria filial. Numa turma de trinta pessoas, o checkbox é o
-- caminho de menor esforço — a atenção do aluno não pode ser a única trava.
--
-- Aqui a régua desce para o banco, nas duas perguntas que o comprador deveria
-- ter feito:
--   1. este produto é MESMO o que a requisição descreve? (radical em comum)
--   2. este código já é o de OUTRA requisição, de outro item? (código reusado)
-- Só valem para o vínculo feito na hora do pedido (requisição eventual, sem
-- código). Reposição escolheu do catálogo lá atrás e não passa por aqui — e o
-- mesmo produto pode, e deve, ser requisitado mil vezes por reposição.

-- ---------------------------------------------------------------------------
-- As palavras que identificam um item, com o mesmo recorte da tela
-- (src/views/CotacoesView.tsx). Radical de 4 letras porque plural e gênero não
-- mudam o item; qualificador não identifica nada — "Meia masculina" e "Corrente
-- masculina" combinariam por "masculin" e a trava nunca acusaria.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.palavras_vinculo(p_texto text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT left(w, 4)), '{}'::text[])
    FROM unnest(
           string_to_array(
             regexp_replace(
               translate(lower(COALESCE(p_texto, '')),
                         'áàâãäéèêëíìîïóòôõöúùûüçñ',
                         'aaaaaeeeeiiiiooooouuuucn'),
               '[^a-z0-9]+', ' ', 'g'),
             ' ')
         ) AS w
   WHERE length(w) >= 4
     AND w <> ALL (ARRAY[
       'para','unidade','unidades','caixa','caixas','pacote','pacotes',
       'fardo','fardos','novo','nova','tamanho','marca','tipo','modelo','linha',
       'masculino','masculina','masculinos','masculinas',
       'feminino','feminina','femininos','femininas',
       'infantil','unissex','adulto','importado','importada',
       'preto','preta','branco','branca','azul','verde','vermelho','vermelha',
       'amarelo','amarela','cinza','rosa','bege','dourado','dourada','prata',
       'grande','pequeno','pequena','medio','media'
     ]);
$function$;

COMMENT ON FUNCTION public.palavras_vinculo(text) IS
  'Radicais de 4 letras que identificam um item, sem ruído de embalagem, cor ou gênero. Espelha palavrasVinculo() em src/views/CotacoesView.tsx — mudou aqui, muda lá.';

-- As duas frases falam do mesmo item? A régua é grosseira de propósito: não
-- decide por ninguém, só percebe que não há palavra nenhuma em comum. Sem
-- palavra utilizável de um dos lados não dá para afirmar nada, e recusar sem
-- base transformaria a trava em obstáculo aleatório.
CREATE OR REPLACE FUNCTION public.vinculo_item_parece(p_item text, p_nome text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN cardinality(a) = 0 OR cardinality(b) = 0 THEN true
           ELSE a && b
         END
    FROM (SELECT public.palavras_vinculo(p_item) AS a,
                 public.palavras_vinculo(p_nome) AS b) s;
$function$;

COMMENT ON FUNCTION public.vinculo_item_parece(text, text) IS
  'true quando o texto da requisição e o nome do catálogo têm ao menos um radical em comum. Espelha vinculoParece() em src/views/CotacoesView.tsx.';

REVOKE ALL ON FUNCTION public.palavras_vinculo(text)          FROM anon;
REVOKE ALL ON FUNCTION public.vinculo_item_parece(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.palavras_vinculo(text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.vinculo_item_parece(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- A RPC do pedido, com as duas recusas. Corpo copiado do banco (md5
-- 1233b8cfcc79fda9ee0083092ffdd768, idêntico nas 4 turmas) — o resto é a 584.
-- ---------------------------------------------------------------------------
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

    -- MIGR 596, primeira recusa: o item escrito e o item do catálogo não têm
    -- palavra nenhuma em comum. Antes isto era um alerta com caixinha de
    -- confirmação na tela; virou recusa porque o estrago é definitivo — o
    -- pedido sai trocado, o vínculo fica gravado na requisição e o
    -- recebimento dá entrada de estoque no produto errado.
    IF v_do_modal AND NOT public.vinculo_item_parece(v_req.item, v_prod.nome) THEN
      RAISE EXCEPTION 'A requisição pediu "%" e o produto escolhido é "%" — não são o mesmo item, e o pedido sairia com o produto trocado. Se o catálogo ainda não tem este item, cadastre-o em Cadastros > Produtos > Novo escolhendo esta requisição no campo "Origem deste cadastro". Se quem pediu é que escreveu errado, devolva a requisição para correção em Compras > Requisições.',
        COALESCE(v_req.item, 'este item'), v_prod.nome USING ERRCODE = 'P0001';
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

    -- MIGR 596: mesma primeira recusa, do lado do serviço. A segunda não vale
    -- aqui — dedetização é um cadastro só, contratado todo mês por
    -- requisições diferentes, e isso está certo.
    IF v_do_modal AND NOT public.vinculo_item_parece(v_req.item, v_serv.nome) THEN
      RAISE EXCEPTION 'A requisição pediu "%" e o serviço escolhido é "%" — não são a mesma contratação. Se o catálogo ainda não tem este serviço, cadastre-o em Cadastros > Serviços > Novo com a natureza "Contratado de terceiro". Se quem pediu é que escreveu errado, devolva a requisição para correção em Compras > Requisições.',
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
