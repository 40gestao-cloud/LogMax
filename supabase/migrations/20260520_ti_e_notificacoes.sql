-- =================================================================
-- LogMax — Módulo de TI & Suporte + Sistema de Notificações por Setor
-- =================================================================
-- Pré-requisito: hardening RLS (20260516_rls_hardening.sql) + CEO fix
-- (20260516_rls_ceo_role.sql) — usa auth_is_admin() / auth_user_setor()
-- já criados.
--
-- Tabelas:
--   - ti_chamados    : chamados abertos por qualquer setor para a equipe de TI
--   - notificacoes   : notificações por setor (badge na topbar + sino local)
--
-- RPC:
--   - notificar_setor(...)  : helper para outros módulos dispararem notif.
--   - marcar_notificacao_lida(p_id)  : marca uma notificação como lida.
--   - marcar_todas_lidas(p_setor)    : limpa o badge do setor.
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. TI & Suporte — chamados
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ti_chamados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setor_origem   text NOT NULL,
  tipo_problema  text NOT NULL,
  descricao      text NOT NULL,
  urgencia       text NOT NULL DEFAULT 'Média',
  status         text NOT NULL DEFAULT 'Aberto',
  criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_criador   text,
  resolvido_em   timestamptz,
  resposta       text,
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT chk_ti_setor    CHECK (setor_origem IN (
                                'empresa','compras','estoque','financeiro',
                                'rh','vendas','marketing','ia','equipamentos')),
  CONSTRAINT chk_ti_tipo     CHECK (tipo_problema IN (
                                'Hardware','Software','Rede','Inteligência Artificial','Outro')),
  CONSTRAINT chk_ti_urgencia CHECK (urgencia IN ('Baixa','Média','Alta')),
  CONSTRAINT chk_ti_status   CHECK (status IN ('Aberto','Em andamento','Resolvido'))
);

CREATE INDEX IF NOT EXISTS idx_ti_chamados_status     ON ti_chamados(status);
CREATE INDEX IF NOT EXISTS idx_ti_chamados_setor      ON ti_chamados(setor_origem);
CREATE INDEX IF NOT EXISTS idx_ti_chamados_created_at ON ti_chamados(created_at DESC);

ALTER TABLE ti_chamados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ti_chamados_read"   ON ti_chamados;
DROP POLICY IF EXISTS "ti_chamados_write"  ON ti_chamados;
DROP POLICY IF EXISTS "ti_chamados_modify" ON ti_chamados;
DROP POLICY IF EXISTS "ti_chamados_delete" ON ti_chamados;

-- Todos os usuários autenticados podem ler/abrir chamados — TI é um
-- serviço transversal. Update/delete é restrito a admin/CEO (a equipe
-- de TI no LogMax atual está mapeada nessas roles).
CREATE POLICY "ti_chamados_read" ON ti_chamados
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ti_chamados_write" ON ti_chamados
  FOR INSERT TO authenticated WITH CHECK (criado_por = auth.uid() OR criado_por IS NULL);

CREATE POLICY "ti_chamados_modify" ON ti_chamados
  FOR UPDATE TO authenticated
  USING (auth_is_admin())
  WITH CHECK (auth_is_admin());

CREATE POLICY "ti_chamados_delete" ON ti_chamados
  FOR DELETE TO authenticated USING (auth_is_admin());

-- ─────────────────────────────────────────────
-- 2. Notificações por setor
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notificacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setor          text NOT NULL,
  tipo           text NOT NULL,
  titulo         text NOT NULL,
  mensagem       text,
  link_view      text,
  urgencia       text NOT NULL DEFAULT 'Média',
  lido           boolean NOT NULL DEFAULT false,
  origem_setor   text,
  origem_user    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ref_id         uuid,
  motivo         text,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT chk_notif_setor    CHECK (setor IN (
                                  'empresa','compras','estoque','financeiro',
                                  'rh','vendas','marketing','ti','all')),
  CONSTRAINT chk_notif_tipo     CHECK (tipo IN (
                                  'aprovacao_pendente','aprovado','reprovado',
                                  'mensagem_setor','tarefa_atribuida','tarefa_concluida',
                                  'ti_chamado','ti_resolvido','info')),
  CONSTRAINT chk_notif_urgencia CHECK (urgencia IN ('Baixa','Média','Alta')),
  -- Reprovado exige motivo
  CONSTRAINT chk_notif_motivo   CHECK (tipo <> 'reprovado' OR motivo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_notif_setor      ON notificacoes(setor);
CREATE INDEX IF NOT EXISTS idx_notif_lido       ON notificacoes(lido);
CREATE INDEX IF NOT EXISTS idx_notif_created_at ON notificacoes(created_at DESC);

ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_read"   ON notificacoes;
DROP POLICY IF EXISTS "notif_insert" ON notificacoes;
DROP POLICY IF EXISTS "notif_update" ON notificacoes;
DROP POLICY IF EXISTS "notif_delete" ON notificacoes;

-- Setor 'all' (CEO/admin) vê tudo. Os demais setores só veem o que é
-- endereçado a eles ou a 'all'.
CREATE POLICY "notif_read" ON notificacoes
  FOR SELECT TO authenticated USING (
    auth_is_admin()
    OR setor = 'all'
    OR setor = auth_user_setor()
  );

-- Qualquer usuário autenticado pode inserir (mensagens entre setores,
-- aprovações, etc.). RPC notificar_setor() centraliza o uso correto.
CREATE POLICY "notif_insert" ON notificacoes
  FOR INSERT TO authenticated WITH CHECK (true);

-- Marcar como lida: só o próprio setor (ou admin) pode atualizar.
CREATE POLICY "notif_update" ON notificacoes
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR setor = auth_user_setor() OR setor = 'all')
  WITH CHECK (auth_is_admin() OR setor = auth_user_setor() OR setor = 'all');

CREATE POLICY "notif_delete" ON notificacoes
  FOR DELETE TO authenticated
  USING (auth_is_admin());

-- ─────────────────────────────────────────────
-- 3. RPCs
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notificar_setor(
  p_setor      text,
  p_tipo       text,
  p_titulo     text,
  p_mensagem   text DEFAULT NULL,
  p_link_view  text DEFAULT NULL,
  p_urgencia   text DEFAULT 'Média',
  p_ref_id     uuid DEFAULT NULL,
  p_motivo     text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO notificacoes (
    setor, tipo, titulo, mensagem, link_view, urgencia,
    origem_setor, origem_user, ref_id, motivo
  ) VALUES (
    p_setor, p_tipo, p_titulo, p_mensagem, p_link_view, p_urgencia,
    auth_user_setor(), auth.uid(), p_ref_id, p_motivo
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION marcar_notificacao_lida(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE notificacoes SET lido = true WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION marcar_todas_lidas(p_setor text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_setor text;
BEGIN
  v_setor := COALESCE(p_setor, auth_user_setor());
  UPDATE notificacoes
     SET lido = true
   WHERE lido = false
     AND (setor = v_setor OR setor = 'all' OR auth_is_admin());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION notificar_setor(text,text,text,text,text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION marcar_notificacao_lida(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION marcar_todas_lidas(text)      TO authenticated;

-- ─────────────────────────────────────────────
-- 4. Realtime publication (necessário para o sino em tempo real)
-- ─────────────────────────────────────────────

DO $$
BEGIN
  -- ti_chamados
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ti_chamados'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ti_chamados;
  END IF;
  -- notificacoes
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notificacoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notificacoes;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT notificar_setor('financeiro', 'aprovacao_pendente',
--                          'Nova requisição', 'Pedido #123 aguarda aprovação',
--                          'compras-minhasaprovações', 'Alta');
--   SELECT count(*) FROM notificacoes WHERE setor = 'financeiro';
-- =================================================================
