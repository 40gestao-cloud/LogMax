-- =================================================================
-- RPC pública: get_vitrine_publica
-- =================================================================
-- Exposição read-only de artes publicadas + produtos com imagem,
-- acessível por `anon` (pré-login). Usada pelo carrossel de vitrine
-- na LoginScreen pra mostrar o "sistema vivo" antes do login.
--
-- Por que RPC (e não abrir SELECT pra anon nas tabelas)?
--   1) Mantém RLS das tabelas intacta. Só essa função expõe um subset
--      curado de colunas (nada de preço de custo, status interno,
--      auditoria, etc.).
--   2) Limites e filtros centralizados aqui — fácil ajustar sem mexer
--      em policy.
--   3) Padrão de "view pública" via RPC SECURITY DEFINER é mais simples
--      que gerenciar policies por role pra essa exposição limitada.
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
    WHERE arte_url IS NOT NULL
      AND COALESCE(data_fim, current_date + 30) >= current_date
    ORDER BY created_at DESC
    LIMIT 8
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
    WHERE imagem_url IS NOT NULL
      AND COALESCE(status, 'Ativo') = 'Ativo'
      AND COALESCE(ativo,  true)    = true
    ORDER BY created_at DESC
    LIMIT 8
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

-- Acessível tanto pré-login (anon) quanto pós-login (authenticated).
GRANT EXECUTE ON FUNCTION public.get_vitrine_publica() TO anon, authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Como anon (no SQL Editor, isso roda como postgres, mas a função
--   --  é SECURITY DEFINER, o que é o que importa quando o front chamar):
--   SELECT public.get_vitrine_publica();
--   -- retorna jsonb array com 0..16 itens (artes + produtos), mais
--   -- recentes primeiro. Vazio se o banco não tem conteúdo elegível.
-- =================================================================
