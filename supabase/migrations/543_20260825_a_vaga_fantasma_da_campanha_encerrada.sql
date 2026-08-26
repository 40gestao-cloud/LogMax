-- 543 — A vaga fantasma da campanha encerrada.
--
-- Auditoria da 540/541. A 540 transformou o teto do carrossel num limite de
-- APROVAÇÃO: `marcar_vitrine` recusa a inclusão que estouraria. Certo. Só que
-- ela conta a FLAG `vitrine_publica`, e o carrossel exibe por outra régua —
-- `get_vitrine_publica` filtra por janela de datas e por ter imagem.
--
-- As duas divergem no caso mais comum do curso: campanha encerrada. A arte
-- fica com a flag ligada para sempre, some do carrossel pela `data_fim`, e
-- continua ocupando vaga. Reproduzido:
--
--     itens realmente no carrossel: 0
--     itens que a cota contava:     1   (limite 2)
--     → incluir dois produtos: BLOQUEADO, com a tela de login vazia
--
-- Depois de algumas campanhas o professor fica travado olhando um carrossel
-- vazio. Trocar um defeito ("corta em silêncio") por outro ("bloqueia sem
-- motivo visível) não é conserto.
--
-- ─── O QUE MUDA ────────────────────────────────────────────────────────────
--
-- 1. `marcar_vitrine` passa a contar o que REALMENTE apareceria — a mesma
--    janela de datas e a mesma exigência de imagem da `get_vitrine_publica`.
--    Vaga fantasma deixa de existir.
--
-- 2. `listar_vitrine_candidatos` ganha `no_ar`: marcado E dentro da janela.
--    Sem isso a tela continuaria contando flags e diria "2 de 2" enquanto a
--    RPC deixa incluir — a contradição só trocaria de lado.
--
-- `no_ar` também é o que torna o problema visível em vez de mágico: a arte de
-- campanha encerrada aparece na curadoria marcada e fora do ar, e o professor
-- entende que pode tirá-la.
--
-- ─── A TROCA QUE ESTOU FAZENDO, DE OLHOS ABERTOS ───────────────────────────
--
-- Contar só o que está no ar reabre uma fresta: peça institucional agendada
-- para a semana que vem não conta hoje, então o professor pode encher as 12
-- vagas e, quando ela entrar, seriam 13 — e o `LIMIT` da leitura cortaria uma.
--
-- Aceito, porque as duas pontas não têm o mesmo peso:
--
--   · vaga fantasma acontece SOZINHA, em toda campanha que termina;
--   · o estouro por agendamento exige alguém agendar deliberadamente peça
--     além do limite, e o `LIMIT` da leitura continua de rede.
--
-- Trocar um problema garantido e frequente por um raro e provocado é o
-- negócio certo.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 540/541/542.

BEGIN;

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

  IF p_tipo NOT IN ('arte','produto','institucional') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'institucional' AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'Só o professor mexe nas peças institucionais da vitrine.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_incluir, false) THEN
    PERFORM pg_advisory_xact_lock(hashtext('vitrine_publica_cota'), 0);

    SELECT COALESCE(max_vitrine, 12) INTO v_max FROM public.marketing_config WHERE id = 1;
    v_max := COALESCE(v_max, 12);

    -- Conta o que APARECERIA, não o que está marcado. Espelha, cláusula por
    -- cláusula, os filtros da `get_vitrine_publica` — se um dia elas
    -- divergirem de novo, a vaga fantasma volta.
    SELECT
      (SELECT count(*)
         FROM public.marketing_artes a
         LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
         LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
        WHERE a.vitrine_publica AND a.id <> p_id
          AND COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
          AND COALESCE(a.data_fim, public.acre_today() + 30) >= public.acre_today())
    + (SELECT count(*)
         FROM public.produtos
        WHERE vitrine_publica AND id <> p_id
          AND imagem_url IS NOT NULL
          AND COALESCE(status, 'Ativo') = 'Ativo'
          AND COALESCE(ativo,  true)    = true
          AND COALESCE(tipo, 'estoque_venda') = 'estoque_venda')
    + (SELECT count(*)
         FROM public.vitrine_institucional
        WHERE vitrine_publica AND id <> p_id
          AND COALESCE(data_fim,    public.acre_today() + 30) >= public.acre_today()
          AND COALESCE(data_inicio, public.acre_today())      <= public.acre_today())
      INTO v_tem;

    IF v_tem >= v_max THEN
      RAISE EXCEPTION
        'A vitrine da tela de login já está com % item(ns) no ar, que é o limite atual. Tire um para incluir outro, ou aumente o limite em Sessões Gerais → Marketing → Configurações.',
        v_tem
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'arte' THEN
    UPDATE public.marketing_artes       SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  ELSIF p_tipo = 'produto' THEN
    UPDATE public.produtos              SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  ELSE
    UPDATE public.vitrine_institucional SET vitrine_publica = COALESCE(p_incluir, false),
                                            atualizado_em   = now()
     WHERE id = p_id;
  END IF;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- `no_ar` na curadoria
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.listar_vitrine_candidatos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role  text;
  v_setor text;
BEGIN
  PERFORM public._assert_rpc('marketing');
  SELECT role, setor INTO v_role, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  IF v_role NOT IN ('admin','ceo') AND v_setor NOT IN ('marketing','all') THEN
    RAISE EXCEPTION 'Sem permissão para listar candidatos da vitrine.'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH artes AS (
      SELECT
        'arte'::text                                              AS tipo,
        a.id::text                                                AS id,
        a.nome_produto                                            AS titulo,
        a.descricao_promocao                                      AS descricao,
        COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url)      AS imagem_url,
        CASE
          WHEN a.arte_url IS NOT NULL AND length(trim(a.arte_url)) > 0
               AND p.imagem_url IS NOT NULL
               AND p.imagem_url <> a.arte_url
          THEN p.imagem_url
          ELSE NULL
        END                                                       AS imagem_fallback,
        a.preco_promocional,
        a.vitrine_publica,
        (a.vitrine_publica
          AND COALESCE(a.data_fim, public.acre_today() + 30) >= public.acre_today()) AS no_ar,
        0                                                         AS prioridade,
        a.created_at
      FROM public.marketing_artes a
      LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
      LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
      WHERE COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      ORDER BY a.created_at DESC
      LIMIT 200
    ),
    prods AS (
      SELECT
        'produto'::text   AS tipo,
        id::text          AS id,
        nome              AS titulo,
        categoria         AS descricao,
        imagem_url,
        NULL::text        AS imagem_fallback,
        preco             AS preco_promocional,
        vitrine_publica,
        -- Produto não tem janela: marcado é o mesmo que no ar. O `tipo` entra
        -- porque patrimônio e consumo não passam no carrossel (migr. 440).
        (vitrine_publica AND COALESCE(tipo, 'estoque_venda') = 'estoque_venda') AS no_ar,
        0                 AS prioridade,
        created_at
      FROM public.produtos
      WHERE imagem_url IS NOT NULL
        AND COALESCE(status, 'Ativo') = 'Ativo'
        AND COALESCE(ativo,  true)    = true
      ORDER BY created_at DESC
      LIMIT 200
    ),
    inst AS (
      SELECT
        'institucional'::text AS tipo,
        i.id::text            AS id,
        i.titulo,
        i.descricao,
        i.imagem_url,
        NULL::text            AS imagem_fallback,
        NULL::numeric         AS preco_promocional,
        i.vitrine_publica,
        (i.vitrine_publica
          AND COALESCE(i.data_fim,    public.acre_today() + 30) >= public.acre_today()
          AND COALESCE(i.data_inicio, public.acre_today())      <= public.acre_today()) AS no_ar,
        i.prioridade,
        i.created_at
      FROM public.vitrine_institucional i
      WHERE v_role = 'admin'
    ),
    combined AS (
      SELECT * FROM artes
      UNION ALL
      SELECT * FROM prods
      UNION ALL
      SELECT * FROM inst
    )
    SELECT COALESCE(
      jsonb_agg(to_jsonb(combined)
        ORDER BY combined.vitrine_publica DESC, combined.prioridade DESC, combined.created_at DESC),
      '[]'::jsonb
    )
    FROM combined
  );
END;
$function$;

COMMIT;

-- Verificação:
--
--   -- Arte de campanha encerrada e marcada: vitrine_publica=true, no_ar=false.
--   SELECT jsonb_path_query_array(listar_vitrine_candidatos(),
--          '$[*] ? (@.vitrine_publica == true && @.no_ar == false).titulo');
--
-- TESTE MANUAL
--   marcar arte de campanha vencida  → não ocupa vaga, e a tela mostra "fora do ar"
--   encher o limite com itens no ar  → recusa a próxima inclusão
