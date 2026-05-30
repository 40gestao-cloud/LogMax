-- =================================================================
-- LogMax — TI & Suporte: submódulo "Desenvolvimento com IA"
-- =================================================================
-- Treinamentos práticos com ferramentas de IA / tecnologia.
-- Gerente define nome, ferramenta, lista de auxiliares (gerentes e
-- colaboradores), data e horários (início + fim).
--
-- Pré-requisitos: 20260516_rls_hardening.sql + 20260516_rls_ceo_role.sql
-- + 20260525_multi_setor.sql (usa auth_is_admin / auth_user_role /
-- auth_in_setor).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS desenvolvimentos_ia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  ferramenta    text NOT NULL,
  descricao     text,
  data          date NOT NULL,
  hora_inicio   time NOT NULL,
  hora_fim      time NOT NULL,
  -- Snapshot dos auxiliares: jsonb com [{ id, nome, role, setor }].
  -- Snapshot evita que o nome desapareça da lista se o usuário for
  -- inativado depois — segue o padrão de pedidos.snapshot_item.
  auxiliares    jsonb NOT NULL DEFAULT '[]'::jsonb,
  criador_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_criador  text,
  status        text NOT NULL DEFAULT 'Agendado',
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT chk_dev_ia_status    CHECK (status IN ('Agendado','Em Andamento','Concluído','Cancelado')),
  CONSTRAINT chk_dev_ia_horarios  CHECK (hora_fim > hora_inicio),
  CONSTRAINT chk_dev_ia_aux_array CHECK (jsonb_typeof(auxiliares) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_dev_ia_data    ON desenvolvimentos_ia(data DESC);
CREATE INDEX IF NOT EXISTS idx_dev_ia_status  ON desenvolvimentos_ia(status);
CREATE INDEX IF NOT EXISTS idx_dev_ia_criador ON desenvolvimentos_ia(criador_id);

ALTER TABLE desenvolvimentos_ia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_ia_read"   ON desenvolvimentos_ia;
DROP POLICY IF EXISTS "dev_ia_insert" ON desenvolvimentos_ia;
DROP POLICY IF EXISTS "dev_ia_update" ON desenvolvimentos_ia;
DROP POLICY IF EXISTS "dev_ia_delete" ON desenvolvimentos_ia;

-- Leitura: todos os usuários autenticados (qualquer setor) vêem a agenda
-- de treinamentos — é informação coletiva, não confidencial.
CREATE POLICY "dev_ia_read" ON desenvolvimentos_ia
  FOR SELECT TO authenticated USING (true);

-- Criação: admin/CEO, qualquer gerente, ou TI staff (setor='ti' primário
-- ou em setores_extras). Força criador_id = auth.uid() (ou NULL fallback)
-- para evitar que um user insira treinamento como se fosse outro — segue
-- o mesmo padrão de ti_chamados.criado_por.
CREATE POLICY "dev_ia_insert" ON desenvolvimentos_ia
  FOR INSERT TO authenticated
  WITH CHECK (
    (criador_id = auth.uid() OR criador_id IS NULL)
    AND (
      auth_is_admin()
      OR auth_user_role() = 'gerente'
      OR auth_in_setor('ti')
    )
  );

-- Edição: criador, admin/CEO, ou TI staff. Outros gerentes não editam
-- treinamento alheio (evita conflito entre setores).
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

-- Inativação (soft delete via UPDATE ativo=false): mesmas regras de edição.
-- Hard delete: só admin/CEO.
CREATE POLICY "dev_ia_delete" ON desenvolvimentos_ia
  FOR DELETE TO authenticated
  USING (auth_is_admin());

-- ─────────────────────────────────────────────
-- RPC: lista de pessoas elegíveis como auxiliares
-- ─────────────────────────────────────────────
-- A RLS padrão de user_profiles só deixa gerente ver gente do PRÓPRIO
-- setor (up_select_own_or_scope em 20260516_rls_hardening.sql). Para
-- um gerente de Marketing conseguir convidar alguém de Compras como
-- auxiliar de treinamento, expomos um endpoint mínimo (id, nome, role,
-- setor) via SECURITY DEFINER. Não expõe email/criado_por/filial.

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
  WHERE role IN ('gerente', 'colaborador')
  ORDER BY nome;
$$;

GRANT EXECUTE ON FUNCTION listar_pessoas_treinamento_ia() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'desenvolvimentos_ia'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE desenvolvimentos_ia;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   INSERT INTO desenvolvimentos_ia (nome, ferramenta, data, hora_inicio, hora_fim, nome_criador)
--   VALUES ('Automação com Gemini', 'Gemini 2.5', current_date + 3, '14:00', '16:00', 'Igor');
--   SELECT * FROM desenvolvimentos_ia ORDER BY data;
-- =================================================================
