-- Produtos: ordenação estável por número do código.
--
-- Problema: Cadastros > Produtos ordenava por `codigo` como TEXTO. Com padding
-- inconsistente na base real (ML-004 convive com ML-31; SM-01 com SM-99), o
-- ORDER BY textual embaralha a lista — e quebra de vez quando SuperMax passar
-- de SM-99 para SM-100 ("SM-99" > "SM-100" em texto). Como a listagem é
-- paginada no servidor, a ordem errada também move produtos entre páginas.
--
-- Solução: coluna gerada com a parte numérica do código. PostgREST não aceita
-- expressão em `.order()`, então precisa ser coluna de verdade.
--
-- `left(...,9)` evita overflow de int4 se alguém cadastrar um código com muitos
-- dígitos; código sem dígito nenhum vira 0 (nunca NULL, pra não depender de
-- NULLS FIRST/LAST na ordenação).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS codigo_seq integer
  GENERATED ALWAYS AS (
    COALESCE(
      NULLIF(left(regexp_replace(COALESCE(codigo, ''), '\D', '', 'g'), 9), '')::integer,
      0
    )
  ) STORED;

COMMENT ON COLUMN public.produtos.codigo_seq IS
  'Parte numérica de `codigo`, gerada. Existe só para ORDER BY numérico via '
  'PostgREST (que não aceita expressão em .order()). Ver migração 265.';

CREATE INDEX IF NOT EXISTS idx_produtos_filial_codigo_seq
  ON public.produtos (filial, codigo_seq DESC);

-- A view congela a lista de colunas de `p.*` no momento da criação (ver o aviso
-- de manutenção na migração 262): sem recriar, `codigo_seq` não apareceria nela
-- e o front receberia 400 ao ordenar por essa coluna.
DO $view$
BEGIN
  IF to_regclass('public.produtos_custo') IS NULL THEN
    RAISE NOTICE '[265] produtos_custo não existe (migração 262 não aplicada) — view pulada.';
    RETURN;
  END IF;

  DROP VIEW IF EXISTS public.produtos_com_custo;

  CREATE VIEW public.produtos_com_custo
    WITH (security_invoker = true)
  AS
    SELECT p.*, c.preco_custo
      FROM public.produtos p
      LEFT JOIN public.produtos_custo c ON c.produto_id = p.id;

  REVOKE ALL ON public.produtos_com_custo FROM PUBLIC, anon;
  GRANT SELECT ON public.produtos_com_custo TO authenticated, service_role;
END;
$view$;

COMMIT;

-- PostgREST só enxerga a coluna nova depois de recarregar o schema cache.
NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT codigo, codigo_seq FROM produtos
--  WHERE ativo AND filial = 'MaxLook' ORDER BY codigo_seq DESC LIMIT 10;
-- -- deve sair ML-31, ML-30, ..., e não ML-004 no meio.
--
-- SELECT codigo_seq FROM produtos_com_custo LIMIT 1;  -- não pode dar erro
