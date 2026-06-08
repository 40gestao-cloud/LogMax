-- ============================================================
--  Controle de Caixa por filial — SuperMax / MaxLook / TechMax
-- ============================================================
-- Antes: 1 sessão de caixa por dia servindo as 3 empresas
--        (UNIQUE em `data` WHERE ativo).
-- Agora: 1 sessão por dia POR filial. Colaborador só vê/abre o
--        caixa da própria filial; admin/CEO/gerente vê todos.
--
-- Linhas legadas (sem coluna `filial`) recebem o marcador
-- 'Legado' e são INATIVADAS — não dá pra retroativamente
-- dividi-las entre 3 filiais. Histórico fica preservado.
--
-- Idempotente. Pode ser reaplicada.
-- ============================================================

-- ─── 1. Coluna filial ────────────────────────────────────────
ALTER TABLE controle_caixa
  ADD COLUMN IF NOT EXISTS filial text;

UPDATE controle_caixa
   SET filial = 'Legado'
 WHERE filial IS NULL;

ALTER TABLE controle_caixa
  ALTER COLUMN filial SET NOT NULL;

ALTER TABLE controle_caixa
  DROP CONSTRAINT IF EXISTS chk_controle_caixa_filial;

ALTER TABLE controle_caixa
  ADD CONSTRAINT chk_controle_caixa_filial
  CHECK (filial IN ('SuperMax', 'MaxLook', 'TechMax', 'Legado'));

-- Inativar linhas legadas (não dá pra dividir retroativamente entre 3 filiais).
-- O front passa a abrir caixa por filial após o deploy.
UPDATE controle_caixa
   SET ativo = false
 WHERE filial = 'Legado'
   AND ativo = true;

-- ─── 2. Índice único parcial por (data, filial) ──────────────
DROP INDEX IF EXISTS uq_controle_caixa_data_ativo;

CREATE UNIQUE INDEX IF NOT EXISTS uq_controle_caixa_data_filial_ativo
  ON controle_caixa (data, filial)
  WHERE ativo = true;

-- ─── 3. Helper auth_user_filial() + auth_in_filial() ─────────
-- Retorna o filial do user_profiles do usuário autenticado. Usado nas
-- policies de controle_caixa pra travar colaborador na própria filial.
CREATE OR REPLACE FUNCTION public.auth_user_filial()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT filial FROM user_profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_filial() TO authenticated;

-- True se o user é admin/CEO/gerente OU pertence à filial alvo.
-- Gerente vê tudo (regra de negócio: cobertura entre unidades).
CREATE OR REPLACE FUNCTION public.auth_pode_filial(p_filial text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    auth_is_admin()
    OR auth_user_role() = 'ceo'
    OR auth_user_role() = 'gerente'
    OR auth_user_filial() = p_filial;
$$;

GRANT EXECUTE ON FUNCTION public.auth_pode_filial(text) TO authenticated;

-- ─── 4. Policies novas em controle_caixa ─────────────────────
-- Substitui a policy antiga (auth_in_setor('financeiro','vendas')) por
-- gate combinado: setor permitido E filial casa (ou role elevado).
DROP POLICY IF EXISTS "fin_all"             ON controle_caixa;
DROP POLICY IF EXISTS "caixa_filial_select" ON controle_caixa;
DROP POLICY IF EXISTS "caixa_filial_write"  ON controle_caixa;

CREATE POLICY "caixa_filial_select"
  ON controle_caixa
  FOR SELECT TO authenticated
  USING (
    auth_in_setor('financeiro', 'vendas')
    AND auth_pode_filial(filial)
  );

CREATE POLICY "caixa_filial_write"
  ON controle_caixa
  FOR ALL TO authenticated
  USING (
    auth_in_setor('financeiro', 'vendas')
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    auth_in_setor('financeiro', 'vendas')
    AND auth_pode_filial(filial)
  );
