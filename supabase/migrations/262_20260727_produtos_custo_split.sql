-- 262_20260727_produtos_custo_split.sql
--
-- Fecha o último achado aberto da auditoria de 2026-07-27: `produtos.preco_custo`
-- era legível por qualquer colaborador logado via API. A UI escondia custo e
-- margem (CatalogoProdutosView), mas `GET /rest/v1/produtos?select=*` devolvia
-- tudo — a policy de SELECT era `USING (true)`.
--
-- Por que não resolver com GRANT por coluna: privilégio de coluna no Postgres é
-- por ROLE, e admin e colaborador chegam os dois como `authenticated`. A
-- distinção mora em user_profiles, então só uma regra de LINHA alcança — daí a
-- coluna virar tabela própria com RLS.
--
-- Regra de visibilidade (espelha CatalogoProdutosView.tsx:96):
--   financeiro + marketing (margem de promoção) + logistica (dona do CRUD em
--   Cadastros > Produtos). auth_in_setor() já cobre admin/CEO/conselheiro e
--   gerência por dentro. Ficam de fora: vendas, rh, ti, compras.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tabela irmã
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.produtos_custo (
  produto_id  uuid PRIMARY KEY REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco_custo numeric(15,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.produtos_custo IS
  'Custo do produto isolado de `produtos` para poder ter RLS própria — a policy '
  'de SELECT de `produtos` é aberta a todo authenticated. Ver migração 262.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill (só roda enquanto a coluna antiga existir)
-- ────────────────────────────────────────────────────────────────────────────
DO $backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'produtos'
       AND column_name  = 'preco_custo'
  ) THEN
    INSERT INTO public.produtos_custo (produto_id, preco_custo)
    SELECT p.id, COALESCE(p.preco_custo, 0)
      FROM public.produtos p
    ON CONFLICT (produto_id) DO NOTHING;

    RAISE NOTICE '[262] Backfill de % produto(s).',
      (SELECT count(*) FROM public.produtos_custo);
  ELSE
    RAISE NOTICE '[262] Coluna produtos.preco_custo já removida — backfill pulado.';
  END IF;
END;
$backfill$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.produtos_custo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produtos_custo_select ON public.produtos_custo;
CREATE POLICY produtos_custo_select ON public.produtos_custo
  FOR SELECT TO authenticated
  USING (public.auth_in_setor('financeiro', 'marketing', 'logistica'));

-- Escrita: mesma régua de setor + a filial do produto pai, espelhando a policy
-- `update_produtos` (auth_pode_filial(filial)).
DROP POLICY IF EXISTS produtos_custo_insert ON public.produtos_custo;
CREATE POLICY produtos_custo_insert ON public.produtos_custo
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_in_setor('financeiro', 'marketing', 'logistica')
    AND EXISTS (
      SELECT 1 FROM public.produtos p
       WHERE p.id = produtos_custo.produto_id
         AND public.auth_pode_filial(p.filial)
    )
  );

DROP POLICY IF EXISTS produtos_custo_update ON public.produtos_custo;
CREATE POLICY produtos_custo_update ON public.produtos_custo
  FOR UPDATE TO authenticated
  USING (
    public.auth_in_setor('financeiro', 'marketing', 'logistica')
    AND EXISTS (
      SELECT 1 FROM public.produtos p
       WHERE p.id = produtos_custo.produto_id
         AND public.auth_pode_filial(p.filial)
    )
  )
  WITH CHECK (
    public.auth_in_setor('financeiro', 'marketing', 'logistica')
    AND EXISTS (
      SELECT 1 FROM public.produtos p
       WHERE p.id = produtos_custo.produto_id
         AND public.auth_pode_filial(p.filial)
    )
  );

-- DELETE não tem policy: a linha morre junto com o produto via ON DELETE CASCADE.

-- Grants de tabela seguem a régua da 261 (sem TRUNCATE/DELETE para anon).
REVOKE ALL ON public.produtos_custo FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.produtos_custo TO authenticated;
GRANT ALL ON public.produtos_custo TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. gerar_painel_bi: passa a ler o custo da tabela nova
-- ────────────────────────────────────────────────────────────────────────────
--
-- A função usa `COALESCE(preco_custo, preco, 0)` no cálculo de
-- valor_estoque_total. Ela é SECURITY DEFINER, então enxerga produtos_custo sem
-- barreira. Reescrita por substituição no corpo local (padrão da 260) para não
-- colar um corpo fixo e brigar com o schema drift entre turmas.
DO $bi$
DECLARE
  v_oid  oid;
  v_def  text;
  v_new  text;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'gerar_painel_bi'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[262] gerar_painel_bi não existe neste projeto — pulado.';
    RETURN;
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF v_def NOT LIKE '%COALESCE(preco_custo, preco, 0)%' THEN
    RAISE NOTICE '[262] gerar_painel_bi já ajustada (ou corpo divergente) — pulada.';
    RETURN;
  END IF;

  v_new := replace(
    v_def,
    'COALESCE(preco_custo, preco, 0)',
    'COALESCE((SELECT c.preco_custo FROM public.produtos_custo c'
    || ' WHERE c.produto_id = produtos.id), preco, 0)'
  );

  EXECUTE v_new;
  RAISE NOTICE '[262] gerar_painel_bi ajustada para ler produtos_custo.';
END;
$bi$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Só agora a coluna sai de `produtos`
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.produtos DROP COLUMN IF EXISTS preco_custo;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. View de leitura: produtos + custo mascarado pela RLS
-- ────────────────────────────────────────────────────────────────────────────
--
-- `security_invoker = true` (mesma régua da migração 259) faz o LEFT JOIN ser
-- avaliado com as permissões de quem consulta: quem não passa em
-- produtos_custo_select simplesmente recebe preco_custo = NULL, sem erro e sem
-- lógica no cliente. Quem pode ver recebe o valor.
--
-- Criada DEPOIS do DROP COLUMN de propósito: com a coluna ainda em `produtos`,
-- o `p.*` colidiria com `c.preco_custo` e o Postgres recusaria a view com
-- "column preco_custo specified more than once".
--
-- Cuidado de manutenção: `p.*` congela a lista de colunas no momento da
-- criação. Coluna nova em `produtos` NÃO aparece aqui sozinha — é preciso
-- recriar a view (CREATE OR REPLACE não basta quando a lista muda).
--
-- As telas que precisam de custo leem daqui; as demais seguem em `produtos`.
DROP VIEW IF EXISTS public.produtos_com_custo;
CREATE VIEW public.produtos_com_custo
  WITH (security_invoker = true)
AS
  SELECT p.*, c.preco_custo
    FROM public.produtos p
    LEFT JOIN public.produtos_custo c ON c.produto_id = p.id;

REVOKE ALL ON public.produtos_com_custo FROM PUBLIC, anon;
GRANT SELECT ON public.produtos_com_custo TO authenticated, service_role;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Coluna fora de produtos e contagem batendo com o backfill:
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='produtos'
--       AND column_name='preco_custo')            AS coluna_antiga_deve_ser_0,
--   (SELECT count(*) FROM produtos)               AS produtos,
--   (SELECT count(*) FROM produtos_custo)         AS custos;
--
-- 2) Como colaborador de vendas (via app, não SQL Editor), isto deve devolver
--    preco_custo = NULL em todas as linhas:
--    GET /rest/v1/produtos_com_custo?select=nome,preco,preco_custo&limit=5
--
-- 3) E isto deve devolver 42501 / lista vazia:
--    GET /rest/v1/produtos_custo?select=*
