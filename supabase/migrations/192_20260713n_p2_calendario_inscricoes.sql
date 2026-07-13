-- =================================================================
-- LogMax — Calendário Editorial + Inscrições em Treinamento por filial
-- (P2 da auditoria RBAC 2026-07-13)
-- =================================================================
-- Régua canônica ([[project_rbac_matriz_filial]]).
--
-- Decisões do usuário (P2):
--   • marketing_calendario → POR FILIAL (cada unidade planeja o próprio
--     calendário de posts). Ganha coluna filial + policies com filtro.
--   • desenvolvimentos_ia  → CATÁLOGO GLOBAL (TI é equipe corporativa
--     única; treinamentos abertos a colaboradores de qualquer filial).
--     NADA A FAZER aqui — policy `USING(true)` da 051 é intencional.
--   • treinamento_inscricoes → herda filial via treinamentos (que ganhou
--     `filial` na 190). Não precisa coluna própria; filtra via EXISTS.
--   • briefings_diarios → CONSOLIDADO (Matriz-level, só admin/CEO em modo
--     Matriz cria e lê). Policy vigente já é apertada no WRITE
--     (auth_is_admin) — SELECT global fica como está: o briefing é
--     narrativa consolidada, não sensível linha-a-linha.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. marketing_calendario — coluna filial + backfill em cascata
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.marketing_calendario
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_marketing_calendario_filial
  ON public.marketing_calendario (filial);

-- Backfill em cascata (só linhas ainda no default 'SuperMax'):
--   1) filial da promoção vinculada (mais específico)
--   2) filial do responsável (user_profiles.filial via auth.uid)
--   3) filial do criador
--   4) fallback SuperMax (já é o default)

UPDATE public.marketing_calendario mc
SET filial = mp.filial
FROM public.marketing_promocoes mp
WHERE mc.promocao_id = mp.id
  AND mc.filial = 'SuperMax'
  AND mp.filial IS NOT NULL
  AND mp.filial <> 'SuperMax';

UPDATE public.marketing_calendario mc
SET filial = up.filial
FROM public.user_profiles up
WHERE mc.responsavel_id = up.id
  AND mc.filial = 'SuperMax'
  AND up.filial IN ('MaxLook','TechMax');

UPDATE public.marketing_calendario mc
SET filial = up.filial
FROM public.user_profiles up
WHERE mc.criado_por = up.id
  AND mc.filial = 'SuperMax'
  AND up.filial IN ('MaxLook','TechMax');

-- ═══════════════════════════════════════════════════════════════════
-- 2. marketing_calendario — policies por filial + setor
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "calendario_read"   ON public.marketing_calendario;
DROP POLICY IF EXISTS "calendario_insert" ON public.marketing_calendario;
DROP POLICY IF EXISTS "calendario_update" ON public.marketing_calendario;
DROP POLICY IF EXISTS "calendario_delete" ON public.marketing_calendario;

CREATE POLICY "calendario_read" ON public.marketing_calendario FOR SELECT TO authenticated
  USING (
    (auth_in_setor('marketing', 'financeiro') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "calendario_insert" ON public.marketing_calendario FOR INSERT TO authenticated
  WITH CHECK (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- Responsável mantém direito de atualizar o próprio post (avançar status),
-- desde que a linha seja da filial dele.
CREATE POLICY "calendario_update" ON public.marketing_calendario FOR UPDATE TO authenticated
  USING (
    auth_pode_filial(filial)
    AND (
      auth_in_setor('marketing')
      OR auth_gerente_da(filial)
      OR responsavel_id = auth.uid()
    )
  )
  WITH CHECK (
    auth_pode_filial(filial)
    AND (
      auth_in_setor('marketing')
      OR auth_gerente_da(filial)
      OR responsavel_id = auth.uid()
    )
  );

CREATE POLICY "calendario_delete" ON public.marketing_calendario FOR DELETE TO authenticated
  USING (
    (auth_in_setor('marketing') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 3. treinamento_inscricoes — herda filial via treinamentos.filial
--    (treinamentos ganhou coluna filial na 190).
--
--    Padrão: colaborador vê a própria inscrição em qualquer treinamento
--    da filial dele; RH/gerente/admin da filial operam.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "inscricoes_read"   ON public.treinamento_inscricoes;
DROP POLICY IF EXISTS "inscricoes_insert" ON public.treinamento_inscricoes;
DROP POLICY IF EXISTS "inscricoes_update" ON public.treinamento_inscricoes;
DROP POLICY IF EXISTS "inscricoes_delete" ON public.treinamento_inscricoes;
DROP POLICY IF EXISTS "inscricoes_self_read" ON public.treinamento_inscricoes;

-- Read via EXISTS na treinamentos-pai (herda filial).
CREATE POLICY "inscricoes_read" ON public.treinamento_inscricoes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.treinamentos t
       WHERE t.id = treinamento_inscricoes.treinamento_id
         AND (auth_in_setor('rh') OR auth_gerente_da(t.filial))
         AND auth_pode_filial(t.filial)
    )
  );

-- Self-read: o próprio funcionário vê a própria inscrição pra imprimir
-- certificado, independente de filtro por setor.
CREATE POLICY "inscricoes_self_read" ON public.treinamento_inscricoes FOR SELECT TO authenticated
  USING (
    funcionario_id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "inscricoes_insert" ON public.treinamento_inscricoes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.treinamentos t
       WHERE t.id = treinamento_inscricoes.treinamento_id
         AND (auth_in_setor('rh') OR auth_gerente_da(t.filial))
         AND auth_pode_filial(t.filial)
    )
  );

CREATE POLICY "inscricoes_update" ON public.treinamento_inscricoes FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.treinamentos t
       WHERE t.id = treinamento_inscricoes.treinamento_id
         AND (auth_in_setor('rh') OR auth_gerente_da(t.filial))
         AND auth_pode_filial(t.filial)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.treinamentos t
       WHERE t.id = treinamento_inscricoes.treinamento_id
         AND (auth_in_setor('rh') OR auth_gerente_da(t.filial))
         AND auth_pode_filial(t.filial)
    )
  );

CREATE POLICY "inscricoes_delete" ON public.treinamento_inscricoes FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.treinamentos t
       WHERE t.id = treinamento_inscricoes.treinamento_id
         AND (auth_in_setor('rh') OR auth_gerente_da(t.filial))
         AND auth_pode_filial(t.filial)
    )
  );

COMMIT;
