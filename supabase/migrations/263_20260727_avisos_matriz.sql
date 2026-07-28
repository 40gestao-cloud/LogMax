-- 263_20260727_avisos_matriz.sql
--
-- Avisos da Matriz — recado direto de admin/CEO/conselheiro para as filiais.
-- Diferente de `notificacoes` (que é por SETOR, sem prazo e sem confirmação
-- de leitura): aqui o destino é por FILIAL + público (gerentes/colaboradores),
-- o aviso expira sozinho e cada destinatário precisa clicar em "Ciente".
--
-- Tabelas:
--   avisos_matriz          : o aviso (título, descrição, alvo, expiração)
--   avisos_matriz_ciencia  : quem já leu (1 linha por usuário por aviso)
--
-- RPCs:
--   criar_aviso_matriz(...)     — admin/CEO/conselheiro
--   remover_aviso_matriz(id)    — soft delete
--   dar_ciencia_aviso(id)       — destinatário confirma leitura
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabelas
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.avisos_matriz (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       text NOT NULL,
  descricao    text NOT NULL,
  -- Array vazio = todas as filiais operacionais.
  filiais      text[] NOT NULL DEFAULT '{}',
  publico      text NOT NULL DEFAULT 'todos',
  expira_em    timestamptz NOT NULL,
  criado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_criador text,
  ativo        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_avisos_publico CHECK (publico IN ('gerentes','colaboradores','todos')),
  CONSTRAINT chk_avisos_filiais CHECK (filiais <@ ARRAY['SuperMax','MaxLook','TechMax']::text[]),
  CONSTRAINT chk_avisos_titulo  CHECK (length(btrim(titulo)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_avisos_matriz_vigentes
  ON public.avisos_matriz (expira_em DESC) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_avisos_matriz_created_at
  ON public.avisos_matriz (created_at DESC);

CREATE TABLE IF NOT EXISTS public.avisos_matriz_ciencia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aviso_id      uuid NOT NULL REFERENCES public.avisos_matriz(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_snapshot text,
  filial        text,
  ciente_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_avisos_ciencia UNIQUE (aviso_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_avisos_ciencia_aviso ON public.avisos_matriz_ciencia (aviso_id);
CREATE INDEX IF NOT EXISTS idx_avisos_ciencia_user  ON public.avisos_matriz_ciencia (user_id);

-- ─────────────────────────────────────────────
-- 2. Helper de visibilidade
-- ─────────────────────────────────────────────
-- Um aviso alcança o usuário quando a filial dele está no alvo (ou o alvo é
-- "todas") E a role dele bate com o público escolhido.
CREATE OR REPLACE FUNCTION public.aviso_matriz_alcanca(p_filiais text[], p_publico text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT (COALESCE(cardinality(p_filiais), 0) = 0 OR public.auth_user_filial() = ANY(p_filiais))
     AND (p_publico = 'todos'
          OR (p_publico = 'gerentes'      AND public.auth_user_role() = 'gerente')
          OR (p_publico = 'colaboradores' AND public.auth_user_role() = 'colaborador'));
$$;

-- ─────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────

ALTER TABLE public.avisos_matriz         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avisos_matriz_ciencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "avisos_matriz_read"    ON public.avisos_matriz;
DROP POLICY IF EXISTS "avisos_matriz_insert"  ON public.avisos_matriz;
DROP POLICY IF EXISTS "avisos_matriz_update"  ON public.avisos_matriz;
DROP POLICY IF EXISTS "avisos_matriz_delete"  ON public.avisos_matriz;

-- auth_is_admin() = admin/CEO/conselheiro (e gerente+is_conselheiro): são os
-- autores, enxergam tudo. Os demais só o que os alcança e ainda está vigente.
CREATE POLICY "avisos_matriz_read" ON public.avisos_matriz
  FOR SELECT TO authenticated USING (
    public.auth_is_admin()
    OR (ativo = true AND expira_em > now() AND public.aviso_matriz_alcanca(filiais, publico))
  );

CREATE POLICY "avisos_matriz_insert" ON public.avisos_matriz
  FOR INSERT TO authenticated WITH CHECK (public.auth_is_admin());

CREATE POLICY "avisos_matriz_update" ON public.avisos_matriz
  FOR UPDATE TO authenticated
  USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

CREATE POLICY "avisos_matriz_delete" ON public.avisos_matriz
  FOR DELETE TO authenticated USING (public.auth_is_admin());

DROP POLICY IF EXISTS "avisos_ciencia_read"   ON public.avisos_matriz_ciencia;
DROP POLICY IF EXISTS "avisos_ciencia_insert" ON public.avisos_matriz_ciencia;
DROP POLICY IF EXISTS "avisos_ciencia_delete" ON public.avisos_matriz_ciencia;

-- Autor vê quem confirmou; o destinatário só a própria confirmação.
CREATE POLICY "avisos_ciencia_read" ON public.avisos_matriz_ciencia
  FOR SELECT TO authenticated USING (
    public.auth_is_admin() OR user_id = auth.uid()
  );

CREATE POLICY "avisos_ciencia_insert" ON public.avisos_matriz_ciencia
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "avisos_ciencia_delete" ON public.avisos_matriz_ciencia
  FOR DELETE TO authenticated USING (public.auth_is_admin());

-- ─────────────────────────────────────────────
-- 4. RPCs
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.criar_aviso_matriz(
  p_titulo    text,
  p_descricao text,
  p_expira_em timestamptz,
  p_filiais   text[] DEFAULT '{}',
  p_publico   text   DEFAULT 'todos'
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Apenas admin, CEO ou conselheiro pode publicar avisos da Matriz.'
      USING ERRCODE = '42501';
  END IF;
  IF p_expira_em <= now() THEN
    RAISE EXCEPTION 'A expiração do aviso precisa ser no futuro.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.avisos_matriz (
    titulo, descricao, filiais, publico, expira_em, criado_por, nome_criador
  ) VALUES (
    btrim(p_titulo), btrim(p_descricao), COALESCE(p_filiais, '{}'), p_publico, p_expira_em,
    auth.uid(), (SELECT nome FROM public.user_profiles WHERE id = auth.uid())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_aviso_matriz(p_aviso_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Apenas admin, CEO ou conselheiro pode remover avisos da Matriz.'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.avisos_matriz SET ativo = false WHERE id = p_aviso_id;
END;
$$;

-- Confirmação de leitura. Idempotente: reclicar não duplica nem erra.
CREATE OR REPLACE FUNCTION public.dar_ciencia_aviso(p_aviso_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.avisos_matriz_ciencia (aviso_id, user_id, nome_snapshot, filial)
  SELECT p_aviso_id, auth.uid(), up.nome, up.filial
    FROM public.user_profiles up
   WHERE up.id = auth.uid()
  ON CONFLICT (aviso_id, user_id) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────
-- 5. Grants (padrão da migração 260: nada para anon)
-- ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.aviso_matriz_alcanca(text[], text)                    FROM public, anon;
REVOKE ALL ON FUNCTION public.criar_aviso_matriz(text, text, timestamptz, text[], text) FROM public, anon;
REVOKE ALL ON FUNCTION public.remover_aviso_matriz(uuid)                            FROM public, anon;
REVOKE ALL ON FUNCTION public.dar_ciencia_aviso(uuid)                               FROM public, anon;

GRANT EXECUTE ON FUNCTION public.aviso_matriz_alcanca(text[], text)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_aviso_matriz(text, text, timestamptz, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remover_aviso_matriz(uuid)                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dar_ciencia_aviso(uuid)                               TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 6. Realtime — o FAB do gerente aparece sem F5
-- ─────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'avisos_matriz'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.avisos_matriz;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   SELECT public.criar_aviso_matriz(
--     'Reunião de alinhamento', 'Sexta 14h no auditório.',
--     now() + interval '3 days', ARRAY['SuperMax'], 'gerentes');
--   SELECT titulo, filiais, publico, expira_em FROM avisos_matriz WHERE ativo;
-- =================================================================
