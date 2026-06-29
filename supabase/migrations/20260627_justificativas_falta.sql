-- =================================================================
-- LogMax — Justificativas de falta
-- =================================================================
-- CEO, gerentes e funcionários podem justificar faltas com motivo.
-- Notificação hierárquica:
--   Funcionário → Gerente do setor + Admin/CEO
--   Gerente     → Admin/CEO
--   CEO         → Admin
-- =================================================================

-- 1. Tabela
CREATE TABLE IF NOT EXISTS justificativas_falta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_funcionario text NOT NULL,
  data             date NOT NULL,
  motivo           text NOT NULL,
  criado_por       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_criador     text NOT NULL,
  role_criador     text NOT NULL,
  created_at       timestamptz DEFAULT now(),
  ativo            boolean DEFAULT true,

  CONSTRAINT chk_justfalta_role CHECK (role_criador IN ('colaborador','gerente','ceo','admin'))
);

CREATE INDEX IF NOT EXISTS idx_justfalta_func   ON justificativas_falta(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_justfalta_data   ON justificativas_falta(data);
CREATE INDEX IF NOT EXISTS idx_justfalta_created ON justificativas_falta(created_at DESC);

ALTER TABLE justificativas_falta ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE justificativas_falta;

-- RLS

-- SELECT: admin/CEO veem tudo; gerente vê do próprio setor; colaborador vê as próprias
DROP POLICY IF EXISTS "justfalta_select" ON justificativas_falta;
CREATE POLICY "justfalta_select" ON justificativas_falta
  FOR SELECT TO authenticated USING (
    auth_is_admin()
    OR funcionario_id = auth.uid()
    OR criado_por = auth.uid()
  );

-- INSERT: qualquer autenticado (RBAC refinado no frontend)
DROP POLICY IF EXISTS "justfalta_insert" ON justificativas_falta;
CREATE POLICY "justfalta_insert" ON justificativas_falta
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: admin/CEO ou quem criou
DROP POLICY IF EXISTS "justfalta_update" ON justificativas_falta;
CREATE POLICY "justfalta_update" ON justificativas_falta
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR criado_por = auth.uid())
  WITH CHECK (auth_is_admin() OR criado_por = auth.uid());

-- DELETE: admin
DROP POLICY IF EXISTS "justfalta_delete" ON justificativas_falta;
CREATE POLICY "justfalta_delete" ON justificativas_falta
  FOR DELETE TO authenticated
  USING (auth_is_admin());

-- 2. Ampliar chk_notif_tipo para incluir o novo tipo
ALTER TABLE notificacoes DROP CONSTRAINT IF EXISTS chk_notif_tipo;
ALTER TABLE notificacoes
  ADD CONSTRAINT chk_notif_tipo CHECK (tipo IN (
    'aprovacao_pendente','aprovado','reprovado',
    'mensagem_setor','tarefa_atribuida','tarefa_concluida',
    'ti_chamado','ti_resolvido','info',
    'treinamento_atribuido','briefing_diario','justificativa_falta'
  ));
