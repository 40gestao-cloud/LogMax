-- =================================================================
-- LogMax — Fecha drift do ERP + aperta artes/pedidos_venda/user_profiles
-- (Extra da auditoria RBAC 2026-07-13)
-- =================================================================
-- Diff dos 4 projetos (via MCP) achou:
--   • LogMax-ERP tinha 3 policies abertas a mais que os outros 3
--     (fcc_select, parcelas_insert, parcelas_update) — mesma classe de
--     [[feedback_rls_bypass_fora_migrations]]: SQL rodado direto no
--     Editor, sem migration correspondente.
--   • marketing_artes / marketing_arte_feedback / pedidos_venda /
--     user_profiles tinham policies com USING(true) ou WITH CHECK(true)
--     que violavam a régua canônica de isolamento por filial.
--
-- Como filial_caixa_config e parcelas_emprestimo só existem no ERP,
-- essas partes são envoltas em `IF EXISTS` pra rodar limpo nos outros 3.
--
-- Padrão canônico aplicado (mesmo da 187):
--   (setor OR gerente da filial) AND auth_pode_filial(filial)
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. filial_caixa_config (só no ERP) — dropa USING(true), recria por filial
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='filial_caixa_config') THEN
    DROP POLICY IF EXISTS "fcc_select" ON public.filial_caixa_config;
    CREATE POLICY "fcc_select" ON public.filial_caixa_config FOR SELECT TO authenticated
      USING (auth_pode_filial(filial));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. parcelas_emprestimo (só no ERP) — INSERT/UPDATE herdam via
--    emprestimos_filial.filial (parcelas não tem coluna filial própria)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='parcelas_emprestimo')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='emprestimos_filial') THEN

    DROP POLICY IF EXISTS "parcelas_insert" ON public.parcelas_emprestimo;
    DROP POLICY IF EXISTS "parcelas_update" ON public.parcelas_emprestimo;

    CREATE POLICY "parcelas_insert" ON public.parcelas_emprestimo FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.emprestimos_filial e
          WHERE e.id = parcelas_emprestimo.emprestimo_id
            AND (auth_in_setor('financeiro') OR auth_gerente_da(e.filial))
            AND auth_pode_filial(e.filial)
        )
      );

    CREATE POLICY "parcelas_update" ON public.parcelas_emprestimo FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.emprestimos_filial e
          WHERE e.id = parcelas_emprestimo.emprestimo_id
            AND (auth_in_setor('financeiro') OR auth_gerente_da(e.filial))
            AND auth_pode_filial(e.filial)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.emprestimos_filial e
          WHERE e.id = parcelas_emprestimo.emprestimo_id
            AND (auth_in_setor('financeiro') OR auth_gerente_da(e.filial))
            AND auth_pode_filial(e.filial)
        )
      );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. pedidos_venda — aperta INSERT
--    A RPC converter_orcamento_em_pedido é SECURITY DEFINER e continua
--    funcionando; INSERT direto passa a exigir setor+filial.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "pv_insert" ON public.pedidos_venda;

CREATE POLICY "pv_insert" ON public.pedidos_venda FOR INSERT TO authenticated
  WITH CHECK (
    (auth_in_setor('vendas') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 4. marketing_artes — 4 policies (SELECT/INSERT/UPDATE/DELETE) ganham filial
--    Coluna filial já existe (herdada de migração anterior).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "artes_read"   ON public.marketing_artes;
DROP POLICY IF EXISTS "artes_insert" ON public.marketing_artes;
DROP POLICY IF EXISTS "artes_update" ON public.marketing_artes;
DROP POLICY IF EXISTS "artes_delete" ON public.marketing_artes;

CREATE POLICY "artes_read" ON public.marketing_artes FOR SELECT TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "artes_insert" ON public.marketing_artes FOR INSERT TO authenticated
  WITH CHECK (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "artes_update" ON public.marketing_artes FOR UPDATE TO authenticated
  USING (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "artes_delete" ON public.marketing_artes FOR DELETE TO authenticated
  USING (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 5. marketing_arte_feedback — SELECT herda filial via marketing_artes (arte_id)
--    INSERT/UPDATE/DELETE já são restritas (user_id=self ou admin).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "feedback_read" ON public.marketing_arte_feedback;

CREATE POLICY "feedback_read" ON public.marketing_arte_feedback FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_artes a
      WHERE a.id = marketing_arte_feedback.arte_id
        AND (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(a.filial))
        AND auth_pode_filial(a.filial)
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- 6. user_profiles — dropa auth_read USING(true); expande up_select
--    Colaborador vê self + colegas da própria filial (necessário pra
--    picker de responsável, avaliador etc.). Admin vê tudo.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_read"              ON public.user_profiles;
DROP POLICY IF EXISTS "up_select_own_or_scope" ON public.user_profiles;

CREATE POLICY "up_select_own_or_scope" ON public.user_profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR auth_is_admin()
    OR auth_pode_filial(filial)
  );

COMMIT;
