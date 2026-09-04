-- ════════════════════════════════════════════════════════════════════════════
-- 584 — A compra passa a ter PRAZO DE PAGAMENTO
--
-- Até aqui toda compra da escola era à vista contra entrega: o título nascia
-- em `gerar_pedido_de_cotacao` com `vencimento = COALESCE(prazo_entrega,
-- hoje+30)`, e não existia campo nenhum — nem na proposta, nem no cadastro do
-- fornecedor — para dizer "30/60/90". Some com metade do trabalho de Compras
-- (negociar prazo é tão decisão quanto negociar preço) e some com o efeito no
-- caixa: duas propostas de mesmo valor e prazos diferentes apareciam como a
-- mesma coisa.
--
-- A régua é a mesma do orçamento de venda (migr. 568/569) vista do outro lado,
-- e é idêntica nas três lojas: comprar é processo da rede, não característica
-- da unidade.
--
--   À vista → 1 título na entrega
--   15 dias / 30 dias → 1 título, contado da entrega prevista
--   30/60 → 2 títulos     30/60/90 → 3 títulos
--
-- Contamos da ENTREGA PREVISTA (e não da emissão do pedido) porque é a data
-- que o fluxo já conhece quando o título nasce — a nota chega depois, e o
-- título precisa existir antes dela.
--
-- Duas funções antigas precisavam saber que agora há N parcelas, senão
-- passariam a mentir (é a armadilha de sempre: fluxo antigo não tocado):
--
--   • `conferir_nota_fiscal` escrevia o valor da nota INTEIRA na parcela
--     conferida. Com 3 parcelas, conferir uma nota de R$ 3.000 deixaria a
--     dívida em R$ 5.000. Agora a nota é do PEDIDO: ela redistribui o total
--     entre as parcelas ainda sem pagamento e carimba a conferência em todas.
--   • `registrar_devolucao_fornecedor` abatia só da parcela em aberto mais
--     antiga e parava. Devolução maior que a primeira parcela deixaria o resto
--     da dívida de pé. Agora o abatimento desce em cascata pelas parcelas.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cotacoes ADD COLUMN IF NOT EXISTS condicao_pagamento text;
ALTER TABLE public.pedidos  ADD COLUMN IF NOT EXISTS condicao_pagamento text;

COMMENT ON COLUMN public.cotacoes.condicao_pagamento IS
  'Prazo de pagamento negociado com o fornecedor. Vira os vencimentos dos títulos quando a cotação virar pedido (migr. 584).';
COMMENT ON COLUMN public.pedidos.condicao_pagamento IS
  'Condição carimbada da cotação aprovada — o pedido é o documento que vale (migr. 584).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.cotacoes'::regclass
                    AND conname = 'chk_cotacoes_condicao_pagamento') THEN
    ALTER TABLE public.cotacoes ADD CONSTRAINT chk_cotacoes_condicao_pagamento
      CHECK (condicao_pagamento IS NULL
             OR condicao_pagamento IN ('À vista', '15 dias', '30 dias', '30/60', '30/60/90'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pedidos'::regclass
                    AND conname = 'chk_pedidos_condicao_pagamento') THEN
    ALTER TABLE public.pedidos ADD CONSTRAINT chk_pedidos_condicao_pagamento
      CHECK (condicao_pagamento IS NULL
             OR condicao_pagamento IN ('À vista', '15 dias', '30 dias', '30/60', '30/60/90'));
  END IF;
END $$;

-- Uma condição vira uma lista de vencimentos, em dias contados da entrega.
-- NULL e desconhecido caem em {0}: é exatamente o comportamento de antes desta
-- migração, então cotação antiga gera pedido igual ao que geraria ontem.
CREATE OR REPLACE FUNCTION public.condicao_pagamento_dias(p_condicao text)
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE btrim(COALESCE(p_condicao, ''))
           WHEN '15 dias'  THEN ARRAY[15]
           WHEN '30 dias'  THEN ARRAY[30]
           WHEN '30/60'    THEN ARRAY[30, 60]
           WHEN '30/60/90' THEN ARRAY[30, 60, 90]
           ELSE ARRAY[0]
         END;
$function$;

REVOKE ALL ON FUNCTION public.condicao_pagamento_dias(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.condicao_pagamento_dias(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.condicao_pagamento_dias(text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. A correção da proposta também corrige o prazo
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text, text);

CREATE FUNCTION public.reenviar_cotacao_corrigida(
  p_cotacao_id uuid,
  p_valor_total numeric,
  p_prazo_entrega text DEFAULT NULL::text,
  p_validade text DEFAULT NULL::text,
  p_marca text DEFAULT NULL::text,
  p_observacao text DEFAULT NULL::text,
  p_condicao_pagamento text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cot      public.cotacoes;
  v_validade date;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_cot FROM public.cotacoes
   WHERE id = p_cotacao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotação não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_cot.status <> 'Em correção' THEN
    RAISE EXCEPTION 'Esta cotação não está em correção (está %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_is_service_role(), false) THEN
    IF NOT COALESCE(
         v_cot.criado_por = auth.uid()
         OR (public.auth_in_setor('compras', 'logistica')
             AND public.auth_pode_filial(v_cot.filial)), false) THEN
      RAISE EXCEPTION 'Só quem cadastrou a proposta (ou Compras da filial) corrige e reenvia.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF COALESCE(p_valor_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor da proposta precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  v_validade := NULLIF(trim(COALESCE(p_validade, '')), '')::date;
  IF v_validade IS NOT NULL AND v_validade < public.acre_today() THEN
    RAISE EXCEPTION 'A validade informada (%) já passou. Reenviar é revalidar: confirme com o fornecedor até quando o preço vale.',
      to_char(v_validade, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.cotacao_correcao', 'true', true);

  UPDATE public.cotacoes
     SET valor_total        = p_valor_total,
         prazo_entrega      = COALESCE(NULLIF(trim(COALESCE(p_prazo_entrega, '')), ''), prazo_entrega),
         validade           = v_validade,
         marca              = NULLIF(btrim(COALESCE(p_marca, '')), ''),
         observacao         = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
         -- NULL preserva: chamada antiga (sem o parâmetro) não apaga o prazo
         -- que já estava negociado.
         condicao_pagamento = COALESCE(NULLIF(btrim(COALESCE(p_condicao_pagamento, '')), ''),
                                       condicao_pagamento),
         status             = 'Aguardando Financeiro',
         feedback           = NULL
   WHERE id = p_cotacao_id
  RETURNING * INTO v_cot;

  PERFORM set_config('app.cotacao_correcao', 'false', true);

  RETURN jsonb_build_object('ok', true, 'cotacao', to_jsonb(v_cot));
END;
$function$;

REVOKE ALL ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text, text, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. O pedido carimba a condição e abre uma parcela por vencimento
-- ════════════════════════════════════════════════════════════════════════════

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

-- ════════════════════════════════════════════════════════════════════════════
-- 3. A nota é do PEDIDO, não da parcela
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conferir_nota_fiscal(p_conta_id uuid, p_nf_valor numeric, p_observacao text DEFAULT NULL::text)
 RETURNS contas_pagar
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta       public.contas_pagar;
  v_pedido      public.pedidos;
  v_nf_numero   text;
  v_divergencia numeric;
  v_fixo        numeric(15,2);
  v_restante    numeric(15,2);
  v_n           integer;
  v_i           integer := 0;
  v_acum        numeric(15,2) := 0;
  v_parcela     numeric(15,2);
  v_row         record;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id FOR UPDATE;
  IF v_conta.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_conta.filial), false) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_conta.ativo, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Conta inativa.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.pedido_id IS NULL THEN
    RAISE EXCEPTION 'Esta conta não vem de pedido de compra — não há pedido nem nota para conferir.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Pago' THEN
    RAISE EXCEPTION 'Conta já quitada — conferir a nota agora não mudaria o que saiu do caixa.'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_nf_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor da nota fiscal.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos WHERE id = v_conta.pedido_id;

  SELECT MAX(r.nf_numero) INTO v_nf_numero
    FROM public.recebimentos r
   WHERE r.pedido_id = v_conta.pedido_id
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Concluído', 'Parcial');

  IF v_nf_numero IS NULL THEN
    RAISE EXCEPTION 'Ainda não há recebimento conferido com nota para este pedido. O estoque confere a carga e registra a nota antes de o financeiro conferir o valor.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Divergência entre o combinado e o cobrado. Não bloqueia — em compra real
  -- ela acontece (frete, imposto, reajuste, entrega a menor). O que não pode é
  -- passar calada.
  v_divergencia := p_nf_valor - COALESCE(v_pedido.valor_total, 0);
  IF abs(v_divergencia) > 0.005
     AND COALESCE(btrim(COALESCE(p_observacao, '')), '') = '' THEN
    RAISE EXCEPTION 'A nota (R$ %) não bate com o pedido (R$ %). Escreva o motivo da diferença antes de liberar o pagamento.',
      to_char(p_nf_valor, 'FM999G999G990D00'),
      to_char(COALESCE(v_pedido.valor_total, 0), 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 584: a nota cobre o pedido inteiro, e o pedido pode ter virado 2 ou 3
  -- títulos. Parcela que já recebeu dinheiro não se mexe (o que saiu do caixa
  -- saiu); o valor da nota se distribui entre as que ainda não foram tocadas.
  SELECT COALESCE(sum(valor), 0) INTO v_fixo
    FROM public.contas_pagar
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true)
     AND (COALESCE(valor_pago, 0) > 0 OR status IN ('Pago', 'Parcial'));

  SELECT count(*) INTO v_n
    FROM public.contas_pagar
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true)
     AND COALESCE(valor_pago, 0) = 0
     AND status NOT IN ('Pago', 'Parcial');

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Todas as parcelas deste pedido já têm pagamento. A diferença da nota tem de ser resolvida com o fornecedor, não reescrevendo o que já saiu do caixa.'
      USING ERRCODE = 'P0001';
  END IF;

  v_restante := ROUND(p_nf_valor - v_fixo, 2);
  IF v_restante <= 0 THEN
    RAISE EXCEPTION 'A nota (R$ %) é menor do que o que já foi pago deste pedido (R$ %). Confira o valor com o fornecedor.',
      to_char(p_nf_valor, 'FM999G999G990D00'), to_char(v_fixo, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT id FROM public.contas_pagar
     WHERE pedido_id = v_conta.pedido_id
       AND COALESCE(ativo, true)
       AND COALESCE(valor_pago, 0) = 0
       AND status NOT IN ('Pago', 'Parcial')
     ORDER BY vencimento, created_at
     FOR UPDATE
  LOOP
    v_i := v_i + 1;
    v_parcela := CASE WHEN v_i < v_n THEN ROUND(v_restante / v_n, 2)
                      ELSE v_restante - v_acum END;
    v_acum := v_acum + v_parcela;

    UPDATE public.contas_pagar
       SET valor = v_parcela
     WHERE id = v_row.id;
  END LOOP;

  -- A conferência é do documento: carimba em todas as parcelas vivas, para
  -- qualquer uma delas mostrar que a nota deste pedido já foi conferida.
  UPDATE public.contas_pagar
     SET nf_valor         = p_nf_valor,
         nf_conferida_em  = now(),
         nf_conferida_por = auth.uid(),
         nf_observacao    = NULLIF(btrim(COALESCE(p_observacao, '')), '')
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true);

  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id;
  RETURN v_conta;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. A devolução desce em cascata pelas parcelas
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_devolucao_fornecedor(p_recebimento_id uuid, p_qtd numeric, p_motivo text, p_reenvio_esperado boolean DEFAULT true, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receb        recebimentos;
  v_pedido       pedidos;
  v_produto_id   uuid;
  v_ja_devolvido numeric;
  v_disponivel   numeric;
  v_unitario     numeric(15,4);
  v_valor        numeric(15,2);
  v_conta        contas_pagar;
  v_conta_novo   numeric(15,2);
  v_conta_efeito text := 'nenhum';
  v_saldo        numeric;
  v_pedido_fecha boolean := false;
  v_devolucao_id uuid;
  v_lote         record;
  v_restante     numeric;
  v_tira         numeric;
  v_lotes_baixados integer := 0;
  v_abater       numeric(15,2);
  v_tira_conta   numeric(15,2);
  v_piso         numeric(15,2);
BEGIN
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

  SELECT COALESCE(sum(qtd), 0) INTO v_ja_devolvido
    FROM public.devolucoes_fornecedor
   WHERE recebimento_id = p_recebimento_id AND ativo;

  v_disponivel := COALESCE(v_receb.qtd_recebida, 0) - v_ja_devolvido;
  IF p_qtd > v_disponivel THEN
    RAISE EXCEPTION 'Este recebimento tem % disponível para devolução (recebeu %, já devolveu %).',
      trim_scale(v_disponivel), trim_scale(COALESCE(v_receb.qtd_recebida, 0)),
      trim_scale(v_ja_devolvido) USING ERRCODE = 'P0001';
  END IF;

  SELECT produto_id INTO v_produto_id
    FROM public.movimentacoes_estoque
   WHERE recebimento_id = p_recebimento_id AND tipo = 'Entrada'
   ORDER BY created_at LIMIT 1;

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

  -- ── Lote (migr. 428) ──
  -- A mercadoria voltou para o fornecedor, então o lote que ela formou também
  -- encolhe. Ordem FEFO: o que vence primeiro é o primeiro a sair, inclusive
  -- numa devolução. Sem isto, a tela de Validades acusava divergência entre
  -- lote e saldo que ninguém tinha como resolver.
  v_restante := p_qtd;
  FOR v_lote IN
    SELECT * FROM public.vencimentos_estoque
     WHERE recebimento_id = p_recebimento_id
       AND COALESCE(ativo, true)
       AND status = 'OK'
       AND COALESCE(qtd, 0) > 0
     ORDER BY vencimento
     FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_tira := LEAST(v_lote.qtd, v_restante);

    UPDATE public.vencimentos_estoque
       SET qtd = v_lote.qtd - v_tira,
           status = CASE WHEN v_lote.qtd - v_tira <= 0 THEN 'Consumido' ELSE 'OK' END,
           observacao = COALESCE(observacao || ' | ', '') ||
                        'Devolvido ao fornecedor: ' || trim_scale(v_tira) || ' em ' ||
                        to_char(public.acre_today(), 'DD/MM/YYYY'),
           updated_at = now()
     WHERE id = v_lote.id;

    v_restante := v_restante - v_tira;
    v_lotes_baixados := v_lotes_baixados + 1;
  END LOOP;

  -- ── Financeiro ──
  -- MIGR 584: o pedido pode ter virado 2 ou 3 parcelas, então o abatimento
  -- desce em cascata — da parcela que vence primeiro para a seguinte. Antes
  -- ele parava na primeira, e devolução maior que uma parcela deixava o resto
  -- da dívida de pé. O piso continua sendo o que já foi pago (migr. 427):
  -- abater abaixo disso faria a conta dever menos do que saiu do caixa.
  IF v_valor > 0 THEN
    v_abater := v_valor;

    FOR v_conta IN
      SELECT * FROM public.contas_pagar
       WHERE pedido_id = v_pedido.id AND COALESCE(ativo, true)
         AND status IN ('Pendente', 'Parcial')
       ORDER BY vencimento, created_at
       FOR UPDATE
    LOOP
      EXIT WHEN v_abater <= 0.005;
      v_piso := COALESCE(v_conta.valor_pago, 0);
      v_tira_conta := LEAST(v_abater, GREATEST(v_conta.valor - v_piso, 0));
      CONTINUE WHEN v_tira_conta <= 0.005;

      v_conta_novo := ROUND(v_conta.valor - v_tira_conta, 2);
      IF v_conta_novo <= 0.005 THEN
        -- MIGR 547: a segunda porta legítima. A flag morre no COMMIT.
        PERFORM set_config('app.conta_pedido_baixa', 'true', true);
        UPDATE public.contas_pagar
           SET ativo = false,
               descricao = descricao || ' — cancelada por devolução ao fornecedor',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := CASE WHEN v_conta_efeito = 'nenhum' THEN 'cancelada' ELSE 'abatida' END;
      ELSE
        UPDATE public.contas_pagar
           SET valor = v_conta_novo,
               descricao = descricao || ' — abatido R$ ' || to_char(v_tira_conta, 'FM999G999G990D00') || ' (devolução)',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := 'abatida';
      END IF;

      v_abater := v_abater - v_tira_conta;
    END LOOP;

    IF v_conta_efeito = 'nenhum' AND EXISTS (
      SELECT 1 FROM public.contas_pagar
       WHERE pedido_id = v_pedido.id AND COALESCE(ativo, true) AND status = 'Pago'
    ) THEN
      v_conta_efeito := 'ja_paga';
    END IF;
  END IF;

  -- ── Pedido ──
  SELECT qtd_saldo INTO v_saldo FROM public.v_pedido_saldo WHERE pedido_id = v_pedido.id;

  IF COALESCE(v_saldo, 0) <= 0 AND v_pedido.status NOT IN ('Recebido', 'Cancelado') THEN
    UPDATE public.pedidos SET status = 'Recebido' WHERE id = v_pedido.id;
    v_pedido_fecha := true;
  ELSIF COALESCE(p_reenvio_esperado, true) AND v_pedido.status = 'Recebido' THEN
    UPDATE public.pedidos SET status = 'Em Entrega' WHERE id = v_pedido.id;
  END IF;

  RETURN jsonb_build_object(
    'devolucao_id',    v_devolucao_id,
    'qtd',             p_qtd,
    'valor',           v_valor,
    'conta_efeito',    v_conta_efeito,
    'saldo_pedido',    COALESCE(v_saldo, 0),
    'pedido_fechado',  v_pedido_fecha,
    'estoque_baixado', v_produto_id IS NOT NULL,
    'lotes_baixados',  v_lotes_baixados
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
