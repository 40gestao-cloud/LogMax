-- 403_20260810_atividade_da_aula_chega_na_filial.sql
--
-- Atividade da aula — o roteiro que o professor monta no Modo Aula vira
-- enunciado publicado para a turma da filial.
--
-- O Modo Aula já sabia LIBERAR as telas do fluxo (migr. 173/174/317) e já
-- sabia dizer ao professor o que quebra sem cada etapa (`src/lib/aulaFluxos.ts`).
-- O que faltava era o outro lado: o aluno abre as telas certas e não tem
-- enunciado nenhum — o que fazer, em que papel, e o que entregar ficava só na
-- fala do professor.
--
-- Por que tabela nova em vez de reaproveitar o que existe:
--   • `matriz_tarefas` alimenta o placar da competição — atividade de aula
--     entraria como nota e contaminaria o ranking das filiais.
--   • `tarefas` genérica é por MÓDULO; atividade é por FLUXO e por FILIAL.
--   • `avisos_matriz` é recado curto de texto, sem corpo estruturado e sem
--     como remontar PDF. A régua de alcance (filiais + público + Ciente),
--     essa sim, é copiada dali — é a mesma pergunta respondida duas vezes.
--
-- O corpo vai em jsonb, NÃO como arquivo: o PDF que o aluno baixa é remontado
-- no cliente pelo mesmo `aulaAtividadePdf.ts` que gerou o do professor. Sem
-- bucket, sem upload, sem RLS de storage, e um roteiro corrigido chega
-- corrigido a quem baixar depois.
--
-- Tabelas:
--   aula_atividades         : a atividade (título, fluxo, roteiro jsonb, alvo, prazo)
--   aula_atividades_ciencia : quem já abriu (1 linha por aluno por atividade)
--
-- RPCs:
--   publicar_atividade_aula(...)  — admin/CEO (mesma régua de `aula_config`)
--   remover_atividade_aula(id)    — soft delete
--   dar_ciencia_atividade(id)     — o aluno confirma que leu
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabelas
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.aula_atividades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  -- `id` do fluxo em src/lib/aulaFluxos.ts (compra, pdv, folha…). Texto livre
  -- de propósito: a lista de fluxos é código do frontend, e uma FK para uma
  -- tabela de catálogo obrigaria a migrar o banco toda vez que um fluxo novo
  -- nascesse — justamente o tipo de acoplamento que a lista evita.
  fluxo_id      text NOT NULL,
  fluxo_nome    text NOT NULL,
  objetivo      text,
  -- { versao, resumo, prerequisitos[], etapas[], tarefas[] }. Ver
  -- `AtividadeRoteiro` em src/lib/aulaAtividade.ts — o PDF do aluno é
  -- remontado a partir daqui.
  roteiro       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Array vazio = todas as filiais operacionais (mesma convenção de avisos_matriz).
  filiais       text[] NOT NULL DEFAULT '{}',
  publico       text NOT NULL DEFAULT 'todos',
  expira_em     timestamptz NOT NULL,
  gerado_por_ia boolean NOT NULL DEFAULT false,
  modelo_ia     text,
  criado_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_criador  text,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_atividade_publico CHECK (publico IN ('gerentes','colaboradores','todos')),
  CONSTRAINT chk_atividade_filiais CHECK (filiais <@ ARRAY['SuperMax','MaxLook','TechMax']::text[]),
  CONSTRAINT chk_atividade_titulo  CHECK (length(btrim(titulo)) > 0),
  CONSTRAINT chk_atividade_fluxo   CHECK (length(btrim(fluxo_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_aula_atividades_vigentes
  ON public.aula_atividades (expira_em DESC) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_aula_atividades_created_at
  ON public.aula_atividades (created_at DESC);

CREATE TABLE IF NOT EXISTS public.aula_atividades_ciencia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atividade_id  uuid NOT NULL REFERENCES public.aula_atividades(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_snapshot text,
  filial        text,
  ciente_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_aula_atividades_ciencia UNIQUE (atividade_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_aula_ativ_ciencia_atividade
  ON public.aula_atividades_ciencia (atividade_id);
CREATE INDEX IF NOT EXISTS idx_aula_ativ_ciencia_user
  ON public.aula_atividades_ciencia (user_id);

-- ─────────────────────────────────────────────
-- 2. Helper de alcance
-- ─────────────────────────────────────────────
-- Mesma pergunta de `aviso_matriz_alcanca`, e de propósito uma função própria:
-- fundir as duas amarraria a régua da aula à régua dos recados da Matriz, que
-- mudam por motivos diferentes.
CREATE OR REPLACE FUNCTION public.atividade_aula_alcanca(p_filiais text[], p_publico text)
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

ALTER TABLE public.aula_atividades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aula_atividades_ciencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aula_atividades_read"   ON public.aula_atividades;
DROP POLICY IF EXISTS "aula_atividades_insert" ON public.aula_atividades;
DROP POLICY IF EXISTS "aula_atividades_update" ON public.aula_atividades;
DROP POLICY IF EXISTS "aula_atividades_delete" ON public.aula_atividades;

-- Quem publica é quem conduz a aula: admin/CEO, a mesma régua de escrita de
-- `aula_config` (migr. 173). NÃO se usa `auth_is_admin()` aqui — ela inclui
-- conselheiro, que nesta operação é aluno, e daria a ele o gabarito da turma.
CREATE POLICY "aula_atividades_read" ON public.aula_atividades
  FOR SELECT TO authenticated USING (
    public.auth_user_role() IN ('admin','ceo')
    OR (ativo = true AND expira_em > now()
        AND public.atividade_aula_alcanca(filiais, publico))
  );

CREATE POLICY "aula_atividades_insert" ON public.aula_atividades
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() IN ('admin','ceo'));

CREATE POLICY "aula_atividades_update" ON public.aula_atividades
  FOR UPDATE TO authenticated
  USING      (public.auth_user_role() IN ('admin','ceo'))
  WITH CHECK (public.auth_user_role() IN ('admin','ceo'));

CREATE POLICY "aula_atividades_delete" ON public.aula_atividades
  FOR DELETE TO authenticated
  USING (public.auth_user_role() IN ('admin','ceo'));

DROP POLICY IF EXISTS "aula_ativ_ciencia_read"   ON public.aula_atividades_ciencia;
DROP POLICY IF EXISTS "aula_ativ_ciencia_insert" ON public.aula_atividades_ciencia;
DROP POLICY IF EXISTS "aula_ativ_ciencia_delete" ON public.aula_atividades_ciencia;

-- O professor vê a turma inteira; o aluno, só a própria linha.
CREATE POLICY "aula_ativ_ciencia_read" ON public.aula_atividades_ciencia
  FOR SELECT TO authenticated USING (
    public.auth_user_role() IN ('admin','ceo') OR user_id = auth.uid()
  );

CREATE POLICY "aula_ativ_ciencia_insert" ON public.aula_atividades_ciencia
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "aula_ativ_ciencia_delete" ON public.aula_atividades_ciencia
  FOR DELETE TO authenticated
  USING (public.auth_user_role() IN ('admin','ceo'));

-- ─────────────────────────────────────────────
-- 4. RPCs
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.publicar_atividade_aula(
  p_titulo        text,
  p_fluxo_id      text,
  p_fluxo_nome    text,
  p_roteiro       jsonb,
  p_expira_em     timestamptz,
  p_objetivo      text    DEFAULT NULL,
  p_filiais       text[]  DEFAULT '{}',
  p_publico       text    DEFAULT 'todos',
  p_gerado_por_ia boolean DEFAULT false,
  p_modelo_ia     text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- COALESCE porque `auth_user_role()` devolve NULL para sessão sem perfil, e
  -- `NULL IN (...)` é NULL — que num IF NOT não barra ninguém.
  IF NOT COALESCE(public.auth_user_role() IN ('admin','ceo'), false) THEN
    RAISE EXCEPTION 'Apenas admin ou CEO pode publicar atividade da aula.'
      USING ERRCODE = '42501';
  END IF;
  IF p_expira_em <= now() THEN
    RAISE EXCEPTION 'O prazo da atividade precisa ser no futuro.'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_array_length(p_roteiro -> 'tarefas'), 0) = 0 THEN
    RAISE EXCEPTION 'A atividade precisa de pelo menos uma tarefa.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.aula_atividades (
    titulo, fluxo_id, fluxo_nome, objetivo, roteiro,
    filiais, publico, expira_em, gerado_por_ia, modelo_ia,
    criado_por, nome_criador
  ) VALUES (
    btrim(p_titulo), btrim(p_fluxo_id), btrim(p_fluxo_nome),
    NULLIF(btrim(COALESCE(p_objetivo, '')), ''), COALESCE(p_roteiro, '{}'::jsonb),
    COALESCE(p_filiais, '{}'), p_publico, p_expira_em,
    COALESCE(p_gerado_por_ia, false), NULLIF(btrim(COALESCE(p_modelo_ia, '')), ''),
    auth.uid(), (SELECT nome FROM public.user_profiles WHERE id = auth.uid())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_atividade_aula(p_atividade_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.auth_user_role() IN ('admin','ceo'), false) THEN
    RAISE EXCEPTION 'Apenas admin ou CEO pode remover atividade da aula.'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.aula_atividades SET ativo = false WHERE id = p_atividade_id;
END;
$$;

-- Confirmação de leitura. Idempotente: reclicar não duplica nem erra.
CREATE OR REPLACE FUNCTION public.dar_ciencia_atividade(p_atividade_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.aula_atividades_ciencia (atividade_id, user_id, nome_snapshot, filial)
  SELECT p_atividade_id, auth.uid(), up.nome, up.filial
    FROM public.user_profiles up
   WHERE up.id = auth.uid()
  ON CONFLICT (atividade_id, user_id) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────
-- 5. Grants (padrão da migr. 260: nada nominalmente para anon)
-- ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.atividade_aula_alcanca(text[], text) FROM public, anon;
REVOKE ALL ON FUNCTION public.publicar_atividade_aula(text, text, text, jsonb, timestamptz, text, text[], text, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.remover_atividade_aula(uuid)  FROM public, anon;
REVOKE ALL ON FUNCTION public.dar_ciencia_atividade(uuid)   FROM public, anon;

GRANT EXECUTE ON FUNCTION public.atividade_aula_alcanca(text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publicar_atividade_aula(text, text, text, jsonb, timestamptz, text, text[], text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remover_atividade_aula(uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dar_ciencia_atividade(uuid)   TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 6. Realtime — a atividade aparece na turma sem F5
-- ─────────────────────────────────────────────
-- O Modo Aula esconde o sino de notificações do aluno, então não há outro
-- canal: sem a publicação aqui, o professor envia e a turma só descobre
-- recarregando a página.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'aula_atividades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.aula_atividades;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   SELECT public.publicar_atividade_aula(
--     'Fluxo de compra — turma A', 'compra', 'Compra — da necessidade ao pagamento',
--     '{"versao":1,"tarefas":[{"ordem":1,"titulo":"Abrir a requisição"}]}'::jsonb,
--     now() + interval '2 days', 'Percorrer a cadeia inteira', ARRAY['SuperMax'], 'todos');
--   SELECT titulo, fluxo_id, filiais, publico, expira_em FROM aula_atividades WHERE ativo;
-- =================================================================
