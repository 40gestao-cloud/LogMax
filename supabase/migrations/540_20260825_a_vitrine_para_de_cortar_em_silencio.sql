-- 540 — A vitrine para de cortar em silêncio, e a prévia para de mentir.
--
-- Dois defeitos na mesma tela, os dois com a mesma assinatura: a decisão do
-- professor não surte efeito e ninguém avisa.
--
-- ─── 1. O CORTE SILENCIOSO ─────────────────────────────────────────────────
--
-- `get_vitrine_publica` (migr. 103) tem `LIMIT 12` por tipo com
-- `ORDER BY created_at DESC`. Se o professor aprovar 20 artes, 8 somem do
-- carrossel — e as que ficam são as mais RECENTES, não as que ele escolheria.
-- Acima de 12, quem decide deixa de ser ele e passa a ser a data de criação.
--
-- O conserto não é subir o teto: 12 itens a 4,5s já dão quase um minuto de
-- volta completa, e ninguém fica tanto tempo numa tela de login. O conserto é
-- mover o teto de onde ele CORTA para onde ele é DECIDIDO — `marcar_vitrine`
-- passa a recusar a inclusão que estouraria o limite, dizendo quantos já
-- estão lá. A tela mostra "12 de 12" e o professor tira um para pôr outro.
--
-- O `LIMIT` continua na leitura, agora sobre o conjunto combinado e lendo o
-- mesmo número da configuração. Ele deixa de ser a régua e vira rede: se
-- alguma linha entrar por fora da RPC, o carrossel ainda não estica.
--
-- Nota de unidade: o limite passa a ser TOTAL, não por tipo. Antes eram 12
-- artes MAIS 12 produtos, até 24 itens — número que ninguém tinha na cabeça.
-- "O carrossel mostra até 12 itens" é o que o professor consegue prever.
--
-- ─── 2. A PRÉVIA QUE MENTE ─────────────────────────────────────────────────
--
-- `VitrineCarousel` e `VitrinePublicaView` implementam o mesmo fallback: se a
-- imagem da arte quebrar, troca pela foto do produto (`imagem_fallback`).
-- Só que `listar_vitrine_candidatos` devolve esse campo e
-- `get_vitrine_publica` NÃO — então o fallback funciona na tela de aprovação
-- e é letra morta na tela de login.
--
-- O resultado é o pior arranjo possível: o professor abre a Vitrine, vê a
-- arte renderizada (porque ali o fallback salvou), aprova — e no login sai um
-- ícone cinza de imagem quebrada. A tela que existe para ele decidir é
-- justamente a que esconde o defeito.
--
-- Com a migr. 539 o caminho novo é upload, e URL nossa não quebra. Mas link
-- externo continua aceito, e todo o passivo já publicado é link. Devolver o
-- campo custa um LEFT JOIN que a função já faz.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 539 (marketing_config).

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. A leitura do carrossel
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH lim AS (
    SELECT COALESCE((SELECT max_vitrine FROM public.marketing_config WHERE id = 1), 12) AS n
  ),
  artes AS (
    SELECT
      'arte'::text                                                AS tipo,
      a.id::text                                                  AS id,
      a.nome_produto                                              AS titulo,
      a.descricao_promocao                                        AS descricao,
      COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url)        AS imagem_url,
      -- O campo que faltava. A tela de aprovação já o recebia de
      -- `listar_vitrine_candidatos`; aqui ele era `undefined`, e o `onError`
      -- do carrossel não tinha para onde cair.
      CASE WHEN NULLIF(trim(a.arte_url), '') IS NOT NULL
           THEN p.imagem_url END                                  AS imagem_fallback,
      a.preco_promocional,
      a.data_inicio,
      a.data_fim,
      a.created_at
    FROM public.marketing_artes a
    LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
    LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
    WHERE a.vitrine_publica = true
      AND COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      AND COALESCE(a.data_fim, public.acre_today() + 30) >= public.acre_today()
  ),
  prods AS (
    SELECT
      'produto'::text   AS tipo,
      id::text          AS id,
      nome              AS titulo,
      categoria         AS descricao,
      imagem_url,
      NULL::text        AS imagem_fallback,   -- a foto do produto JÁ é a imagem
      preco             AS preco_promocional,
      NULL::date        AS data_inicio,
      NULL::date        AS data_fim,
      created_at
    FROM public.produtos
    WHERE vitrine_publica = true
      AND imagem_url IS NOT NULL
      AND COALESCE(status, 'Ativo') = 'Ativo'
      AND COALESCE(ativo,  true)    = true
      -- Migr. 440. Faltava: patrimônio ou material de consumo com foto e a flag
      -- ligada aparecia na vitrine pública, para visitante anônimo.
      AND COALESCE(tipo, 'estoque_venda') = 'estoque_venda'
  ),
  combined AS (
    SELECT * FROM artes
    UNION ALL
    SELECT * FROM prods
    ORDER BY created_at DESC
    LIMIT (SELECT n FROM lim)
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(combined) ORDER BY combined.created_at DESC),
    '[]'::jsonb
  )
  FROM combined;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. A decisão do professor
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.marcar_vitrine(p_tipo text, p_id uuid, p_incluir boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role  text;
  v_setor text;
  v_max   integer;
  v_tem   integer;
BEGIN
  PERFORM public._assert_rpc('marketing');
  SELECT role, setor INTO v_role, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  IF v_role NOT IN ('admin','ceo') AND v_setor NOT IN ('marketing','all') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar vitrine.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN ('arte','produto') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  -- Tirar da vitrine nunca esbarra em limite. Só a inclusão conta.
  IF COALESCE(p_incluir, false) THEN
    -- Serializa: sem isto dois professores (ou duas abas) contam "11 de 12" ao
    -- mesmo tempo e o carrossel termina com 13 aprovados — dos quais um
    -- sumiria em silêncio, que é o defeito que esta migração fecha.
    PERFORM pg_advisory_xact_lock(hashtext('vitrine_publica_cota'), 0);

    SELECT COALESCE(max_vitrine, 12) INTO v_max FROM public.marketing_config WHERE id = 1;
    v_max := COALESCE(v_max, 12);

    SELECT (SELECT count(*) FROM public.marketing_artes WHERE vitrine_publica AND id <> p_id)
         + (SELECT count(*) FROM public.produtos        WHERE vitrine_publica AND id <> p_id)
      INTO v_tem;

    IF v_tem >= v_max THEN
      RAISE EXCEPTION
        'A vitrine da tela de login já está com % item(ns), que é o limite atual. Tire um para incluir outro, ou aumente o limite em Sessões Gerais → Marketing → Configurações.',
        v_tem
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'arte' THEN
    UPDATE public.marketing_artes SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  ELSE
    UPDATE public.produtos        SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  END IF;
END;
$function$;

COMMIT;

-- Verificação:
--
--   SELECT max_vitrine FROM marketing_config WHERE id = 1;
--   SELECT (SELECT count(*) FROM marketing_artes WHERE vitrine_publica)
--        + (SELECT count(*) FROM produtos WHERE vitrine_publica) AS na_vitrine;
--
-- TESTE MANUAL
--   professor inclui até o limite       → passa
--   inclui mais um                      → recusa dizendo quantos já estão lá
--   remove um e inclui outro            → passa
--   arte com link quebrado no carrossel → cai na foto do produto, não no ícone cinza
