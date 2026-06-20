-- =================================================================
-- Vitrine pública: seleção curada por Marketing
-- =================================================================
-- Adiciona toggle `vitrine_publica` em marketing_artes e produtos.
-- Substitui o get_vitrine_publica() pra filtrar só itens marcados.
-- Adiciona 2 RPCs auxiliares pra Marketing gerenciar:
--   - listar_vitrine_candidatos() → lista artes+produtos com imagem
--     e o estado do flag, pra UI montar a lista de toggles.
--   - marcar_vitrine(tipo, id, incluir) → liga/desliga o flag.
--     SECURITY DEFINER + checagem manual de role/setor (admin/CEO/marketing).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Colunas vitrine_publica ────────────────────────────────────
ALTER TABLE public.marketing_artes
  ADD COLUMN IF NOT EXISTS vitrine_publica boolean NOT NULL DEFAULT false;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS vitrine_publica boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_artes_vitrine    ON public.marketing_artes(created_at DESC) WHERE vitrine_publica;
CREATE INDEX IF NOT EXISTS idx_produtos_vitrine ON public.produtos(created_at DESC)        WHERE vitrine_publica;

-- ─── 2. Substitui get_vitrine_publica pra filtrar só o que foi escolhido ───
CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH artes AS (
    SELECT
      'arte'::text       AS tipo,
      id::text           AS id,
      nome_produto       AS titulo,
      descricao_promocao AS descricao,
      arte_url           AS imagem_url,
      preco_promocional,
      data_inicio,
      data_fim,
      created_at
    FROM public.marketing_artes
    WHERE vitrine_publica = true
      AND arte_url IS NOT NULL
      AND COALESCE(data_fim, current_date + 30) >= current_date
    ORDER BY created_at DESC
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

-- ─── 3. Lista candidatos pra UI de Marketing ───────────────────────
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
        'arte'::text       AS tipo,
        id::text           AS id,
        nome_produto       AS titulo,
        descricao_promocao AS descricao,
        arte_url           AS imagem_url,
        preco_promocional,
        vitrine_publica,
        created_at
      FROM public.marketing_artes
      WHERE arte_url IS NOT NULL
      ORDER BY created_at DESC
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

-- ─── 4. Toggle do flag ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_vitrine(
  p_tipo    text,
  p_id      uuid,
  p_incluir boolean
)
RETURNS void
LANGUAGE plpgsql
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
    RAISE EXCEPTION 'Sem permissão para gerenciar vitrine.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tipo = 'arte' THEN
    UPDATE public.marketing_artes SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  ELSIF p_tipo = 'produto' THEN
    UPDATE public.produtos        SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_vitrine(text, uuid, boolean) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como marketing/admin/CEO:
--   SELECT public.listar_vitrine_candidatos();
--   SELECT public.marcar_vitrine('produto', '<uuid>', true);
--   SELECT public.get_vitrine_publica();  -- agora retorna o item marcado
-- =================================================================
