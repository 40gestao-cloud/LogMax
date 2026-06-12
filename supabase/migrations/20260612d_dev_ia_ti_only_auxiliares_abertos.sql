-- =================================================================
-- LogMax — Desenvolvimento com IA: TI cria, auxiliares abertos
-- =================================================================
-- Mudanças em relação a 20260529c_ti_desenvolvimento_ia.sql:
--
-- 1. Apenas TI (setor primário ou em setores_extras) e admin/CEO criam
--    treinamentos de IA. Antes, qualquer gerente podia criar.
--
-- 2. A RPC `listar_pessoas_treinamento_ia()` passa a retornar TODOS os
--    usuários (admin, CEO, gerente, colaborador, qualquer setor) — antes
--    filtrava `role IN ('gerente','colaborador')` e por isso o TI não
--    conseguia convidar admin/CEO/financeiro como auxiliar.
--
-- Pré-requisitos: 20260529c_ti_desenvolvimento_ia.sql aplicado.
-- Idempotente — pode rodar várias vezes ([[feedback_migration_nao_aplicada]]).
-- =================================================================

BEGIN;

-- ─── Policy de insert: remove "qualquer gerente" ──────────────────
DROP POLICY IF EXISTS "dev_ia_insert" ON desenvolvimentos_ia;
CREATE POLICY "dev_ia_insert" ON desenvolvimentos_ia
  FOR INSERT TO authenticated
  WITH CHECK (
    (criador_id = auth.uid() OR criador_id IS NULL)
    AND (
      auth_is_admin()
      OR auth_in_setor('ti')
    )
  );

-- Policy de update já cobre só admin/criador/TI desde a migração original,
-- mas re-aplica idempotente caso alguém tenha aberto manualmente.
DROP POLICY IF EXISTS "dev_ia_update" ON desenvolvimentos_ia;
CREATE POLICY "dev_ia_update" ON desenvolvimentos_ia
  FOR UPDATE TO authenticated
  USING (
    auth_is_admin()
    OR criador_id = auth.uid()
    OR auth_in_setor('ti')
  )
  WITH CHECK (
    auth_is_admin()
    OR criador_id = auth.uid()
    OR auth_in_setor('ti')
  );

-- ─── RPC: lista qualquer usuário ──────────────────────────────────
-- Continua SECURITY DEFINER expondo só id/nome/role/setor (sem email,
-- sem filial, sem criado_por). Sem filtro de role: TI pode convidar
-- admin/CEO/financeiro/RH como auxiliar.
CREATE OR REPLACE FUNCTION listar_pessoas_treinamento_ia()
RETURNS TABLE (
  id    uuid,
  nome  text,
  role  text,
  setor text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, nome, role, setor
  FROM user_profiles
  ORDER BY nome;
$$;

GRANT EXECUTE ON FUNCTION listar_pessoas_treinamento_ia() TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT count(*) FROM listar_pessoas_treinamento_ia();
--   -- deve bater com count(*) FROM user_profiles
-- =================================================================
