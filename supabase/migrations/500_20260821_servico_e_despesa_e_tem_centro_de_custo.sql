-- 500_20260821_servico_e_despesa_e_tem_centro_de_custo.sql
--
-- Dois furos da migr. 499, achados conferindo o banco depois de aplicá-la.
-- A 499 disse a coisa certa no DRE e deixou duas peças do caminho contando
-- outra história.
--
-- ── 1. A conta nascia carimbada como "estoque" ──────────────────────────────
-- `fn_conta_pagar_natureza` (migr. 447) é BEFORE INSERT em `contas_pagar` e
-- decide sozinha, sem olhar o pedido:
--
--     IF NEW.pedido_id IS NOT NULL THEN NEW.natureza := 'estoque';
--
-- A régua estava certa quando pedido era sempre mercadoria. Com a 499 deixou de
-- estar: a contratação de dedetização entra em Contas a pagar com o rótulo
-- "vira estoque", enquanto o DRE da mesma conta a soma como despesa. O aluno lê
-- as duas telas e elas discordam — e a que ele acredita é a que tem o rótulo.
--
-- É o padrão de sempre: categoria nova não avisa a função antiga que filtrava
-- pela ausência dela.
--
-- ── 2. A despesa caía toda em "Não classificado" ────────────────────────────
-- A 499 promete, no próprio cabeçalho, que o serviço aparece "no grupo do
-- centro de custo". Só que `gerar_pedido_de_cotacao` nunca preencheu
-- `contas_pagar.centro_custo_id` — não precisava, porque a conta de pedido
-- estava fora do DRE. Agora precisa: o `LEFT JOIN centros_custo` do
-- `gerar_dre` devolve NULL e todo serviço do período empilha em "Não
-- classificado", que é exatamente o grupo que não ensina nada.
--
-- O centro de custo já foi informado — a requisição pergunta por ele em
-- `requisicoes.centro_custo`, texto que casa com `centros_custo.nome`. Só
-- faltava carregá-lo até a conta.
--
-- Vale para material também: a coluna passa a ser preenchida sempre. Em
-- mercadoria ela não muda resultado nenhum (a conta segue fora do DRE, porque
-- o custo dela chega pelo CMV), mas deixa a conta rastreável por área — e
-- evita que a próxima mudança de régua precise de outro backfill.


BEGIN;

-- ── 1. Serviço é despesa, e a conta diz isso ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conta_pagar_natureza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Pedido de MERCADORIA é estoque, sempre: o resultado dela vem pelo CMV ou
  -- pelo consumo, e aceitar 'despesa' aqui duplicaria a saída.
  --
  -- Pedido de SERVIÇO nunca vira estoque (migr. 499): não tem saldo, não tem
  -- lote, não vira CMV. É despesa do período, e é assim que o DRE já o conta.
  IF NEW.pedido_id IS NOT NULL THEN
    NEW.natureza := CASE
      WHEN EXISTS (SELECT 1 FROM public.pedidos p
                    WHERE p.id = NEW.pedido_id AND p.servico_id IS NOT NULL)
      THEN 'despesa' ELSE 'estoque' END;
    RETURN NEW;
  END IF;

  -- Folha e rescisão são despesa por natureza — não há o que escolher.
  IF NEW.folha_pagamento_id IS NOT NULL OR NEW.rescisao_id IS NOT NULL THEN
    NEW.natureza := 'despesa';
    RETURN NEW;
  END IF;

  NEW.natureza := COALESCE(NULLIF(btrim(COALESCE(NEW.natureza, '')), ''), 'despesa');
  RETURN NEW;
END;
$function$;

-- Conta de serviço já gravada com o rótulo velho (turma que rodou a 499 e
-- contratou antes desta).
UPDATE public.contas_pagar cp
   SET natureza = 'despesa'
  FROM public.pedidos p
 WHERE p.id = cp.pedido_id
   AND p.servico_id IS NOT NULL
   AND COALESCE(cp.natureza, '') <> 'despesa';

-- ── 2. O centro de custo chega até a conta ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(
  p_cotacao_id uuid,
  -- Lidos só quando a requisição não trouxe o vínculo. Defaults nulos mantêm a
  -- chamada de um argumento válida para a Reposição.
  p_produto_id uuid DEFAULT NULL,
  p_servico_id uuid DEFAULT NULL
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
  v_servico_id uuid;
  v_prod       public.produtos;
  v_serv       public.servicos;
  v_cc_id      uuid;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_cotacao_id FOR UPDATE;

  IF v_cot.id IS NULL THEN
    RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- COALESCE porque `auth_pode_filial` devolve NULL para conta sem filial
  -- (migr. 411/495), e `IF NOT NULL` não entra no bloco.
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
  -- Reposição já vem resolvida da requisição. Eventual depende do comprador —
  -- que agora escolhe a CATEGORIA: material ou serviço.
  v_produto_id := COALESCE(v_req.produto_id, p_produto_id);
  v_servico_id := COALESCE(v_req.servico_id, p_servico_id);

  IF v_produto_id IS NOT NULL AND v_servico_id IS NOT NULL THEN
    RAISE EXCEPTION 'O pedido é de um produto OU de um serviço, não dos dois.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_produto_id IS NULL AND v_servico_id IS NULL THEN
    -- A mensagem fala a língua do que foi pedido: unidade SV é serviço, e
    -- mandar cadastrar produto ali é o que fazia o aluno criar "Manutenção do
    -- ar-condicionado" como mercadoria de estoque.
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
    -- Catálogo é por unidade: comprar contra o produto da vizinha faria a
    -- entrada do recebimento mexer no estoque dela.
    IF v_prod.filial IS DISTINCT FROM v_cot.filial THEN
      RAISE EXCEPTION 'O produto "%" é do catálogo da %, e este pedido é da %.',
        v_prod.nome, v_prod.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO v_serv FROM public.servicos WHERE id = v_servico_id;
    IF v_serv.id IS NULL OR v_serv.ativo IS NOT TRUE OR COALESCE(v_serv.status, 'Ativo') = 'Inativo' THEN
      RAISE EXCEPTION 'Serviço não encontrado ou inativo.' USING ERRCODE = 'P0001';
    END IF;
    -- `servicos.filial` é nulável: serviço cadastrado sem unidade vale para
    -- todas (é o caso do que a holding contrata). Com unidade, vale a régua do
    -- produto.
    IF v_serv.filial IS NOT NULL AND v_serv.filial <> v_cot.filial THEN
      RAISE EXCEPTION 'O serviço "%" é do catálogo da %, e este pedido é da %.',
        v_serv.nome, v_serv.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- O comprador normalizou um texto livre: a requisição passa a saber de qual
  -- item ela estava falando. É o que faz a próxima compra do mesmo item nascer
  -- como Reposição (ou já amarrada ao serviço), sem ninguém redigitar nome.
  IF v_req.id IS NOT NULL AND v_req.produto_id IS NULL AND v_req.servico_id IS NULL THEN
    UPDATE public.requisicoes
       SET produto_id = v_produto_id, servico_id = v_servico_id
     WHERE id = v_req.id;
  END IF;

  v_prazo := CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
                  THEN v_cot.prazo_entrega::date END;

  -- Cotação sem data prometida: usa o prazo médio do fornecedor.
  IF v_prazo IS NULL AND v_cot.fornecedor_id IS NOT NULL THEN
    SELECT prazo_entrega_dias INTO v_prazo_forn
      FROM public.fornecedores WHERE id = v_cot.fornecedor_id;
    IF COALESCE(v_prazo_forn, 0) > 0 THEN
      v_prazo := public.acre_today() + v_prazo_forn;
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd, produto_id, servico_id
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd,
    v_produto_id, v_servico_id
  )
  RETURNING * INTO v_pedido;

  IF v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.requisicoes SET status = 'Atendida'
     WHERE id = v_cot.requisicao_id AND status = 'Aprovado';
  END IF;

  -- +30 dias quando a cotação não trouxe prazo — a conta precisa de vencimento.
  v_vencimento := COALESCE(v_prazo, public.acre_today() + 30);

  -- Centro de custo da requisição (texto) → id. É o que faz a despesa de
  -- serviço cair no grupo certo do DRE em vez de "Não classificado" — a
  -- requisição já perguntou por ele, só não estava sendo levado adiante.
  -- `ativo` E `status`: a lista de Cadastros usa os dois, e centro arquivado
  -- não deve puxar despesa nova.
  IF btrim(COALESCE(v_req.centro_custo, '')) <> '' THEN
    SELECT id INTO v_cc_id
      FROM public.centros_custo
     WHERE lower(btrim(nome)) = lower(btrim(v_req.centro_custo))
       AND COALESCE(ativo, true)
       AND COALESCE(status, 'Ativo') <> 'Inativo'
     LIMIT 1;
  END IF;

  INSERT INTO public.contas_pagar (
    fornecedor_id, descricao, valor, vencimento, status, pedido_id, filial,
    centro_custo_id
  ) VALUES (
    v_cot.fornecedor_id,
    COALESCE(v_pedido.numero, 'Pedido #' || upper(right(v_pedido.id::text, 6)))
      || ' — ' || COALESCE(v_req.item, 'Compra')
      || COALESCE(' (' || v_req.numero || ')', ''),
    v_cot.valor_total, v_vencimento, 'Pendente', v_pedido.id, v_cot.filial,
    v_cc_id
  );

  RETURN v_pedido;
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT prosrc ~ 'servico_id IS NOT NULL' FROM pg_proc WHERE proname = 'fn_conta_pagar_natureza';
--   -- true
--   SELECT prosrc ~ 'centros_custo' FROM pg_proc WHERE proname = 'gerar_pedido_de_cotacao';
--   -- true
--
--   -- Nenhuma conta de serviço rotulada como estoque:
--   SELECT count(*) FROM contas_pagar cp JOIN pedidos p ON p.id = cp.pedido_id
--    WHERE p.servico_id IS NOT NULL AND cp.natureza <> 'despesa';   -- 0
-- ════════════════════════════════════════════════════════════════════════════
