-- 669 — Grupo de apoio no Modo Aula
--
-- Plano em `docs/Plano_Grupo_de_Apoio.md`. Dois alunos rendem mais quando o
-- professor explica a etapa antes, só para eles e as mediadoras, e depois os
-- junta às equipes — sem a turma parar. O Modo Aula tinha uma configuração só,
-- para todos; esta migração cria uma segunda, para um grupo escolhido.
--
-- Decisões que valem comentário:
--
-- - **Quem está no grupo é dado de saúde.** Fica numa tabela à parte, e não em
--   `user_profiles` (que alunos CEO/conselheiro/gerente leem em Usuários). Só
--   `role = 'admin'` literal vê a lista inteira e a edita; cada integrante vê só
--   a própria linha. A config do grupo também só é lida por admin e integrantes.
--
-- - **Tabelas próprias, não uma 2ª linha na `aula_config`.** Lá, o gatilho
--   `trg_aula_config_sessao` abriria e fecharia sessão no histórico da turma, e
--   `bloqueia_fechamento_com_venda_em_curso`, `encerrar_aulas_ociosas` e os
--   ouvintes de realtime do app leem a tabela sem olhar a linha.
--
-- - **`auth_aula_setores()` escolhe por pessoa.** Integrante com o grupo ligado
--   recebe os setores dos módulos do GRUPO; os demais, os da turma, como antes.
--   Ela alimenta `auth_user_setores()`, e por ela a RLS das tabelas e do
--   Storage — o acesso acompanha sem tocar policy nenhuma. Corpo copiado do
--   banco (igual ao da 317) antes de alterar.
--
-- - **A config aceita ser recriada.** O Reset geral esvazia toda tabela fora da
--   lista dele; em vez de mexer naquela função, o admin pode inserir a linha 1
--   de novo (a tela faz upsert) e linha ausente vale "desligado".

BEGIN;

-- ─── Integrantes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aula_grupo_apoio (
  user_id       uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  papel         text NOT NULL DEFAULT 'aluno',
  incluido_por  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aula_grupo_apoio_papel_chk CHECK (papel IN ('aluno', 'mediador'))
);

COMMENT ON TABLE public.aula_grupo_apoio IS
  'Integrantes do grupo de apoio do Modo Aula (dado sensível: não expor a colegas). Só role=admin literal vê a lista e edita; cada integrante vê só a própria linha.';

ALTER TABLE public.aula_grupo_apoio ENABLE ROW LEVEL SECURITY;

-- `COALESCE(..., false)`: sem perfil, `auth_user_role()` devolve NULL e o
-- guarda sumiria em vez de barrar (migr. 495-497).
DROP POLICY IF EXISTS aula_grupo_apoio_leitura ON public.aula_grupo_apoio;
CREATE POLICY aula_grupo_apoio_leitura
  ON public.aula_grupo_apoio
  FOR SELECT TO authenticated
  USING (
    COALESCE((SELECT public.auth_user_role()) = 'admin', false)
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS aula_grupo_apoio_inclui_admin ON public.aula_grupo_apoio;
CREATE POLICY aula_grupo_apoio_inclui_admin
  ON public.aula_grupo_apoio
  FOR INSERT TO authenticated
  WITH CHECK (COALESCE((SELECT public.auth_user_role()) = 'admin', false));

DROP POLICY IF EXISTS aula_grupo_apoio_altera_admin ON public.aula_grupo_apoio;
CREATE POLICY aula_grupo_apoio_altera_admin
  ON public.aula_grupo_apoio
  FOR UPDATE TO authenticated
  USING (COALESCE((SELECT public.auth_user_role()) = 'admin', false))
  WITH CHECK (COALESCE((SELECT public.auth_user_role()) = 'admin', false));

DROP POLICY IF EXISTS aula_grupo_apoio_remove_admin ON public.aula_grupo_apoio;
CREATE POLICY aula_grupo_apoio_remove_admin
  ON public.aula_grupo_apoio
  FOR DELETE TO authenticated
  USING (COALESCE((SELECT public.auth_user_role()) = 'admin', false));

REVOKE ALL ON TABLE public.aula_grupo_apoio FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aula_grupo_apoio TO authenticated;

-- ─── Config do grupo (linha única) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aula_grupo_apoio_config (
  id              smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo           boolean     NOT NULL DEFAULT false,
  modulos_ativos  text[]      NOT NULL DEFAULT '{}',
  submenus_ativos text[]      NOT NULL DEFAULT '{}',
  atualizado_por  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.aula_grupo_apoio_config IS
  'Modo Aula do grupo de apoio (linha única id=1), no formato da aula_config. Ligado, vale para os integrantes de aula_grupo_apoio no lugar da config da turma. Lida só por admin e integrantes.';

INSERT INTO public.aula_grupo_apoio_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.aula_grupo_apoio_config ENABLE ROW LEVEL SECURITY;

-- O EXISTS passa pela RLS da `aula_grupo_apoio`: o integrante enxerga a
-- própria linha, e é isso que ele precisa provar aqui.
DROP POLICY IF EXISTS aula_grupo_apoio_config_leitura ON public.aula_grupo_apoio_config;
CREATE POLICY aula_grupo_apoio_config_leitura
  ON public.aula_grupo_apoio_config
  FOR SELECT TO authenticated
  USING (
    COALESCE((SELECT public.auth_user_role()) = 'admin', false)
    OR EXISTS (SELECT 1 FROM public.aula_grupo_apoio m WHERE m.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS aula_grupo_apoio_config_recria_admin ON public.aula_grupo_apoio_config;
CREATE POLICY aula_grupo_apoio_config_recria_admin
  ON public.aula_grupo_apoio_config
  FOR INSERT TO authenticated
  WITH CHECK (COALESCE((SELECT public.auth_user_role()) = 'admin', false));

DROP POLICY IF EXISTS aula_grupo_apoio_config_altera_admin ON public.aula_grupo_apoio_config;
CREATE POLICY aula_grupo_apoio_config_altera_admin
  ON public.aula_grupo_apoio_config
  FOR UPDATE TO authenticated
  USING (COALESCE((SELECT public.auth_user_role()) = 'admin', false))
  WITH CHECK (COALESCE((SELECT public.auth_user_role()) = 'admin', false));

REVOKE ALL ON TABLE public.aula_grupo_apoio_config FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.aula_grupo_apoio_config TO authenticated;

-- Sem isto o professor liga o grupo e os integrantes só percebem no F5
-- (a pegadinha da migr. 603: assinar não basta, tem de estar publicada).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'aula_grupo_apoio_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.aula_grupo_apoio_config;
  END IF;
END $$;

-- ─── Setores concedidos pela aula, por pessoa ──────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_aula_setores()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH eu AS (
    SELECT u.id, u.role
      FROM public.user_profiles u
     WHERE u.id = auth.uid()
       AND u.desligado_em IS NULL
       AND u.role <> 'admin'
  ),
  -- Grupo de apoio (migr. 669): ligado e com este usuário dentro, vale no
  -- lugar da config da turma — inclusive com a aula da turma desligada.
  grupo AS (
    SELECT g.modulos_ativos
      FROM public.aula_grupo_apoio_config g
     WHERE g.id = 1
       AND g.ativo
       AND EXISTS (SELECT 1 FROM public.aula_grupo_apoio m JOIN eu ON eu.id = m.user_id)
  )
  SELECT COALESCE(
    CASE WHEN EXISTS (SELECT 1 FROM grupo) THEN
      ARRAY(
        SELECT DISTINCT s
          FROM grupo
          CROSS JOIN LATERAL unnest(grupo.modulos_ativos) AS m(modulo)
          CROSS JOIN LATERAL unnest(public.aula_setores_do_modulo(m.modulo)) AS x(s)
      )
    ELSE
      ARRAY(
        SELECT DISTINCT s
          FROM public.aula_config c
          CROSS JOIN LATERAL unnest(c.modulos_ativos) AS m(modulo)
          CROSS JOIN LATERAL unnest(public.aula_setores_do_modulo(m.modulo)) AS x(s)
         WHERE c.id = 1
           AND c.ativo
           AND EXISTS (
             SELECT 1 FROM eu
              WHERE eu.role = ANY(COALESCE(c.roles_afetados, ARRAY[]::text[]))
           )
      )
    END,
    ARRAY[]::text[]
  );
$function$;

COMMIT;
