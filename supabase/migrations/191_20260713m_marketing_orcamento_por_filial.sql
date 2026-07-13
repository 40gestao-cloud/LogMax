-- =================================================================
-- LogMax — Marketing + Orçamento por filial (P1 da auditoria RBAC 2026-07-13)
-- =================================================================
-- Régua canônica ([[project_rbac_matriz_filial]]): filiais isoladas
-- entre si. SuperMax não vê promoções/campanhas/cupons/tarefas de
-- Marketing de MaxLook/TechMax.
--
-- Estado antes:
--   • marketing_promocoes / marketing_tarefas — SELECT filtrado só por
--     setor (auth_in_setor('marketing','financeiro')) em 010; ganharam
--     coluna filial em 145/152, mas policy nunca foi refeita.
--   • marketing_campanhas / marketing_cupons — SELECT `USING(true)`
--     em 083; ganharam coluna filial em 145.
--   • orcamento_mensal_categoria — SELECT `USING(true)` em 119; tem
--     coluna filial desde o CREATE.
--   • itens_campanha — SELECT `USING(true)` em 120; herda filial via
--     campanha (FK).
--
-- Consequência:
--   Marketing SuperMax lia tarefas/promoções de MaxLook via API direta.
--   Financeiro SuperMax lia orçamento de outra filial.
--
-- Padrão canônico aplicado (mesmo da 187 pra WRITE):
--   SELECT = (setor OR gerente da filial) AND auth_pode_filial(filial)
--
-- validar_cupom (RPC) é SECURITY DEFINER — bypassa RLS; PDV continua
-- validando cupom de qualquer filial normalmente.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. marketing_promocoes — SELECT/UPDATE/DELETE ganham filtro filial
--    INSERT já foi apertado em 145 (default SuperMax) + 187 (WRITE)
--    Mas 187 não tocou nas policies de promocoes — só campanhas/cupons.
--    Corrigimos aqui.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "mkt_select" ON public.marketing_promocoes;
DROP POLICY IF EXISTS "mkt_insert" ON public.marketing_promocoes;
DROP POLICY IF EXISTS "mkt_update" ON public.marketing_promocoes;
DROP POLICY IF EXISTS "mkt_delete" ON public.marketing_promocoes;

CREATE POLICY "mkt_select" ON public.marketing_promocoes FOR SELECT TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "mkt_insert" ON public.marketing_promocoes FOR INSERT TO authenticated
  WITH CHECK (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "mkt_update" ON public.marketing_promocoes FOR UPDATE TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "mkt_delete" ON public.marketing_promocoes FOR DELETE TO authenticated
  USING (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 2. marketing_tarefas — mesmo padrão
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "mkt_select" ON public.marketing_tarefas;
DROP POLICY IF EXISTS "mkt_insert" ON public.marketing_tarefas;
DROP POLICY IF EXISTS "mkt_update" ON public.marketing_tarefas;
DROP POLICY IF EXISTS "mkt_delete" ON public.marketing_tarefas;

CREATE POLICY "mkt_select" ON public.marketing_tarefas FOR SELECT TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "mkt_insert" ON public.marketing_tarefas FOR INSERT TO authenticated
  WITH CHECK (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "mkt_update" ON public.marketing_tarefas FOR UPDATE TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "mkt_delete" ON public.marketing_tarefas FOR DELETE TO authenticated
  USING (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 3. marketing_campanhas — SELECT ganha filtro filial (WRITE já é 187)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "campanhas_read" ON public.marketing_campanhas;

CREATE POLICY "campanhas_read" ON public.marketing_campanhas FOR SELECT TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 4. marketing_cupons — SELECT ganha filtro filial (WRITE já é 187)
--    validar_cupom (RPC) é SECURITY DEFINER — PDV/checkout continuam
--    validando cupom mesmo de outra filial pelo caminho oficial.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "cupons_read" ON public.marketing_cupons;

CREATE POLICY "cupons_read" ON public.marketing_cupons FOR SELECT TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 5. orcamento_mensal_categoria — SELECT/UPDATE/DELETE ganham filtro
--    O INSERT original (119) já exigia setor financeiro; ampliamos
--    o padrão. Filial 'Todas' (default do CREATE) fica reservada pra
--    orçamento global de admin — auth_is_admin() cobre via auth_pode_filial.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "orcamento_mensal_select" ON public.orcamento_mensal_categoria;
DROP POLICY IF EXISTS "orcamento_mensal_insert" ON public.orcamento_mensal_categoria;
DROP POLICY IF EXISTS "orcamento_mensal_update" ON public.orcamento_mensal_categoria;
DROP POLICY IF EXISTS "orcamento_mensal_delete" ON public.orcamento_mensal_categoria;

CREATE POLICY "orcamento_mensal_select" ON public.orcamento_mensal_categoria FOR SELECT TO authenticated
  USING (
    (auth_in_setor('financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "orcamento_mensal_insert" ON public.orcamento_mensal_categoria FOR INSERT TO authenticated
  WITH CHECK (
    (auth_in_setor('financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "orcamento_mensal_update" ON public.orcamento_mensal_categoria FOR UPDATE TO authenticated
  USING (
    (auth_in_setor('financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "orcamento_mensal_delete" ON public.orcamento_mensal_categoria FOR DELETE TO authenticated
  USING (
    (auth_in_setor('financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 6. itens_campanha — herda filial via FK campanha
--    Não tem coluna filial própria; filtra via EXISTS na campanha-pai.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "itens_campanha_select" ON public.itens_campanha;
DROP POLICY IF EXISTS "itens_campanha_insert" ON public.itens_campanha;
DROP POLICY IF EXISTS "itens_campanha_update" ON public.itens_campanha;
DROP POLICY IF EXISTS "itens_campanha_delete" ON public.itens_campanha;

CREATE POLICY "itens_campanha_select" ON public.itens_campanha FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_campanhas c
       WHERE c.id = itens_campanha.campanha_id
         AND (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(c.filial))
         AND auth_pode_filial(c.filial)
    )
  );

CREATE POLICY "itens_campanha_insert" ON public.itens_campanha FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketing_campanhas c
       WHERE c.id = itens_campanha.campanha_id
         AND (auth_in_setor('marketing') OR auth_gerente_da(c.filial))
         AND auth_pode_filial(c.filial)
    )
  );

CREATE POLICY "itens_campanha_update" ON public.itens_campanha FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_campanhas c
       WHERE c.id = itens_campanha.campanha_id
         AND (auth_in_setor('marketing') OR auth_gerente_da(c.filial))
         AND auth_pode_filial(c.filial)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketing_campanhas c
       WHERE c.id = itens_campanha.campanha_id
         AND (auth_in_setor('marketing') OR auth_gerente_da(c.filial))
         AND auth_pode_filial(c.filial)
    )
  );

CREATE POLICY "itens_campanha_delete" ON public.itens_campanha FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_campanhas c
       WHERE c.id = itens_campanha.campanha_id
         AND (auth_in_setor('marketing') OR auth_gerente_da(c.filial))
         AND auth_pode_filial(c.filial)
    )
  );

COMMIT;
