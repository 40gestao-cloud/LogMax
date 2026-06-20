-- =================================================================
-- Vitrine: fallback de arte_url vazia para produto.imagem_url
-- =================================================================
-- Bug: marketing_artes.arte_url é NOT NULL, mas pode ser string vazia
-- (passa filtro IS NOT NULL e quebra o <img>). Plus, o produto vinculado
-- via promocao_id já tem imagem_url próprio que ninguém estava usando.
--
-- Fix: substitui get_vitrine_publica e listar_vitrine_candidatos pra:
--   1) Filtrar arte_url vazia/whitespace
--   2) Fazer JOIN marketing_artes → marketing_promocoes → produtos
--      e usar produto.imagem_url como fallback quando arte_url for
--      vazia. Cards de arte sem URL própria viram cards visualmente
--      iguais a cards de produto (mesma imagem do catálogo).
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

-- =================================================================
-- VERIFICAÇÃO
--   SELECT public.listar_vitrine_candidatos();
--   -- artes com arte_url vazio agora aparecem com imagem_url do produto
--   -- vinculado (via promocao_id → produtos.imagem_url).
-- =================================================================
