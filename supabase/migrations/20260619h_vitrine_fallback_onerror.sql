-- =================================================================
-- Vitrine: separa imagem_url e imagem_fallback pra suportar onError no front
-- =================================================================
-- Migration anterior (20260619g) só fazia fallback se arte_url fosse vazia.
-- Mas várias artes têm arte_url PREENCHIDA com URL quebrada (404, link
-- privado, etc) — SQL não tem como saber se a URL carrega.
--
-- Fix: retornar 2 campos:
--   - imagem_url       → o "primário" (arte_url se tem, senão produto.imagem_url)
--   - imagem_fallback  → o produto.imagem_url (quando diferente do primário)
-- Front-end tenta o primário e, em onError do <img>, troca pra fallback.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH artes AS (
    SELECT
      'arte'::text                                                              AS tipo,
      a.id::text                                                                AS id,
      a.nome_produto                                                            AS titulo,
      a.descricao_promocao                                                      AS descricao,
      COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url)                      AS imagem_url,
      CASE
        WHEN a.arte_url IS NOT NULL AND length(trim(a.arte_url)) > 0
             AND p.imagem_url IS NOT NULL
             AND p.imagem_url <> a.arte_url
        THEN p.imagem_url
        ELSE NULL
      END                                                                       AS imagem_fallback,
      a.preco_promocional,
      a.data_inicio,
      a.data_fim,
      a.created_at
    FROM public.marketing_artes a
    LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
    LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
    WHERE a.vitrine_publica = true
      AND COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      AND COALESCE(a.data_fim, current_date + 30) >= current_date
    ORDER BY a.created_at DESC
    LIMIT 12
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
      NULL::date        AS data_inicio,
      NULL::date        AS data_fim,
      created_at
    FROM public.produtos
    WHERE vitrine_publica = true
      AND imagem_url IS NOT NULL
      AND COALESCE(status, 'Ativo') = 'Ativo'
      AND COALESCE(ativo,  true)    = true
    ORDER BY created_at DESC
    LIMIT 12
  ),
  combined AS (
    SELECT * FROM artes
    UNION ALL
    SELECT * FROM prods
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(combined) ORDER BY combined.created_at DESC),
    '[]'::jsonb
  )
  FROM combined;
$$;

GRANT EXECUTE ON FUNCTION public.get_vitrine_publica() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.listar_vitrine_candidatos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role  text;
  v_setor text;
BEGIN
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
        a.created_at
      FROM public.marketing_artes a
      LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
      LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
      WHERE COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      ORDER BY a.created_at DESC
      LIMIT 50
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
        created_at
      FROM public.produtos
      WHERE imagem_url IS NOT NULL
        AND COALESCE(status, 'Ativo') = 'Ativo'
        AND COALESCE(ativo,  true)    = true
      ORDER BY created_at DESC
      LIMIT 50
    ),
    combined AS (
      SELECT * FROM artes
      UNION ALL
      SELECT * FROM prods
    )
    SELECT COALESCE(
      jsonb_agg(to_jsonb(combined) ORDER BY combined.vitrine_publica DESC, combined.created_at DESC),
      '[]'::jsonb
    )
    FROM combined
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_vitrine_candidatos() TO authenticated;

COMMIT;
