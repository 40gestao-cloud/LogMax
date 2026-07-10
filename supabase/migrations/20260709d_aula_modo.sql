-- =================================================================
-- LogMax — Modo Aula (whitelist temporária de módulos)
-- =================================================================
-- Contexto: LogMax é usado didaticamente pelo professor com alunos.
-- Ele precisa "focar a turma" num conjunto de módulos por aula (ex.:
-- só Cadastros/Compras/Estoque hoje). Não muda RBAC nem RLS — é uma
-- máscara UX que a sidebar aplica em tempo real.
--
-- Modelo: linha singleton (id=1). `ativo=false` = comportamento normal.
-- `modulos_ativos` = lista dos IDs de módulo permitidos quando ativo.
-- `roles_afetados` = quais roles caem no filtro (admin sempre isento,
-- pra não travar quem administra a config).
--
-- Realtime habilitado pra sidebar reagir sem F5.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.aula_config (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo           boolean NOT NULL DEFAULT false,
  modulos_ativos  text[]  NOT NULL DEFAULT '{}',
  roles_afetados  text[]  NOT NULL DEFAULT '{colaborador,gerente}',
  atualizado_por  uuid    REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.aula_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.aula_config ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado (sidebar precisa saber pra filtrar).
DROP POLICY IF EXISTS "aula_config_select" ON public.aula_config;
CREATE POLICY "aula_config_select"
  ON public.aula_config FOR SELECT TO authenticated USING (true);

-- Escrita: só admin/CEO. INSERT bloqueado (singleton já existe).
DROP POLICY IF EXISTS "aula_config_update" ON public.aula_config;
CREATE POLICY "aula_config_update"
  ON public.aula_config FOR UPDATE TO authenticated
  USING      (auth_user_role() IN ('admin','ceo'))
  WITH CHECK (auth_user_role() IN ('admin','ceo'));

-- Realtime: sidebar assina e reage sem F5 quando o professor liga/muda.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'aula_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.aula_config;
  END IF;
END $$;

COMMIT;
