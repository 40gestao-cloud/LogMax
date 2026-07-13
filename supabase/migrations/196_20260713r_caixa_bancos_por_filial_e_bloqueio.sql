-- =================================================================
-- LogMax — caixa_bancos por filial + trava filial_caixa_config
-- =================================================================
-- Diff via MCP achou que caixa_bancos nas 3 outras turmas ainda estava
-- com policy legada `fin_all` (setor financeiro cross-filial, viola a
-- régua canônica). Só o LogMax-ERP tinha o padrão granular com filtro
-- por filial + integração com `filial_caixa_config.bloqueado` (feature
-- de trava do caixa da filial).
--
-- Esta migração propaga o padrão do ERP pras 4 turmas:
--   1. Cria tabela `filial_caixa_config` (idempotente) — trava por filial.
--   2. Substitui `caixa_bancos.fin_all` pelas 4 policies granulares.
--
-- Preserva comportamento exato do ERP (sem introduzir mudança nele):
--   • SELECT: admin/CEO OU setor financeiro OU caixa sem filial (global
--     Matriz) OU mesma filial do usuário.
--   • INSERT/UPDATE/DELETE: admin/CEO OU (mesma filial E filial não
--     está bloqueada em filial_caixa_config).
--
-- Após aplicar nos 4, o schema/policies convergem 100% e o diff sai limpo.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. filial_caixa_config — tabela de trava por filial
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.filial_caixa_config (
  filial          text        PRIMARY KEY,
  bloqueado       boolean     NOT NULL DEFAULT false,
  updated_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_nome text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.filial_caixa_config ENABLE ROW LEVEL SECURITY;

-- SELECT: quem pode ler a filial pode ler a config dela (usado pelo
-- caixa_bancos pra decidir bloqueio). Padrão da 193.
DROP POLICY IF EXISTS "fcc_select" ON public.filial_caixa_config;
CREATE POLICY "fcc_select" ON public.filial_caixa_config FOR SELECT TO authenticated
  USING (auth_pode_filial(filial));

-- UPDATE: só admin/CEO ligam/desligam a trava.
-- Padrão do ERP: usa lookup direto em user_profiles (não usa helper
-- auth_is_admin porque conselheiro NÃO precisa desligar trava operacional).
DROP POLICY IF EXISTS "fcc_update" ON public.filial_caixa_config;
CREATE POLICY "fcc_update" ON public.filial_caixa_config FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND p.role = ANY (ARRAY['admin'::text, 'ceo'::text])
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- 2. caixa_bancos — substitui fin_all pelas 4 policies granulares
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "fin_all"              ON public.caixa_bancos;
DROP POLICY IF EXISTS "caixa_bancos_select"  ON public.caixa_bancos;
DROP POLICY IF EXISTS "caixa_bancos_insert"  ON public.caixa_bancos;
DROP POLICY IF EXISTS "caixa_bancos_update"  ON public.caixa_bancos;
DROP POLICY IF EXISTS "caixa_bancos_delete"  ON public.caixa_bancos;

-- SELECT: admin/CEO + financeiro (setor principal ou extra) + colaborador
-- da mesma filial. `caixa_bancos.filial IS NULL` cobre bancos globais da Matriz.
CREATE POLICY "caixa_bancos_select" ON public.caixa_bancos FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role = ANY (ARRAY['admin'::text, 'ceo'::text])
           OR p.setor = 'financeiro'::text
           OR 'financeiro'::text = ANY (p.setores_extras)
           OR caixa_bancos.filial IS NULL
           OR caixa_bancos.filial = p.filial
         )
    )
  );

-- INSERT: admin/CEO OU (mesma filial E filial NÃO bloqueada).
CREATE POLICY "caixa_bancos_insert" ON public.caixa_bancos FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role = ANY (ARRAY['admin'::text, 'ceo'::text])
           OR (
             p.filial = caixa_bancos.filial
             AND NOT EXISTS (
               SELECT 1 FROM public.filial_caixa_config fc
                WHERE fc.filial = caixa_bancos.filial AND fc.bloqueado = true
             )
           )
         )
    )
  );

-- UPDATE: mesma regra do INSERT.
CREATE POLICY "caixa_bancos_update" ON public.caixa_bancos FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role = ANY (ARRAY['admin'::text, 'ceo'::text])
           OR (
             p.filial = caixa_bancos.filial
             AND NOT EXISTS (
               SELECT 1 FROM public.filial_caixa_config fc
                WHERE fc.filial = caixa_bancos.filial AND fc.bloqueado = true
             )
           )
         )
    )
  );

-- DELETE: mesma regra.
CREATE POLICY "caixa_bancos_delete" ON public.caixa_bancos FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role = ANY (ARRAY['admin'::text, 'ceo'::text])
           OR (
             p.filial = caixa_bancos.filial
             AND NOT EXISTS (
               SELECT 1 FROM public.filial_caixa_config fc
                WHERE fc.filial = caixa_bancos.filial AND fc.bloqueado = true
             )
           )
         )
    )
  );

COMMIT;
