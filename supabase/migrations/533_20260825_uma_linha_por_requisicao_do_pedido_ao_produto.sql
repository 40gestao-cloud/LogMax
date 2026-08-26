-- 533 — Uma linha por requisição, do pedido ao produto na prateleira.
--
-- A Conferência (471/472) e as Pendências (477) respondem "o que está errado"
-- e "o que está parado" — mas as duas olham DOCUMENTO por documento. O
-- professor que pediu esta função não estava perdido em nenhum achado
-- solto: estava perdido tentando remontar a CADEIA. "Essa requisição de
-- detergente virou qual pedido? Chegou? Virou produto? Foi confirmado?" —
-- pergunta que hoje só se responde abrindo quatro telas e cruzando pelo
-- texto do item, porque nada na UI mostra a cadeia inteira numa linha só.
--
-- `mapa_fluxo_compras` devolve exatamente isso: uma linha por requisição,
-- com a cotação vencedora, o pedido, o recebimento, o produto e a
-- confirmação de estoque ao lado, e uma etapa computada dizendo onde a
-- cadeia está PARADA agora (se estiver). Não julga, não aponta erro de
-- preenchimento — isso é papel da 471. Só remonta o caminho.
--
-- ─── POR QUE 1 LINHA E NÃO 1 TABELA POR ETAPA ──────────────────────────────
--
-- Uma requisição pode ter várias cotações (é o normal — comparar preço), mas
-- só uma vira pedido (a `gerar_pedido_de_cotacao`, migr. 480, recusa duas
-- cotações da mesma requisição virarem pedido). Por isso a cotação que entra
-- na linha é a que TEM pedido — ou, se nenhuma tem, a mais recente viva. O
-- resto da cadeia (pedido → recebimento → produto → confirmação) já é 1:1 por
-- natureza do fluxo, então a linha nunca precisa se multiplicar.
--
-- ─── A ETAPA_ATUAL É A ETAPA MAIS FUNDA JÁ ALCANÇADA ───────────────────────
--
-- Não é o status do documento (esse já está nas colunas ao lado) — é até onde
-- a cadeia andou. Uma requisição com pedido em entrega mostra etapa_atual =
-- 'Pedido' mesmo que o pedido em si esteja com status 'Em Entrega': o que
-- importa aqui é a POSIÇÃO na esteira, não o rótulo interno de cada etapa.
--
-- E ela é CUMULATIVA — cada etapa exige a anterior. A armadilha aqui é a
-- REPOSIÇÃO: `criar_requisicoes_compra_lote` (migr. 358) grava `produto_id`
-- no próprio INSERT da requisição, porque repor é pedir mais de um item que
-- já existe no catálogo. Testar `produto_id IS NOT NULL` isoladamente faria
-- toda reposição nascer na etapa 'Produto'.
--
-- ─── PARADO_HA_HORAS SÓ EXISTE QUANDO A CADEIA NÃO TERMINOU ────────────────
--
-- Confirmado = true fecha o ciclo (é o "Confirmar" do Recebimento, que baixa
-- o estoque — migr. 417/489). Cadeia fechada não está parada em lugar nenhum,
-- então `parado_ha_horas` sai NULL — coluna vazia é sinal melhor que "0h" para
-- "não há nada para destravar aqui".
--
-- ─── QUEM PODE CHAMAR ───────────────────────────────────────────────────────
--
-- `role = 'admin'` literal — mesma régua da 471/472/477. CEO e conselheiro
-- são alunos e estão DENTRO do mapa, não na plateia.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- DROP antes do CREATE: `CREATE OR REPLACE` recusa mudar nome ou tipo de
-- coluna OUT (42P13), e esta função trocou `parado_ha interval` por
-- `parado_ha_horas numeric`. Nada depende dela além da tela da Conferência.
DROP FUNCTION IF EXISTS public.mapa_fluxo_compras(timestamptz, timestamptz, text, uuid);

CREATE OR REPLACE FUNCTION public.mapa_fluxo_compras(
  p_desde     timestamptz DEFAULT NULL,
  p_ate       timestamptz DEFAULT NULL,
  p_filial    text        DEFAULT NULL,
  p_sessao_id uuid        DEFAULT NULL
)
RETURNS TABLE (
  requisicao_id      uuid,
  requisicao_numero  text,
  filial             text,
  item               text,
  solicitante        text,
  requisicao_status  text,
  requisicao_em      timestamptz,

  cotacoes_total     integer,
  cotacao_id         uuid,
  cotacao_status     text,
  cotacao_fornecedor text,
  cotacao_em         timestamptz,

  pedido_id          uuid,
  pedido_numero      text,
  pedido_status      text,
  pedido_em          timestamptz,

  recebimento_id     uuid,
  recebimento_status text,
  recebimento_em     timestamptz,

  produto_id         uuid,
  produto_codigo     text,
  produto_nome       text,
  produto_em         timestamptz,

  confirmado         boolean,
  confirmado_em      timestamptz,

  etapa_atual        text,
  -- Horas, não `interval`: a serialização de `interval` pelo PostgREST muda
  -- de formato entre versões ("3 days 04:00:00" x ISO-8601 "P3DT4H"), e o
  -- cliente teria de adivinhar qual está recebendo. Número é número.
  parado_ha_horas    numeric
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

REVOKE ALL ON FUNCTION public.mapa_fluxo_compras(timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapa_fluxo_compras(timestamptz, timestamptz, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.mapa_fluxo_compras(timestamptz, timestamptz, text, uuid) IS
  'Uma linha por requisição com a cadeia inteira (cotação→pedido→recebimento→'
  'produto→confirmação) e onde ela está parada. Professor (admin) só. Migr. 533.';

COMMIT;
