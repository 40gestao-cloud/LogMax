-- =================================================================
-- Caixa/Bancos por filial + bloqueio de edição por filial
-- =================================================================

BEGIN;

-- ── 1. Coluna filial em caixa_bancos ──────────────────────────────
-- NULL = pertence à Matriz (visível para todos os modos)
-- 'SuperMax'/'MaxLook'/'TechMax' = exclusivo da filial
ALTER TABLE public.caixa_bancos
  ADD COLUMN IF NOT EXISTS filial text
    CHECK (filial IN ('SuperMax','MaxLook','TechMax'));

CREATE INDEX IF NOT EXISTS idx_caixa_bancos_filial ON public.caixa_bancos(filial);

-- ── 2. Configuração de bloqueio por filial ─────────────────────────
CREATE TABLE IF NOT EXISTS public.filial_caixa_config (
  filial       text PRIMARY KEY CHECK (filial IN ('SuperMax','MaxLook','TechMax')),
  bloqueado    boolean NOT NULL DEFAULT false,
  updated_by   uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by_nome text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Garante que as 3 filiais já existam na tabela
INSERT INTO public.filial_caixa_config (filial) VALUES
  ('SuperMax'), ('MaxLook'), ('TechMax')
ON CONFLICT (filial) DO NOTHING;

ALTER TABLE public.filial_caixa_config ENABLE ROW LEVEL SECURITY;

-- Leitura: todos autenticados (filial precisa ler seu próprio bloqueio)
DROP POLICY IF EXISTS fcc_select ON public.filial_caixa_config;
CREATE POLICY fcc_select ON public.filial_caixa_config
  FOR SELECT TO authenticated USING (true);

-- Escrita: só admin/CEO
DROP POLICY IF EXISTS fcc_update ON public.filial_caixa_config;
CREATE POLICY fcc_update ON public.filial_caixa_config
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = auth.uid() AND p.role IN ('admin','ceo')
  ));

-- ── 3. RLS em caixa_bancos (recriar de forma filial-aware) ────────

-- SELECT: admin/CEO/financeiro vê tudo; outros veem apenas
--   registros da própria filial OU sem filial (Matriz global)
DROP POLICY IF EXISTS caixa_bancos_select ON public.caixa_bancos;
CREATE POLICY caixa_bancos_select ON public.caixa_bancos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin','ceo')
           OR p.setor = 'financeiro'
           OR 'financeiro' = ANY(p.setores_extras)
           OR caixa_bancos.filial IS NULL          -- registro global/Matriz
           OR caixa_bancos.filial = p.filial       -- registro da própria filial
         )
    )
  );

-- INSERT: admin/CEO sempre; filial só se NÃO bloqueada
DROP POLICY IF EXISTS caixa_bancos_insert ON public.caixa_bancos;
CREATE POLICY caixa_bancos_insert ON public.caixa_bancos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin','ceo')
           OR (
             -- usuário da filial, filial não bloqueada
             p.filial = caixa_bancos.filial
             AND NOT EXISTS (
               SELECT 1 FROM public.filial_caixa_config fc
                WHERE fc.filial = caixa_bancos.filial AND fc.bloqueado = true
             )
           )
         )
    )
  );

-- UPDATE: admin/CEO sempre; filial só se NÃO bloqueada e é da própria filial
DROP POLICY IF EXISTS caixa_bancos_update ON public.caixa_bancos;
CREATE POLICY caixa_bancos_update ON public.caixa_bancos
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin','ceo')
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

-- DELETE: admin/CEO sempre; filial só se NÃO bloqueada
DROP POLICY IF EXISTS caixa_bancos_delete ON public.caixa_bancos;
CREATE POLICY caixa_bancos_delete ON public.caixa_bancos
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin','ceo')
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
