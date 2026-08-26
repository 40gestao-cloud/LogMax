-- 534 — A 471 pegava campo errado. Faltava pegar duplicata.
--
-- A pergunta que motivou esta migração foi literal: "1 produto cadastrado 2
-- vezes é um exemplo" do que o professor não consegue enxergar sozinho. A
-- migr. 471 já cobre "Código repetido na filial" — mas o índice único da
-- migr. 201 já barra código repetido; a duplicata de verdade, a que passa
-- batida, é o MESMO produto cadastrado com nome diferente ("Arroz 5kg" e
-- "ARROZ BRANCO 5 KG"), com EAN igual, ou com duas requisições distintas
-- apontando pro mesmo item.
--
-- `CREATE OR REPLACE` sobre `auditar_fluxo_compras` — corpo copiado do banco
-- (`pg_get_functiondef`, conferido idêntico ao arquivo 471 antes de mexer),
-- não do arquivo, porque migração posterior pode ter tocado a função sem que
-- este arquivo saiba.
--
-- ─── REGRAS NOVAS, TODAS SONDADAS NOS 4 PROJETOS ANTES DE ENTRAR ───────────
--
-- Cada uma rodou como SELECT solto contra os 4 bancos antes de virar regra —
-- o critério é o mesmo da 471: regra que acusa a turma inteira por algo que a
-- UI não previne é ruído, e ruído derruba a confiança no relatório inteiro
-- (foi por isso que condição de pagamento e prefixo de SKU ficaram de fora
-- lá atrás).
--
-- Contagem das sondas (ERP / Aprendiz / Contabilidade / Adm):
--   nome duplicado ..................... 0 / 2 / 6 / 0   (todos reais)
--   EAN repetido ....................... 0 / 0 / 0 / 0
--   fornecedor trocado ................. 0 / 0 / 0 / 0
--   recebido acima do pedido ........... 1 / 0 / 0 / 0   (real)
--   recebimento em duplicidade ......... 0 / 0 / 0 / 0
--   cotação duplicada .................. 0 / 0 / 0 / 0
--   produto de outra unidade ........... 0 / 0 / 0 / 0
--   vinculado a +1 requisição .......... 3 / 1 / 0 / 0   (após o filtro
--                                        'Eventual' explicado lá embaixo)
--
--   Produto ── Nome duplicado no catálogo   (match exato, lower+trim — sem
--               similaridade fuzzy: "Camiseta P" e "Camiseta G" da grade de
--               variantes da MaxLook, migr. 445, teriam similaridade alta e
--               são produtos DIFERENTES. Fuzzy fica pra camada 2, migr. 472,
--               que já lê texto com contexto de vizinhos).
--   Produto ── EAN repetido na filial        (índice único, migr. 443, convive
--               com EAN nulo — dois cadastros em branco escapam do índice)
--   Produto ── Vinculado a mais de uma requisição (duas requisições com o
--               mesmo produto_id é sinal de que uma delas devia ter sido a
--               ORIGEM da outra, e viraram dois cadastros)
--   Cotação ── Cotação duplicada             (mesma requisição + mesmo
--               fornecedor, duas propostas vivas — trabalho repetido, não
--               comparação: comparação é fornecedores DIFERENTES)
--   Pedido  ── Fornecedor trocado            (pedido aponta pra fornecedor
--               diferente da cotação aprovada que o gerou)
--   Recebimento ── Recebido acima do pedido   (soma dos recebimentos do
--               pedido passa da quantidade pedida — a trigger da migr. 489
--               calcula status pelo saldo, mas não recusa o excesso)
--   Recebimento ── Recebimento em duplicidade (mesmo pedido, mesma
--               quantidade, dois registros a menos de 5 minutos — a
--               assinatura clássica do duplo-clique com a rede lenta)
--   (novo bloco) Confirmação de produto de outra unidade — a movimentação de
--               estoque do recebimento aponta pra um produto cujo catálogo é
--               de OUTRA filial. Não devia ser possível pela RLS, mas é
--               exatamente o tipo de coisa que esta função existe para
--               confirmar que não está acontecendo.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.auditar_fluxo_compras(
  p_desde     timestamptz DEFAULT NULL,
  p_ate       timestamptz DEFAULT NULL,
  p_filial    text        DEFAULT NULL,
  p_sessao_id uuid        DEFAULT NULL
)
RETURNS TABLE (
  etapa       text,
  documento   text,
  documento_id uuid,
  filial      text,
  responsavel text,
  problema    text,
  detalhe     text,
  gravidade   text,
  ocorrido_em timestamptz
)
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
    RAISE EXCEPTION 'Apenas o professor (admin) pode auditar o fluxo da turma.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_sessao_id IS NOT NULL THEN
    SELECT s.iniciada_em, COALESCE(s.encerrada_em, now())
      INTO v_de, v_ate
      FROM public.aula_sessoes s WHERE s.id = p_sessao_id;
    IF v_de IS NULL THEN
      RAISE EXCEPTION 'Sessão de aula % não encontrada.', p_sessao_id USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_de  := COALESCE(p_desde, now() - interval '24 hours');
    v_ate := COALESCE(p_ate, now());
  END IF;

  RETURN QUERY

  -- ── REQUISIÇÃO ────────────────────────────────────────────────────────────
  SELECT 'Requisição', COALESCE(r.numero, left(r.id::text, 8)), r.id, r.filial,
         COALESCE(p.nome, r.solicitante, '—'),
         v.problema, v.detalhe, v.gravidade, r.created_at
    FROM public.requisicoes r
    LEFT JOIN public.user_profiles p ON p.id = r.criado_por
    CROSS JOIN LATERAL (VALUES
      ('Sem justificativa',
       'Compra eventual precisa dizer por que a empresa precisa do item.',
       'alta',
       COALESCE(r.tipo_requisicao, 'Eventual') = 'Eventual'
         AND COALESCE(trim(r.justificativa), '') = ''),
      ('Sem data de necessidade',
       'Ninguém sabe para quando o item é preciso — Compras prioriza no escuro.',
       'media', r.data_necessidade IS NULL),
      ('Sem centro de custo',
       'A despesa não tem onde pousar no DRE.',
       'media', COALESCE(trim(r.centro_custo), '') = ''),
      ('Unidade inválida',
       'Unidade "' || COALESCE(r.unidade, '(vazia)') || '" fora da régua do catálogo.',
       'media',
       COALESCE(r.unidade, '') NOT IN ('UN','KG','L','M','M²','M³','CX','PC','PCT','SV')),
      ('Quantidade inválida',
       'Quantidade zerada ou negativa.',
       'alta', COALESCE(r.qtd, 0) <= 0),
      ('Descrição vaga',
       'Item descrito com menos de 3 caracteres.',
       'alta', length(trim(COALESCE(r.item, ''))) < 3)
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(r.ativo, true)
     AND r.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR r.filial = p_filial)

  UNION ALL

  -- ── COTAÇÃO ───────────────────────────────────────────────────────────────
  SELECT 'Cotação', COALESCE(c.numero, left(c.id::text, 8)), c.id, c.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, c.created_at
    FROM public.cotacoes c
    LEFT JOIN public.user_profiles p ON p.id = c.criado_por
    CROSS JOIN LATERAL (VALUES
      ('Sem fornecedor', 'Cotação sem fornecedor não é cotação.', 'alta',
       c.fornecedor_id IS NULL),
      ('Sem prazo de entrega', 'Prazo em branco — não dá para cobrar atraso depois.', 'media',
       c.prazo_entrega IS NULL),
      ('Valor zerado', 'Cotação sem valor.', 'alta',
       COALESCE(c.valor_total, 0) <= 0),
      -- NOVO (534): duas propostas vivas do MESMO fornecedor pra mesma
      -- requisição não é comparação de preço — é trabalho repetido. A
      -- trava da migr. 537 evita isto daqui pra frente; esta regra pega o
      -- que já aconteceu.
      ('Cotação duplicada',
       'Já existe outra cotação viva desta requisição com o mesmo fornecedor.',
       'media',
       c.requisicao_id IS NOT NULL AND c.fornecedor_id IS NOT NULL
         AND c.status <> 'Cancelado'
         AND EXISTS (
           SELECT 1 FROM public.cotacoes c2
            WHERE c2.id <> c.id AND COALESCE(c2.ativo, true)
              AND c2.status <> 'Cancelado'
              AND c2.requisicao_id = c.requisicao_id
              AND c2.fornecedor_id = c.fornecedor_id))
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(c.ativo, true)
     AND c.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR c.filial = p_filial)

  UNION ALL

  -- Requisição que virou pedido com uma cotação só: não houve comparação. Não
  -- é erro de preenchimento, é decisão sem alternativa — o professor julga.
  SELECT 'Cotação', COALESCE(r.numero, left(r.id::text, 8)), r.id, r.filial,
         COALESCE(p.nome, r.solicitante, '—'),
         'Cotação única',
         'A requisição foi adiante com ' || cnt.n || ' cotação — sem comparar preço.',
         'baixa', r.created_at
    FROM public.requisicoes r
    LEFT JOIN public.user_profiles p ON p.id = r.criado_por
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM public.cotacoes c
       WHERE c.requisicao_id = r.id AND COALESCE(c.ativo, true)
    ) cnt
   WHERE cnt.n = 1
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Atendida', 'Aprovado')
     AND r.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR r.filial = p_filial)

  UNION ALL

  -- ── PEDIDO ────────────────────────────────────────────────────────────────
  SELECT 'Pedido', COALESCE(pe.numero, left(pe.id::text, 8)), pe.id, pe.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, pe.created_at
    FROM public.pedidos pe
    LEFT JOIN public.user_profiles p ON p.id = pe.criado_por
    LEFT JOIN public.cotacoes c ON c.id = pe.cotacao_id
    CROSS JOIN LATERAL (VALUES
      ('Pedido sem cotação',
       'Etapa pulada: o pedido nasceu sem cotação vinculada.', 'alta',
       pe.cotacao_id IS NULL),
      ('Valor diferente da cotação',
       'Pedido R$ ' || to_char(COALESCE(pe.valor_total,0), 'FM999G999G990D00') ||
       ' contra cotação R$ ' || to_char(COALESCE(c.valor_total,0), 'FM999G999G990D00') || '.',
       'alta',
       c.id IS NOT NULL AND abs(COALESCE(pe.valor_total,0) - COALESCE(c.valor_total,0)) > 0.01),
      ('Sem prazo de entrega', 'Pedido sem prazo — a cobrança de atraso fica sem régua.', 'media',
       pe.prazo_entrega IS NULL),
      -- NOVO (534): o pedido nasce da cotação aprovada (`gerar_pedido_de_cotacao`,
      -- migr. 480) com o MESMO fornecedor dela — se estão diferentes, alguém
      -- editou um dos dois por fora do fluxo normal.
      ('Fornecedor trocado',
       'Pedido usa fornecedor diferente da cotação aprovada que o gerou.', 'media',
       c.id IS NOT NULL AND c.fornecedor_id IS NOT NULL
         AND pe.fornecedor_id IS DISTINCT FROM c.fornecedor_id)
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(pe.ativo, true)
     AND pe.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR pe.filial = p_filial)

  UNION ALL

  -- ── RECEBIMENTO ───────────────────────────────────────────────────────────
  SELECT 'Recebimento', left(rec.id::text, 8), rec.id, rec.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, rec.created_at
    FROM public.recebimentos rec
    LEFT JOIN public.user_profiles p ON p.id = rec.criado_por
    LEFT JOIN public.pedidos pe ON pe.id = rec.pedido_id
    CROSS JOIN LATERAL (VALUES
      ('Quantidade divergente sem observação',
       'Recebeu ' || COALESCE(rec.qtd_recebida, 0) || ' de ' || COALESCE(pe.item_qtd, 0) ||
       ' pedidos, e não escreveu o porquê.',
       'alta',
       pe.id IS NOT NULL
         AND COALESCE(rec.qtd_recebida, 0) <> COALESCE(pe.item_qtd, 0)
         AND COALESCE(trim(rec.observacao), '') = ''),
      ('Quantidade inválida', 'Quantidade recebida zerada ou negativa.', 'alta',
       COALESCE(rec.qtd_recebida, 0) <= 0),
      ('Recebimento sem pedido', 'Etapa pulada: recebimento sem pedido vinculado.', 'alta',
       rec.pedido_id IS NULL),
      -- NOVO (534): soma dos recebimentos do pedido passou da quantidade
      -- pedida. A trigger `fn_recebimento_status_pelo_saldo` (migr. 489)
      -- fecha o status pelo saldo, mas não RECUSA o excesso — só o vê depois.
      -- Reporta uma vez só (no recebimento mais recente do pedido), senão o
      -- mesmo excesso aparece uma vez por linha de recebimento.
      ('Recebido acima do pedido',
       'A soma dos recebimentos deste pedido passa da quantidade pedida.', 'alta',
       pe.id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.recebimentos r2
                           WHERE r2.pedido_id = rec.pedido_id AND COALESCE(r2.ativo, true)
                             AND r2.created_at > rec.created_at)
         AND (SELECT COALESCE(SUM(r3.qtd_recebida), 0) FROM public.recebimentos r3
               WHERE r3.pedido_id = rec.pedido_id AND COALESCE(r3.ativo, true))
             > COALESCE(pe.item_qtd, 0)),
      -- NOVO (534): mesmo pedido, mesma quantidade, dois registros a menos de
      -- 5 minutos — a assinatura do duplo-clique com a rede lenta.
      ('Recebimento em duplicidade',
       'Outro recebimento deste pedido, mesma quantidade, poucos minutos depois.', 'alta',
       EXISTS (SELECT 1 FROM public.recebimentos r4
                WHERE r4.id <> rec.id AND r4.pedido_id = rec.pedido_id
                  AND COALESCE(r4.ativo, true)
                  AND r4.qtd_recebida = rec.qtd_recebida
                  AND abs(extract(epoch FROM r4.created_at - rec.created_at)) < 300))
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(rec.ativo, true)
     AND rec.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR rec.filial = p_filial)

  UNION ALL

  -- ── PRODUTO ───────────────────────────────────────────────────────────────
  SELECT 'Produto', COALESCE(NULLIF(trim(pr.codigo), ''), left(pr.id::text, 8)), pr.id, pr.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, pr.created_at
    FROM public.produtos pr
    LEFT JOIN public.user_profiles p ON p.id = pr.criado_por
    CROSS JOIN LATERAL (VALUES
      ('Sem código', 'Produto cadastrado sem código.', 'alta',
       COALESCE(trim(pr.codigo), '') = ''),
      ('Código repetido na filial',
       'Já existe outro produto ativo com este código nesta unidade.', 'alta',
       COALESCE(trim(pr.codigo), '') <> '' AND EXISTS (
         SELECT 1 FROM public.produtos o
          WHERE o.id <> pr.id AND COALESCE(o.ativo, true)
            AND trim(o.codigo) = trim(pr.codigo)
            AND o.filial IS NOT DISTINCT FROM pr.filial)),
      ('Sem preço', 'Preço zerado — o PDV vende de graça.', 'alta',
       COALESCE(pr.preco, 0) <= 0),
      ('Unidade inválida',
       'Unidade "' || COALESCE(pr.unidade, '(vazia)') || '" fora da régua do catálogo.', 'media',
       COALESCE(pr.unidade, '') NOT IN ('UN','KG','L','M','M²','M³','CX','PC','PCT')),
      ('Sem categoria', 'Produto sem categoria — some dos filtros e dos relatórios.', 'baixa',
       pr.categoria IS NULL AND pr.categoria_id IS NULL),
      ('Nome muito curto', 'Nome com menos de 3 caracteres.', 'alta',
       length(trim(COALESCE(pr.nome, ''))) < 3),
      -- O atalho clássico: cadastrar direto em Produtos sem passar pelo fluxo.
      ('Cadastrado fora do fluxo',
       'Nenhum pedido aponta para este produto — não veio de requisição.',
       'media',
       NOT EXISTS (SELECT 1 FROM public.pedidos pd WHERE pd.produto_id = pr.id)
       -- Só acusa quando houve compra no período: numa aula cujo tema é montar
       -- catálogo, cadastrar produto direto é o exercício, não o atalho.
       AND EXISTS (SELECT 1 FROM public.pedidos pd2
                    WHERE pd2.created_at BETWEEN v_de AND v_ate
                      AND (p_filial IS NULL OR pd2.filial = p_filial))),
      -- NOVO (534): "1 produto cadastrado 2 vezes" — o caso que motivou esta
      -- migração. Match EXATO (lower+trim), não fuzzy: "Camiseta P" e
      -- "Camiseta G" da grade de variantes (migr. 445) têm similaridade alta
      -- e são produtos DIFERENTES — fuzzy aqui vira ruído. Comparação
      -- aproximada de nome já existe na camada 2 (migr. 472), com contexto.
      ('Nome duplicado no catálogo',
       'Já existe outro produto ativo com este nome nesta unidade.', 'alta',
       length(trim(COALESCE(pr.nome, ''))) > 0 AND EXISTS (
         SELECT 1 FROM public.produtos o2
          WHERE o2.id <> pr.id AND COALESCE(o2.ativo, true)
            AND o2.filial IS NOT DISTINCT FROM pr.filial
            AND lower(trim(o2.nome)) = lower(trim(pr.nome)))),
      -- NOVO (534): o índice único da migr. 443 tem `WHERE ean IS NOT NULL` —
      -- dois cadastros com EAN em branco não colidem nele e escapam.
      ('EAN repetido na filial',
       'Já existe outro produto ativo com este código de barras nesta unidade.', 'alta',
       COALESCE(trim(pr.ean), '') <> '' AND EXISTS (
         SELECT 1 FROM public.produtos o3
          WHERE o3.id <> pr.id AND COALESCE(o3.ativo, true)
            AND o3.filial IS NOT DISTINCT FROM pr.filial
            AND trim(o3.ean) = trim(pr.ean))),
      -- NOVO (534): duas requisições EVENTUAIS vivas apontando pro mesmo
      -- produto é sinal de que uma delas devia ter sido a ORIGEM da outra (o
      -- vínculo da migr. 494) e, em vez disso, geraram dois cadastros.
      --
      -- O filtro por 'Eventual' é o que impede a regra de mentir: na
      -- REPOSIÇÃO o mesmo `produto_id` é reusado a cada compra, de propósito
      -- (migr. 358) — repor arroz três vezes gera três requisições apontando
      -- para o mesmo cadastro, e isso é o fluxo funcionando, não duplicidade.
      -- Sem este filtro, todo item reposto mais de uma vez viraria achado.
      ('Vinculado a mais de uma requisição',
       'Mais de uma compra eventual aponta para este produto — provável duplicidade de cadastro.',
       'media',
       (SELECT count(*) FROM public.requisicoes rq
         WHERE rq.produto_id = pr.id AND COALESCE(rq.ativo, true)
           AND COALESCE(rq.tipo_requisicao, 'Eventual') = 'Eventual') > 1)
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(pr.ativo, true)
     AND pr.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR pr.filial = p_filial)

  UNION ALL

  -- ── TRILHA: decisão rápida demais ─────────────────────────────────────────
  --
  -- Aprovar 20 segundos depois de o documento nascer não é agilidade: é não ter
  -- lido. Só a trilha sabe disso, e ela existe desde a migr. 331.
  SELECT 'Aprovação', h.entidade || ' ' || UPPER(right(h.entidade_id::text, 6)), h.entidade_id,
         h.filial, COALESCE(h.ator_nome, '—'),
         'Aprovação sem leitura',
         'Aprovado ' || round(extract(epoch FROM h.created_at - nasc.quando))::text ||
         's depois de criado.',
         'media', h.created_at
    FROM public.historico_operacoes h
    JOIN LATERAL (
      SELECT min(h2.created_at) AS quando FROM public.historico_operacoes h2
       WHERE h2.entidade = h.entidade AND h2.entidade_id = h.entidade_id
         AND h2.evento = 'Criado'
    ) nasc ON true
   WHERE h.evento = 'Status'
     AND h.para IN ('Aprovado', 'Aprovada')
     AND h.entidade IN ('requisicoes', 'cotacoes', 'pedidos')
     AND h.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR h.filial = p_filial)
     AND nasc.quando IS NOT NULL
     AND h.created_at - nasc.quando < interval '30 seconds'

  UNION ALL

  -- ── CONFIRMAÇÃO: produto de outra unidade ──────────────────────────────────
  --
  -- NOVO (534). A movimentação de estoque que o "Confirmar" do Recebimento
  -- grava (migr. 417) aponta para um produto cujo CATÁLOGO é de outra filial.
  -- A RLS já deveria impedir isto (migr. 169 e afins) — esta linha existe
  -- para confirmar, com dado, que não está acontecendo, e apontar na hora se
  -- acontecer.
  SELECT 'Recebimento', left(me.id::text, 8), me.id, me.filial,
         COALESCE(p.nome, '—'),
         'Produto de outra unidade confirmado aqui',
         'Produto "' || COALESCE(prodx.nome, '—') || '" é do catálogo da ' ||
         COALESCE(prodx.filial, '?') || ', confirmado na ' || me.filial || '.',
         'alta', me.created_at
    FROM public.movimentacoes_estoque me
    LEFT JOIN public.user_profiles p ON p.id = me.criado_por
    LEFT JOIN public.produtos prodx ON prodx.id = me.produto_id
   WHERE COALESCE(me.ativo, true)
     AND me.recebimento_id IS NOT NULL
     AND prodx.filial IS NOT NULL
     -- `me.filial IS NOT NULL` explícito: sem ele, movimentação sem unidade
     -- casaria em `IS DISTINCT FROM` e viraria achado — e o `detalhe`, que
     -- concatena `me.filial`, sairia NULL (célula vazia na tela).
     AND me.filial IS NOT NULL
     AND prodx.filial IS DISTINCT FROM me.filial
     AND me.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR me.filial = p_filial)

  ORDER BY 8, 1, 9;   -- gravidade, etapa, quando
END;
$function$;

REVOKE ALL ON FUNCTION public.auditar_fluxo_compras(timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditar_fluxo_compras(timestamptz, timestamptz, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.auditar_fluxo_compras(timestamptz, timestamptz, text, uuid) IS
  'Migr. 471+534 — inconsistências objetivas do fluxo Requisição→Cadastro no período (ou na sessão de aula), incluindo duplicidade de produto/cotação/recebimento. Só role=admin. A camada de IA, se existir, recebe só os textos que esta função apontar.';

COMMIT;
