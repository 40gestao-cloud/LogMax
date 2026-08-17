-- 439_20260817_a_fracao_morria_no_caminho_da_compra.sql
--
-- A MERCEARIA VENDE 0,350 KG E NÃO CONSEGUE COMPRAR 12,5.
--
-- A migr. 079 deu fração ao que a operação já fazia — `itens_venda.qtd` e
-- `movimentacoes_estoque.qtd` viraram numeric(15,3) para o PDV pesar no caixa.
-- A cadeia de ABASTECIMENTO ficou de fora e nunca foi revisitada. Resultado: a
-- SuperMax sabe vender meio quilo de tomate e não sabe pedir, comprar, receber,
-- devolver nem lotear meio quilo de tomate.
--
-- Onde a fração morria (levantado nos 4 bancos, idêntico nos quatro):
--
--   requisicoes.qtd                integer   pedir 12,5 KG arredonda
--   requisicoes_estoque.qtd        integer   requisição interna idem
--   pedidos.item_qtd               integer   o pedido ao fornecedor arredonda
--   recebimentos.qtd_recebida      integer   RECEBER 12,5 KG é impossível
--   devolucoes_fornecedor.qtd      integer   par quebrado: itens_devolucao.qtd
--                                            já era numeric(15,3)
--   vencimentos_estoque.qtd        integer   lote FEFO de frios não fecha (424)
--
-- E `v_pedido_saldo` fazia `::integer` explícito em quatro lugares — trocar só
-- as colunas deixaria a view arredondando o saldo do pedido de qualquer jeito.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ISTO É UM ERRO DE DINHEIRO, NÃO SÓ DE CADASTRO
--
-- `fn_custo_medio_da_entrada` (migr. 417) apura o custo unitário da compra
-- assim:
--
--     v_custo_unit := ROUND(v_valor_pedido / v_qtd_pedido, 4);
--
-- A função já declara as duas pontas como `numeric` — o defeito estava na
-- ORIGEM: `pedidos.item_qtd` chegava arredondado. Comprar 12,5 kg por R$ 100
-- gravava item_qtd = 12 e apurava R$ 8,3333/kg em vez de R$ 8,00 — 4% de custo
-- inventado, que entra na média ponderada do produto, no DRE (migr. 425/426) e
-- na margem que a turma discute em aula. `registrar_devolucao_fornecedor` usa a
-- mesma divisão para estimar o valor a abater da conta a pagar, então o erro
-- também ia para o Financeiro.
--
-- Nenhuma das duas funções precisa mudar de corpo por causa disso: bastou a
-- coluna deixar de arredondar. É o argumento de que o tipo errado na origem sai
-- mais caro que a conta errada no fim.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE CADA RPC É DERRUBADA, E NÃO SUBSTITUÍDA
--
-- Seis funções têm `integer` na ASSINATURA (ou nas colunas OUT). `CREATE OR
-- REPLACE FUNCTION` com outro tipo de argumento não substitui nada: cria uma
-- SEGUNDA função sobrecarregada. As duas passariam a existir, e o PostgREST
-- responderia PGRST203 ("could not choose the best candidate function") em toda
-- chamada — a tela quebra inteira, não em parte. `pedido_saldo` é RETURNS TABLE
-- com colunas integer: trocá-las por REPLACE dá 42P13 direto.
--
--   DROP + CREATE:  criar_requisicao_compra, corrigir_requisicao_compra,
--                   criar_requisicao_estoque, baixar_lote_vencido,
--                   registrar_devolucao_fornecedor, pedido_saldo
--   só REPLACE:     criar_requisicoes_compra_lote (assinatura é jsonb; o
--                   integer estava no corpo)
--
-- Os corpos abaixo são cópia fiel do que está no banco hoje, com as mudanças
-- de tipo e nada mais. Os grants são restaurados nominalmente — `DROP FUNCTION`
-- leva o ACL junto, e função nova nasce com EXECUTE para PUBLIC, o que
-- alcançaria `anon`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O PISO DE 1 TAMBÉM CAI
--
-- As RPCs de requisição faziam `IF p_qtd < 1 THEN p_qtd := 1`. Com fração isso
-- transforma 0,5 KG em 1 KG calado — dobrar o pedido é pior que recusá-lo. Vira
-- `<= 0`: quantidade inválida continua caindo em 1 (ou em erro, onde já era
-- erro), e 0,5 passa.
--
-- `corrigir_requisicao_compra` mantém a exceção, com a mensagem ajustada: lá o
-- valor é digitado por quem corrige, e emendar em silêncio o que o gerente vai
-- aprovar é justamente o que não se quer.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da migr. 438 (mesma frente).

BEGIN;

-- ── 0. Guarda ───────────────────────────────────────────────────────────────
--
-- A primeira versão desta migração morreu com 0A000 ("cannot alter type of a
-- column used by a view or rule") porque eu conferi dependentes de
-- `requisicoes` e esqueci das outras cinco tabelas: `v_fornecedor_desempenho`
-- (migr. 421/428) lê `devolucoes_fornecedor.qtd`. A transação rolou tudo para
-- trás, sem estado parcial — mas o erro chega sem dizer o que fazer.
--
-- A checagem abaixo é a lição virada em código: em vez de listar à mão quem eu
-- lembrei, pergunta ao catálogo QUEM depende das seis colunas e falha nominando
-- o que esta migração não sabe derrubar. Turma com uma view a mais para de
-- receber 0A000 e passa a receber o nome dela.

DO $$
DECLARE
  v_extra text;
BEGIN
  SELECT string_agg(DISTINCT dep.relname, ', ') INTO v_extra
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class dep ON dep.oid = r.ev_class
    JOIN pg_class src ON src.oid = d.refobjid
   WHERE src.relnamespace = 'public'::regnamespace
     AND src.relname IN ('requisicoes','requisicoes_estoque','pedidos',
                         'recebimentos','devolucoes_fornecedor','vencimentos_estoque')
     AND dep.relname <> src.relname
     AND dep.relname NOT IN ('v_pedido_saldo', 'v_fornecedor_desempenho');

  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'Estas views dependem das colunas de quantidade e esta migração não as recria: %. Acrescente o DROP + CREATE delas antes de rodar — sem isso o ALTER falha com 0A000.',
      v_extra USING ERRCODE = 'P0001';
  END IF;
END $$;

DO $$
DECLARE
  v_faltando text;
BEGIN
  SELECT string_agg(format('%s.%s', t, c), ', ') INTO v_faltando
    FROM (VALUES
      ('requisicoes','qtd'), ('requisicoes_estoque','qtd'), ('pedidos','item_qtd'),
      ('recebimentos','qtd_recebida'), ('devolucoes_fornecedor','qtd'),
      ('vencimentos_estoque','qtd')
    ) AS alvo(t, c)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = alvo.t AND column_name = alvo.c
   );

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'Colunas ausentes: %. Este banco divergiu do schema das outras turmas.',
      v_faltando USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ── 1. As views e a função que dependem das colunas saem primeiro ───────────
--
-- `v_fornecedor_desempenho` entrou aqui depois do 0A000: ela lê
-- `devolucoes_fornecedor.qtd` no CTE `dev`. Detalhe que a torna barata de
-- recriar — o `qtd` somado ali só aparece em `FILTER (WHERE dv.qtd IS NOT NULL)`
-- e nunca é devolvido como coluna, então a ASSINATURA da view não muda com o
-- tipo. É DROP por obrigação do Postgres, não por mudança de contrato.

DROP FUNCTION IF EXISTS public.pedido_saldo(uuid);
DROP VIEW     IF EXISTS public.v_pedido_saldo;
DROP VIEW     IF EXISTS public.v_fornecedor_desempenho;

-- ── 2. As seis colunas ──────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('requisicoes','qtd'), ('requisicoes_estoque','qtd'), ('pedidos','item_qtd'),
      ('recebimentos','qtd_recebida'), ('devolucoes_fornecedor','qtd'),
      ('vencimentos_estoque','qtd')
    ) AS alvo(t, c)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c
         AND data_type <> 'numeric'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(15,3) USING %I::numeric(15,3)',
        r.t, r.c, r.c);
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN public.requisicoes.qtd IS
  'Quantidade pedida, na unidade da coluna `unidade`. numeric(15,3) desde a migr. 439 — mercearia requisita 12,5 KG.';
COMMENT ON COLUMN public.pedidos.item_qtd IS
  'Quantidade do pedido ao fornecedor. numeric(15,3) desde a migr. 439: é o divisor do custo unitário em fn_custo_medio_da_entrada, e arredondado inventava custo.';
COMMENT ON COLUMN public.recebimentos.qtd_recebida IS
  'Quantidade que entrou de fato, na unidade do produto. numeric(15,3) desde a migr. 439.';
COMMENT ON COLUMN public.vencimentos_estoque.qtd IS
  'Saldo do lote, na unidade do produto. numeric(15,3) desde a migr. 439 — frios e laticínios são loteados a peso.';

-- ── 3. v_pedido_saldo sem os casts para integer ─────────────────────────────
--
-- `security_invoker` vai declarado dentro do CREATE: a view lê `pedidos` e
-- `recebimentos`, e sem isso a RLS das duas passaria a ser avaliada como o dono
-- da view em vez de como quem consulta.
--
-- Os grants voltam com uma diferença deliberada: `anon` tinha INSERT/UPDATE
-- herdados do GRANT ALL default do schema public. Numa view com GROUP BY eles
-- são inertes (não é auto-updatable), e restaurá-los seria copiar um erro de
-- lugar. `anon` fica só com SELECT, que é o que existia de fato.

CREATE VIEW public.v_pedido_saldo
WITH (security_invoker = true) AS
  SELECT p.id AS pedido_id,
         p.filial,
         COALESCE(p.item_qtd, 0) AS qtd_pedida,
         COALESCE(sum(r.qtd_recebida) FILTER (WHERE r.ativo = true), 0) AS qtd_recebida_total,
         GREATEST(
           COALESCE(p.item_qtd, 0)
           - COALESCE(sum(r.qtd_recebida) FILTER (WHERE r.ativo = true), 0)
           + COALESCE((SELECT sum(d.qtd) FROM public.devolucoes_fornecedor d
                        WHERE d.pedido_id = p.id AND d.ativo AND d.reenvio_esperado), 0),
           0) AS qtd_saldo,
         COALESCE((SELECT sum(d.qtd) FROM public.devolucoes_fornecedor d
                    WHERE d.pedido_id = p.id AND d.ativo), 0) AS qtd_devolvida,
         COALESCE((SELECT sum(d.qtd) FROM public.devolucoes_fornecedor d
                    WHERE d.pedido_id = p.id AND d.ativo AND d.reenvio_esperado), 0) AS qtd_devolvida_reenvio
    FROM public.pedidos p
    LEFT JOIN public.recebimentos r ON r.pedido_id = p.id
   WHERE p.ativo = true
   GROUP BY p.id, p.filial, p.item_qtd;

COMMENT ON VIEW public.v_pedido_saldo IS
  'Saldo por pedido: pedido − recebido + devolvido com reenvio esperado. Tudo numeric(15,3) desde a migr. 439 — os ::integer daqui arredondavam o saldo mesmo com as colunas certas.';

GRANT SELECT                 ON public.v_pedido_saldo TO anon;
GRANT SELECT, INSERT, UPDATE ON public.v_pedido_saldo TO authenticated;
GRANT ALL                    ON public.v_pedido_saldo TO service_role;

-- ── 3b. v_fornecedor_desempenho de volta, idêntica ──────────────────────────
--
-- Cópia fiel da definição canônica da migr. 428 (que sucedeu a 421). Nenhuma
-- linha muda de sentido: só precisava sair do caminho do ALTER. `security_invoker`
-- declarado dentro do CREATE — sem isso a view passaria a ler `pedidos` como
-- dona e a RLS de filial deixaria de valer para quem consulta.

CREATE VIEW public.v_fornecedor_desempenho
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    p.id AS pedido_id,
    p.fornecedor_id,
    p.filial,
    p.status,
    p.valor_total,
    p.prazo_entrega,
    p.recebido_em,
    (p.status = 'Recebido'
      AND p.prazo_entrega IS NOT NULL
      AND p.recebido_em   IS NOT NULL) AS avaliavel,
    (p.status NOT IN ('Recebido', 'Cancelado')
      AND p.prazo_entrega IS NOT NULL
      AND p.prazo_entrega < public.acre_today()) AS atrasado_agora
    FROM public.pedidos p
   WHERE p.ativo = true
     AND p.fornecedor_id IS NOT NULL
),
dev AS (
  SELECT d.pedido_id,
         SUM(d.qtd)            AS qtd,
         SUM(d.valor_estimado) AS valor
    FROM public.devolucoes_fornecedor d
   WHERE d.ativo
   GROUP BY d.pedido_id
)
SELECT
  b.fornecedor_id,
  b.filial,
  COUNT(*) FILTER (WHERE b.avaliavel)::integer AS entregas,
  COUNT(*) FILTER (WHERE b.avaliavel AND b.recebido_em <= b.prazo_entrega)::integer AS entregas_no_prazo,
  CASE WHEN COUNT(*) FILTER (WHERE b.avaliavel) > 0
       THEN ROUND(
              100.0 * COUNT(*) FILTER (WHERE b.avaliavel AND b.recebido_em <= b.prazo_entrega)
              / COUNT(*) FILTER (WHERE b.avaliavel), 0)
  END AS pontualidade_pct,
  CASE WHEN COUNT(*) FILTER (WHERE b.avaliavel) > 0
       THEN ROUND(
              AVG(GREATEST(b.recebido_em - b.prazo_entrega, 0))
                FILTER (WHERE b.avaliavel), 1)
  END AS atraso_medio_dias,
  COALESCE(MAX(GREATEST(b.recebido_em - b.prazo_entrega, 0))
             FILTER (WHERE b.avaliavel), 0)::integer AS pior_atraso_dias,
  COUNT(*) FILTER (WHERE b.atrasado_agora)::integer AS em_atraso_agora,
  COUNT(*) FILTER (WHERE b.status NOT IN ('Recebido', 'Cancelado'))::integer AS pedidos_em_aberto,
  MAX(b.recebido_em) FILTER (WHERE b.avaliavel) AS ultima_entrega_em,
  COALESCE(SUM(b.valor_total) FILTER (WHERE b.status = 'Recebido'), 0)::numeric(15,2) AS total_comprado,
  -- Qualidade (migr. 428): pontualidade e devolução são defeitos diferentes.
  -- Quem entrega no prazo e manda avariado tinha selo verde até aqui.
  COUNT(DISTINCT b.pedido_id) FILTER (WHERE dv.qtd IS NOT NULL)::integer AS pedidos_com_devolucao,
  COALESCE(SUM(dv.valor), 0)::numeric(15,2) AS devolucoes_valor,
  CASE WHEN COUNT(*) FILTER (WHERE b.status = 'Recebido') > 0
       THEN ROUND(
              100.0 * COUNT(DISTINCT b.pedido_id) FILTER (WHERE dv.qtd IS NOT NULL)
              / COUNT(*) FILTER (WHERE b.status = 'Recebido'), 0)
  END AS taxa_devolucao_pct
  FROM base b
  LEFT JOIN dev dv ON dv.pedido_id = b.pedido_id
 GROUP BY b.fornecedor_id, b.filial;

COMMENT ON VIEW public.v_fornecedor_desempenho IS
  'Pontualidade e volume por fornecedor, a partir de pedidos.prazo_entrega x pedidos.recebido_em (migr. 418). Fornecedor sem entrega fechada não aparece — é "sem histórico", não "ruim".';

-- Mesma decisão do v_pedido_saldo: `anon` volta só com SELECT. INSERT/UPDATE
-- vinham do GRANT ALL default do schema e são inertes numa view com GROUP BY.
GRANT SELECT                 ON public.v_fornecedor_desempenho TO anon;
GRANT SELECT, INSERT, UPDATE ON public.v_fornecedor_desempenho TO authenticated;
GRANT ALL                    ON public.v_fornecedor_desempenho TO service_role;

-- ── 4. pedido_saldo — colunas OUT em numeric ────────────────────────────────

CREATE FUNCTION public.pedido_saldo(p_pedido_id uuid)
RETURNS TABLE(pedido_id uuid, qtd_pedida numeric, qtd_recebida_total numeric, qtd_saldo numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT v.pedido_id, v.qtd_pedida, v.qtd_recebida_total, v.qtd_saldo
    FROM public.v_pedido_saldo v
    WHERE v.pedido_id = p_pedido_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.pedido_saldo(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.pedido_saldo(uuid) TO authenticated, service_role;

-- ── 5. Requisição de compra (item livre) ────────────────────────────────────

DROP FUNCTION IF EXISTS public.criar_requisicao_compra(text, text, integer, text, text, text, text, date, text);

CREATE FUNCTION public.criar_requisicao_compra(
  p_item text,
  p_solicitante text,
  p_qtd numeric DEFAULT 1,
  p_urgencia text DEFAULT 'Normal'::text,
  p_centro_custo text DEFAULT NULL::text,
  p_filial text DEFAULT 'SuperMax'::text,
  p_justificativa text DEFAULT NULL::text,
  p_data_necessidade date DEFAULT NULL::date,
  p_unidade text DEFAULT 'UN'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req    requisicoes;
  v_nome   text;
  v_setor  text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Descreva o item solicitado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_justificativa IS NULL OR length(trim(p_justificativa)) < 10 THEN
    RAISE EXCEPTION 'A justificativa é obrigatória — é o que o gerente lê para decidir.'
      USING ERRCODE = 'P0001';
  END IF;
  -- Era `< 1`, que transformava 0,5 KG em 1 KG sem avisar.
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    p_qtd := 1;
  END IF;
  IF p_urgencia IS NULL OR p_urgencia NOT IN ('Normal','Alta','Urgente') THEN
    p_urgencia := 'Normal';
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;
  IF p_data_necessidade IS NOT NULL AND p_data_necessidade < public.acre_today() THEN
    RAISE EXCEPTION 'A data de necessidade não pode estar no passado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.auth_pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.requisicoes (
    item, solicitante, setor_solicitante, qtd, unidade, urgencia,
    centro_custo, justificativa, data_necessidade, status, data, filial,
    tipo_requisicao
  ) VALUES (
    trim(p_item),
    COALESCE(v_nome, trim(p_solicitante)),
    v_setor,
    p_qtd,
    COALESCE(NULLIF(upper(btrim(COALESCE(p_unidade,''))), ''), 'UN'),
    p_urgencia,
    NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
    trim(p_justificativa),
    p_data_necessidade,
    'Pendente', public.acre_today(), p_filial,
    'Eventual'
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.criar_requisicao_compra(text, text, numeric, text, text, text, text, date, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.criar_requisicao_compra(text, text, numeric, text, text, text, text, date, text) TO authenticated, service_role;

-- ── 6. Correção da requisição pelo Compras/gerente ─────────────────────────

DROP FUNCTION IF EXISTS public.corrigir_requisicao_compra(uuid, text, integer, text, text);

CREATE FUNCTION public.corrigir_requisicao_compra(
  p_id uuid,
  p_item text,
  p_qtd numeric,
  p_urgencia text DEFAULT NULL::text,
  p_centro_custo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req      requisicoes;
  v_reabre   boolean := false;
  v_cot      text;
  v_nome     text;
  v_ap_id    uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Descreva o item solicitado.' USING ERRCODE = 'P0001';
  END IF;
  -- Continua erro, não emenda: aqui o número foi digitado por quem corrige, e o
  -- gerente vai reaprovar exatamente o que estiver escrito.
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesma régua da policy compras_update: quem executa a compra, o gerente da
  -- filial, ou a Matriz.
  IF NOT (public.auth_is_admin()
          OR public.auth_in_setor('compras')
          OR public.auth_gerente_da(v_req.filial)) THEN
    RAISE EXCEPTION 'Só Compras ou o gerente da filial corrige a requisição.'
      USING ERRCODE = '42501';
  END IF;

  IF v_req.status NOT IN ('Pendente', 'Aprovado') THEN
    RAISE EXCEPTION
      'Requisição % não pode ser corrigida: já está %. Depois de virar pedido a correção é no pedido; negada, quem reabre é o setor solicitante.',
      v_req.item, v_req.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Só item e quantidade são a decisão do gerente. Trocar o centro de custo ou
  -- a urgência não muda o que ele autorizou comprar.
  v_reabre := v_req.status = 'Aprovado'
              AND (trim(p_item) IS DISTINCT FROM v_req.item
                   OR p_qtd IS DISTINCT FROM v_req.qtd);

  IF v_reabre THEN
    -- Cotação viva nasceu do item antigo. Reabrir por baixo dela deixaria o
    -- Financeiro decidindo o preço de uma coisa que já não é a pedida.
    SELECT c.id::text INTO v_cot
      FROM public.cotacoes c
     WHERE c.requisicao_id = v_req.id
       AND COALESCE(c.ativo, true)
       AND c.status IN ('Aguardando Financeiro', 'Aprovado')
     LIMIT 1;

    IF v_cot IS NOT NULL THEN
      RAISE EXCEPTION
        'Já existe cotação em andamento para esta requisição. Cancele a cotação antes de mudar o item ou a quantidade.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.requisicoes
     SET item         = trim(p_item),
         qtd          = p_qtd,
         urgencia     = COALESCE(NULLIF(trim(COALESCE(p_urgencia, '')), ''), urgencia),
         centro_custo = NULLIF(trim(COALESCE(p_centro_custo, '')), ''),
         status       = CASE WHEN v_reabre THEN 'Pendente' ELSE status END
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  IF v_reabre THEN
    SELECT id INTO v_ap_id FROM public.aprovacoes_compras
     WHERE requisicao_id = v_req.id
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;

    IF v_ap_id IS NULL THEN
      -- Requisição sem linha de aprovação não tem tela onde ser decidida.
      -- Acontece com registro vindo de seed ou importação; criar a linha aqui
      -- é mais barato que deixá-la presa em 'Pendente' para sempre.
      INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
      VALUES (v_req.id, 'Pendente', v_req.filial);
    ELSE
      UPDATE public.aprovacoes_compras
         SET status     = 'Pendente',
             aprovador  = NULL,
             observacao = format('Reaberta: %s corrigiu o item ou a quantidade após a aprovação.',
                                 COALESCE(v_nome, 'Compras'))
       WHERE id = v_ap_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('requisicao', to_jsonb(v_req), 'reaberta', v_reabre);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corrigir_requisicao_compra(uuid, text, numeric, text, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.corrigir_requisicao_compra(uuid, text, numeric, text, text) TO authenticated, service_role;

-- ── 7. Requisição de material ao almoxarifado ──────────────────────────────

DROP FUNCTION IF EXISTS public.criar_requisicao_estoque(uuid, text, integer, text, text);

CREATE FUNCTION public.criar_requisicao_estoque(
  p_produto_id uuid,
  p_solicitante text,
  p_qtd numeric DEFAULT 1,
  p_destino text DEFAULT NULL::text,
  p_filial text DEFAULT 'SuperMax'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req   requisicoes_estoque;
  v_nome  text;
  v_setor text;
BEGIN
  -- Era _assert_rpc('estoque','logistica'). Material do almoxarifado é pedido
  -- por quem precisa dele — igual à requisição de compra (migr. 283).
  PERFORM public._assert_rpc();

  IF p_produto_id IS NULL THEN
    RAISE EXCEPTION 'Produto é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = p_produto_id) THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    p_qtd := 1;
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;

  IF NOT public.auth_pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.requisicoes_estoque (
    produto_id, solicitante, setor_solicitante, qtd, destino, status, filial
  ) VALUES (
    p_produto_id,
    COALESCE(v_nome, trim(p_solicitante)),
    v_setor,
    p_qtd,
    NULLIF(trim(COALESCE(p_destino,'')), ''),
    'Pendente', p_filial
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.criar_requisicao_estoque(uuid, text, numeric, text, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.criar_requisicao_estoque(uuid, text, numeric, text, text) TO authenticated, service_role;

-- ── 8. Requisição em lote (assinatura não muda: o integer estava no corpo) ──
--
-- `(v_elem->>'qtd')::integer` não arredondava: com "12.5" no jsonb, o cast
-- ESTOURA ("invalid input syntax for type integer"). O front nunca mandou
-- fração porque o formulário não deixava digitar — o dia em que deixasse, a
-- requisição em lote quebraria em vez de arredondar.

CREATE OR REPLACE FUNCTION public.criar_requisicoes_compra_lote(
  p_itens jsonb,
  p_solicitante text,
  p_urgencia text DEFAULT 'Normal'::text,
  p_centro_custo text DEFAULT NULL::text,
  p_filial text DEFAULT 'SuperMax'::text,
  p_justificativa text DEFAULT NULL::text,
  p_data_necessidade date DEFAULT NULL::date,
  p_tipo_requisicao text DEFAULT 'Eventual'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_elem      jsonb;
  v_req       requisicoes;
  v_prod      produtos;
  v_resultado jsonb := '[]'::jsonb;
  v_qtd       numeric;
  v_texto     text;
  v_unidade   text;
  v_just_item text;
  v_just_cab  text;
  v_nome      text;
  v_setor     text;
  v_reposicao boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo_requisicao IS NULL OR p_tipo_requisicao NOT IN ('Reposição','Eventual') THEN
    RAISE EXCEPTION 'Tipo de requisição inválido: %. Use Reposição ou Eventual.', p_tipo_requisicao
      USING ERRCODE = 'P0001';
  END IF;
  v_reposicao := p_tipo_requisicao = 'Reposição';

  v_just_cab := NULLIF(trim(COALESCE(p_justificativa, '')), '');
  IF v_just_cab IS NOT NULL AND length(v_just_cab) < 10 THEN
    RAISE EXCEPTION 'A justificativa é obrigatória — é o que o gerente lê para decidir.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_urgencia IS NULL OR p_urgencia NOT IN ('Normal','Alta','Urgente') THEN
    p_urgencia := 'Normal';
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;
  IF p_data_necessidade IS NOT NULL AND p_data_necessidade < public.acre_today() THEN
    RAISE EXCEPTION 'A data de necessidade não pode estar no passado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.auth_pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    -- Vírgula decimal chega de teclado pt-BR se o front escapar; `numeric` não
    -- aceita, e o erro sairia como "invalid input syntax" sem dizer qual item.
    v_qtd := COALESCE(NULLIF(replace(btrim(COALESCE(v_elem->>'qtd', '')), ',', '.'), '')::numeric, 1);
    IF v_qtd <= 0 THEN v_qtd := 1; END IF;

    IF v_reposicao THEN
      IF (v_elem->>'produto_id') IS NULL THEN
        RAISE EXCEPTION 'Reposição precisa de um produto do catálogo. Para item que não existe no cadastro, use Compra eventual.'
          USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_prod FROM public.produtos
       WHERE id = (v_elem->>'produto_id')::uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado no catálogo.' USING ERRCODE = 'P0002';
      END IF;
      IF v_prod.filial IS NOT NULL AND v_prod.filial <> p_filial THEN
        RAISE EXCEPTION 'O produto "%" é de outra unidade.', v_prod.nome USING ERRCODE = '42501';
      END IF;

      v_texto     := v_prod.nome;
      v_unidade   := COALESCE(NULLIF(upper(btrim(COALESCE(v_prod.unidade,''))), ''), 'UN');
      v_just_item := NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), '');

      INSERT INTO public.requisicoes (
        item, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao, produto_id, saldo_no_pedido, minimo_no_pedido
      ) VALUES (
        v_texto,
        COALESCE(v_nome, trim(p_solicitante)),
        v_setor, v_qtd, v_unidade, p_urgencia,
        NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
        v_just_item, p_data_necessidade,
        'Pendente', public.acre_today(), p_filial,
        'Reposição', v_prod.id, v_prod.estoque, v_prod.estoque_minimo
      )
      RETURNING * INTO v_req;

    ELSE
      v_texto := trim(COALESCE(v_elem->>'item', ''));
      IF v_texto = '' THEN
        RAISE EXCEPTION 'Todo item da requisição precisa de uma descrição.' USING ERRCODE = 'P0001';
      END IF;
      -- A grafia é do banco, não do cliente: era daqui que vinha o 'un'.
      v_unidade := COALESCE(NULLIF(upper(btrim(COALESCE(v_elem->>'unidade',''))), ''), 'UN');

      v_just_item := COALESCE(NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), ''), v_just_cab);
      IF v_just_item IS NULL OR length(v_just_item) < 10 THEN
        RAISE EXCEPTION 'Falta justificar o item "%" — explique por que a empresa precisa dele.', v_texto
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.requisicoes (
        item, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao
      ) VALUES (
        v_texto,
        COALESCE(v_nome, trim(p_solicitante)),
        v_setor, v_qtd, v_unidade, p_urgencia,
        NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
        v_just_item, p_data_necessidade,
        'Pendente', public.acre_today(), p_filial,
        'Eventual'
      )
      RETURNING * INTO v_req;
    END IF;

    INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
    VALUES (v_req.id, 'Pendente', p_filial);

    v_resultado := v_resultado || to_jsonb(v_req);
  END LOOP;

  RETURN v_resultado;
END;
$function$;

-- ── 9. Baixa de lote vencido ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.baixar_lote_vencido(uuid, integer, text);

CREATE FUNCTION public.baixar_lote_vencido(
  p_lote_id uuid,
  p_qtd numeric DEFAULT NULL::numeric,
  p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lote     vencimentos_estoque;
  v_qtd      numeric;
  v_restante numeric;
  v_produto  text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_lote
    FROM public.vencimentos_estoque
   WHERE id = p_lote_id AND COALESCE(ativo, true)
     FOR UPDATE;

  IF v_lote.id IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_lote.filial), false) THEN
    RAISE EXCEPTION 'Lote de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('logistica'), false)
          OR COALESCE(public.auth_gerente_da(v_lote.filial), false)) THEN
    RAISE EXCEPTION 'Apenas a Logística ou o gerente da filial dão baixa em lote vencido.'
      USING ERRCODE = '42501';
  END IF;
  IF v_lote.status <> 'OK' THEN
    RAISE EXCEPTION 'Este lote já foi encerrado como "%".', v_lote.status USING ERRCODE = 'P0001';
  END IF;
  IF v_lote.produto_id IS NULL THEN
    RAISE EXCEPTION 'Lote sem produto vinculado — não há saldo para baixar.' USING ERRCODE = 'P0001';
  END IF;

  -- Sem quantidade = perde o lote inteiro, que é o caso comum.
  v_qtd := COALESCE(p_qtd, v_lote.qtd, 0);
  IF v_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade perdida precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF v_qtd > COALESCE(v_lote.qtd, 0) THEN
    -- `trim_scale` para a mensagem não dizer "12.500" a quem digitou 12,5.
    RAISE EXCEPTION 'O lote tem %; não dá para baixar %.',
      trim_scale(COALESCE(v_lote.qtd, 0)), trim_scale(v_qtd) USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_produto FROM public.produtos WHERE id = v_lote.produto_id;

  INSERT INTO public.movimentacoes_estoque
    (produto_id, tipo, qtd, origem, destino, data, filial)
  VALUES
    (v_lote.produto_id, 'Ajuste −', v_qtd, 'Almoxarifado',
     'Perda por validade' || COALESCE(' — lote ' || v_lote.lote, '')
       || COALESCE(' (' || p_motivo || ')', ''),
     public.acre_today(), v_lote.filial);

  v_restante := COALESCE(v_lote.qtd, 0) - v_qtd;

  UPDATE public.vencimentos_estoque
     SET qtd        = v_restante,
         status     = CASE WHEN v_restante <= 0 THEN 'Perda' ELSE 'OK' END,
         observacao = COALESCE(observacao || ' | ', '') ||
                      'Baixa de ' || trim_scale(v_qtd) || ' em ' || to_char(public.acre_today(), 'DD/MM/YYYY')
                      || COALESCE(': ' || p_motivo, ''),
         updated_at = now()
   WHERE id = p_lote_id;

  RETURN jsonb_build_object(
    'lote_id',   p_lote_id,
    'produto',   COALESCE(v_produto, '—'),
    'baixado',   v_qtd,
    'restante',  v_restante,
    'encerrado', v_restante <= 0
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.baixar_lote_vencido(uuid, numeric, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.baixar_lote_vencido(uuid, numeric, text) TO authenticated, service_role;

-- ── 10. Devolução ao fornecedor ────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.registrar_devolucao_fornecedor(uuid, integer, text, boolean, text);

CREATE FUNCTION public.registrar_devolucao_fornecedor(
  p_recebimento_id uuid,
  p_qtd numeric,
  p_motivo text,
  p_reenvio_esperado boolean DEFAULT true,
  p_observacao text DEFAULT NULL::text)
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
  IF v_valor > 0 THEN
    SELECT * INTO v_conta
      FROM public.contas_pagar
     WHERE pedido_id = v_pedido.id AND COALESCE(ativo, true) AND status IN ('Pendente', 'Parcial')
     ORDER BY created_at LIMIT 1
     FOR UPDATE;

    IF v_conta.id IS NOT NULL THEN
      -- O piso é o que já foi pago: abater abaixo disso faria a conta dever
      -- menos do que já saiu do caixa (migr. 427).
      v_conta_novo := ROUND(GREATEST(v_conta.valor - v_valor, COALESCE(v_conta.valor_pago, 0)), 2);
      IF v_conta_novo <= 0.005 THEN
        UPDATE public.contas_pagar
           SET ativo = false,
               descricao = descricao || ' — cancelada por devolução ao fornecedor',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := 'cancelada';
      ELSE
        UPDATE public.contas_pagar
           SET valor = v_conta_novo,
               descricao = descricao || ' — abatido R$ ' || to_char(v_valor, 'FM999G999G990D00') || ' (devolução)',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := 'abatida';
      END IF;
    ELSIF EXISTS (
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

REVOKE EXECUTE ON FUNCTION public.registrar_devolucao_fornecedor(uuid, numeric, text, boolean, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_devolucao_fornecedor(uuid, numeric, text, boolean, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência depois de rodar nos 4 — as três têm de sair iguais nos quatro:
--
--   -- 1. nenhuma das seis colunas continua integer
--   SELECT table_name, column_name, data_type
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND (table_name, column_name) IN (
--        ('requisicoes','qtd'), ('requisicoes_estoque','qtd'), ('pedidos','item_qtd'),
--        ('recebimentos','qtd_recebida'), ('devolucoes_fornecedor','qtd'),
--        ('vencimentos_estoque','qtd'))
--    ORDER BY 1;
--
--   -- 2. nenhuma RPC ficou sobrecarregada (uma linha por nome, nenhum integer)
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('criar_requisicao_compra','corrigir_requisicao_compra',
--                      'criar_requisicao_estoque','baixar_lote_vencido',
--                      'registrar_devolucao_fornecedor','pedido_saldo')
--    ORDER BY 1;
--
--   -- 3. as DUAS views voltaram com security_invoker
--   SELECT relname, reloptions FROM pg_class
--    WHERE relnamespace = 'public'::regnamespace
--      AND relname IN ('v_pedido_saldo', 'v_fornecedor_desempenho');
--
--   -- 4. o desempenho de fornecedor continua respondendo (não é só existir)
--   SELECT count(*) FROM v_fornecedor_desempenho;
