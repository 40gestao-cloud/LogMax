-- 544 — O pedido cancelado devolve a requisição de verdade.
--
-- `cancelar_pedido_compra` termina com este bloco, e o comentário dele já diz
-- exatamente a intenção certa:
--
--     -- A requisicao volta a poder ser cotada. Sem isto ela fica 'Atendida'
--     -- por um pedido cancelado: fora do dropdown de nova cotacao e
--     -- impossivel de refazer.
--     IF v_ped.requisicao_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM pedidos p
--                         WHERE p.requisicao_id = v_ped.requisicao_id
--                           AND p.id <> v_ped.id AND COALESCE(p.ativo, true)
--                           AND p.status <> 'Cancelado')      <── a régua certa
--     THEN UPDATE requisicoes SET status = 'Aprovado' ...
--
-- Ela volta para 'Aprovado' e reaparece no dropdown de Cotações. E aí o fluxo
-- morre, porque `gerar_pedido_de_cotacao` faz a MESMA pergunta com OUTRA régua:
--
--     IF EXISTS (SELECT 1 FROM pedidos WHERE cotacao_id    = v_cot.id             AND ativo)
--     IF EXISTS (SELECT 1 FROM pedidos WHERE requisicao_id = v_cot.requisicao_id  AND ativo)
--
-- Cancelar grava `status = 'Cancelado'` e deixa `ativo = true` — soft delete e
-- cancelamento são coisas diferentes neste sistema, e é assim que tem de ser: o
-- pedido cancelado continua sendo o rastro do que a turma fez. Mas nestes dois
-- guards `ativo` foi lido como "não cancelado", e o pedido morto segue barrando
-- o vivo.
--
-- O caminho que o aluno percorre: cancela o pedido → a requisição reaparece →
-- cancela a cotação (`fn_cotacao_com_pedido_nao_volta` deixa, porque ELA olha o
-- status) → cota de novo → o Financeiro aprova de novo → e o Gerar Pedido
-- recusa com "Esta requisição já foi atendida por outro pedido". Não existe
-- saída pela tela. O documento fica vivo, visível, clicável — e inerte.
--
-- ─── ESTADO NA BASE QUANDO ISTO FOI ESCRITO (ERP, 26/08) ───────────────────
--
-- Três requisições presas, uma em cada ponta do exercício:
--
--   PC-TM-2026-0026 · requisição Aprovado · cotação Aprovado
--   PC-TM-2026-0024 · requisição Aprovado · cotação Aprovado
--   PC-ML-2026-0063 · requisição Aprovado · cotação Aprovado
--
-- Nenhuma precisa de conserto de dados: a cotação aprovada delas continua viva,
-- então depois desta migração o Gerar Pedido volta a funcionar nas três sem
-- ninguém tocar em nada. É o teste de aceitação desta migração.
--
-- ─── A MESMA RÉGUA EM reabrir_requisicao ───────────────────────────────────
--
-- `reabrir_requisicao` recusa reabrir quando existe pedido `ativo`, com a mesma
-- leitura. Uma requisição cujo único pedido foi cancelado é exatamente o caso em
-- que a direção precisa poder reabrir — e era o caso em que ela não podia.
--
-- ─── E NO MAPA DO FLUXO ────────────────────────────────────────────────────
--
-- `mapa_fluxo_compras` (migr. 533) escolhe o pedido da linha por `ativo`. Uma
-- cadeia cujo único pedido foi cancelado aparecia na etapa 'Pedido', com tique
-- verde — numa tela cujo propósito inteiro é dizer onde a cadeia parou.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. gerar_pedido_de_cotacao — o pedido cancelado para de barrar o vivo
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente no banco (md5 igual nos 4), com os dois EXISTS
-- corrigidos e nada mais. As travas das migr. 480, 515 e 516 e a geração da
-- conta a pagar ficam como estão.
CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(
  p_cotacao_id uuid,
  p_produto_id uuid DEFAULT NULL::uuid,
  p_servico_id uuid DEFAULT NULL::uuid)
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

  v_vencimento := COALESCE(v_prazo, public.acre_today() + 30);

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

-- ────────────────────────────────────────────────────────────────────────────
-- 2. reabrir_requisicao — a mesma régua
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reabrir_requisicao(p_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req      public.requisicoes;
  v_nome     text;
  v_ap_id    uuid;
  v_pedido   text;
  v_restaura boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro')) THEN
    RAISE EXCEPTION 'Só a direção reabre uma requisição.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- MIGR 544: pedido cancelado não segura a reabertura. É justamente o caso em
  -- que a direção mais precisa dela.
  SELECT COALESCE(p.numero, upper(right(p.id::text, 6))) INTO v_pedido
    FROM public.pedidos p
   WHERE p.requisicao_id = v_req.id AND COALESCE(p.ativo, true)
     AND p.status <> 'Cancelado'
   LIMIT 1;

  IF v_pedido IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta requisição já virou o pedido %. Cancele o pedido antes de reabri-la — a conta a pagar dele é inativada junto.',
      v_pedido
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.cotacoes c
              WHERE c.requisicao_id = v_req.id AND COALESCE(c.ativo, true)
                AND c.status IN ('Aguardando Financeiro', 'Aprovado')) THEN
    RAISE EXCEPTION
      'Existe cotação em andamento para esta requisição. Cancele a cotação antes de reabrir.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();
  v_restaura := NOT COALESCE(v_req.ativo, true);

  UPDATE public.requisicoes
     SET status       = 'Pendente',
         ativo        = true,
         reenviada_em = NULL
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  SELECT id INTO v_ap_id FROM public.aprovacoes_compras
   WHERE requisicao_id = v_req.id ORDER BY created_at DESC NULLS LAST LIMIT 1;

  IF v_ap_id IS NULL THEN
    INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
    VALUES (v_req.id, 'Pendente', v_req.filial);
  ELSE
    UPDATE public.aprovacoes_compras
       SET status     = 'Pendente',
           aprovador  = NULL,
           observacao = format('Reaberta por %s%s.',
                               COALESCE(v_nome, 'direção'),
                               COALESCE(' — ' || NULLIF(trim(p_motivo), ''), ''))
     WHERE id = v_ap_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'restaurada', v_restaura,
    'requisicao', to_jsonb(v_req)
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. mapa_fluxo_compras — pedido cancelado não é etapa alcançada
-- ────────────────────────────────────────────────────────────────────────────
-- Só a lateral de `pedidos` muda: ela passa a ignorar o cancelado, como já
-- ignora o inativo.
CREATE OR REPLACE FUNCTION public.mapa_fluxo_compras(
  p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_ate timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_filial text DEFAULT NULL::text,
  p_sessao_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  requisicao_id uuid, requisicao_numero text, filial text, item text,
  solicitante text, requisicao_status text, requisicao_em timestamp with time zone,
  cotacoes_total integer, cotacao_id uuid, cotacao_status text, cotacao_fornecedor text,
  cotacao_em timestamp with time zone, pedido_id uuid, pedido_numero text,
  pedido_status text, pedido_em timestamp with time zone, recebimento_id uuid,
  recebimento_status text, recebimento_em timestamp with time zone, produto_id uuid,
  produto_codigo text, produto_nome text, produto_em timestamp with time zone,
  confirmado boolean, confirmado_em timestamp with time zone, etapa_atual text,
  parado_ha_horas numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_de  timestamptz;
  v_ate timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Apenas o professor (admin) pode ver o mapa do fluxo.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_sessao_id IS NOT NULL THEN
    SELECT s.iniciada_em, COALESCE(s.encerrada_em, now())
      INTO v_de, v_ate
      FROM public.aula_sessoes s WHERE s.id = p_sessao_id;
    IF v_de IS NULL THEN
      RAISE EXCEPTION 'Sessão de aula % não encontrada.', p_sessao_id
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_de  := COALESCE(p_desde, now() - interval '24 hours');
    v_ate := COALESCE(p_ate, now());
  END IF;

  RETURN QUERY
  SELECT
    r.id, COALESCE(r.numero, left(r.id::text, 8)), r.filial, r.item,
    COALESCE(up.nome, r.solicitante, '—'), r.status, r.created_at,

    cnt.n::integer, cot.id, cot.status, forn.nome, cot.created_at,

    pe.id, pe.numero, pe.status, pe.created_at,

    rec.id, rec.status, rec.created_at,

    prod.id, prod.codigo, prod.nome, prod.created_at,

    (mov.id IS NOT NULL), mov.created_at,

    -- A etapa é CUMULATIVA: cada nível exige o anterior. Parece redundante,
    -- mas não é — `prod.id` sozinho NÃO significa que a cadeia chegou ao
    -- cadastro. Na REPOSIÇÃO a `criar_requisicoes_compra_lote` (migr. 358)
    -- grava `produto_id` no INSERT da requisição, porque repor é justamente
    -- pedir mais de um item que JÁ está no catálogo. Sem exigir o recebimento
    -- aqui, toda requisição de reposição recém-criada apareceria na etapa
    -- 'Produto', com tique verde em Cotação, Pedido e Recebimento que nunca
    -- aconteceram — mentira numa tela cujo propósito inteiro é a verdade.
    CASE
      -- Serviço não passa por Produto/Confirmação (migr. 499/516): o pedido é
      -- o fim da linha dele, e chegar lá já fecha a cadeia.
      WHEN r.servico_id IS NOT NULL AND pe.id IS NOT NULL THEN 'Pedido (serviço)'
      WHEN mov.id  IS NOT NULL THEN 'Confirmado'
      WHEN rec.id  IS NOT NULL AND prod.id IS NOT NULL THEN 'Produto'
      WHEN rec.id  IS NOT NULL THEN 'Recebimento'
      WHEN pe.id   IS NOT NULL THEN 'Pedido'
      WHEN cot.id  IS NOT NULL THEN 'Cotação'
      ELSE 'Requisição'
    END,
    CASE WHEN mov.id IS NOT NULL THEN NULL
         WHEN r.servico_id IS NOT NULL AND pe.id IS NOT NULL THEN NULL
         -- `prod.created_at` entra SÓ quando houve recebimento — a mesma
         -- condição que deixa a cadeia alcançar a etapa 'Produto'. Solto, ele
         -- estragaria a conta na reposição, onde o produto é de meses atrás e
         -- nada tem a ver com o momento em que esta cadeia parou.
         ELSE round(EXTRACT(EPOCH FROM (
                now() - GREATEST(r.created_at,
                  COALESCE(cot.created_at, r.created_at),
                  COALESCE(pe.created_at,  '-infinity'::timestamptz),
                  COALESCE(rec.created_at, '-infinity'::timestamptz),
                  COALESCE(CASE WHEN rec.id IS NOT NULL THEN prod.created_at END,
                           '-infinity'::timestamptz))
              ))::numeric / 3600, 1)
    END
  FROM public.requisicoes r
  LEFT JOIN public.user_profiles up ON up.id = r.criado_por
  CROSS JOIN LATERAL (
    SELECT count(*) AS n FROM public.cotacoes c
     WHERE c.requisicao_id = r.id AND COALESCE(c.ativo, true)
  ) cnt
  -- A cotação que representa a requisição na linha: a que gerou pedido, ou,
  -- na falta de pedido, a viva mais recente (aprovada primeiro).
  LEFT JOIN LATERAL (
    SELECT c.* FROM public.cotacoes c
     WHERE c.requisicao_id = r.id AND COALESCE(c.ativo, true)
     ORDER BY (c.status = 'Aprovado') DESC, c.created_at DESC
     LIMIT 1
  ) cot ON true
  LEFT JOIN public.fornecedores forn ON forn.id = cot.fornecedor_id
  LEFT JOIN LATERAL (
    SELECT pe.* FROM public.pedidos pe
     WHERE pe.requisicao_id = r.id AND COALESCE(pe.ativo, true)
       AND pe.status <> 'Cancelado'                       -- MIGR 544
     ORDER BY pe.created_at DESC LIMIT 1
  ) pe ON true
  LEFT JOIN LATERAL (
    SELECT rec.* FROM public.recebimentos rec
     WHERE rec.pedido_id = pe.id AND COALESCE(rec.ativo, true)
     ORDER BY rec.created_at DESC LIMIT 1
  ) rec ON true
  LEFT JOIN public.produtos prod
    ON prod.id = COALESCE(r.produto_id, pe.produto_id) AND COALESCE(prod.ativo, true)
  LEFT JOIN LATERAL (
    SELECT me.* FROM public.movimentacoes_estoque me
     WHERE me.recebimento_id = rec.id AND COALESCE(me.ativo, true)
     LIMIT 1
  ) mov ON true
  WHERE COALESCE(r.ativo, true)
    AND r.created_at BETWEEN v_de AND v_ate
    AND (p_filial IS NULL OR r.filial = p_filial)
  ORDER BY r.created_at DESC;
END;
$function$;

COMMIT;

-- PostgREST guarda a assinatura em cache; sem isto o Gerar Pedido continua
-- batendo na versão antiga até o próximo restart.
NOTIFY pgrst, 'reload schema';
