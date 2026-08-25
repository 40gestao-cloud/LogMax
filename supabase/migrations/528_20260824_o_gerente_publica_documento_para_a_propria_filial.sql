-- 528_20260824_o_gerente_publica_documento_para_a_propria_filial.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Documentos deixa de ser mão única da Matriz — o gerente publica na unidade
-- ═══════════════════════════════════════════════════════════════════════════
-- A migr. 476 desenhou o módulo como mão única: só `role = 'admin'` LITERAL
-- escreve, todo o resto baixa. Fazia sentido enquanto o único emissor era o
-- professor. Mas escala de fim de semana, procedimento de caixa e roteiro de
-- inventário são papel do GERENTE para a equipe dele — hoje ele pede ao
-- professor para publicar, ou manda por fora do sistema, que é pior.
--
-- ── O que muda, e o que continua igual ──────────────────────────────────────
-- Gerente passa a INSERT/UPDATE/DELETE em `documentos`, com dois limites que
-- são a razão de isto não ser só "trocar admin por admin OR gerente":
--
--   1. **`filial_alvo` tem de ser a unidade dele.** `NULL` significa "todas as
--      unidades" e continua sendo só da Matriz — sem esta linha, o gerente da
--      MaxLook publicaria para a turma inteira. Vale no INSERT e no UPDATE
--      (`WITH CHECK` dos dois), senão ele publicaria certo e editaria depois.
--   2. **Só no que é dele.** `publicado_por = auth.uid()`. Sem isso ele
--      editaria o regulamento do professor que caiu na filial dele — e a
--      edição alcança título, descrição e destino.
--
-- Admin segue como estava: qualquer unidade, `NULL` inclusive, e mexendo em
-- documento de qualquer autor.
--
-- ── As três pontas que precisavam da mesma régua ────────────────────────────
-- • O BUCKET. A linha em `documentos` sem o arquivo é uma ficha vazia — e o
--   arquivo é o módulo inteiro. `documentos_bucket_insert` recusava o gerente,
--   e o modal morreria no upload antes de chegar ao banco. No UPDATE e no
--   DELETE do objeto o recorte é `owner = auth.uid()`: quem subiu, apaga.
-- • O RASCUNHO. A 513 fez `publicado_em IS NULL` visível só para `admin`
--   literal, na RLS e na policy de leitura do bucket. Sem tocar nisso, o
--   gerente salvaria um rascunho e ele sumiria da própria tela. Agora quem
--   publicou também enxerga o que ainda não foi ao ar — e só ele.
-- • `publicar_documento`. O guard era `role = 'admin'`; o gerente publica o
--   que é dele. A hora continua vindo do banco, e a publicação continua sendo
--   só de ida (gatilho da 513).
--
-- Não muda: `documento_alcanca` (quem RECEBE), a confirmação de leitura, o
-- teto de 10 MB, os mimes, e o fato de o arquivo não se trocar depois de
-- publicado.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Quem pode emitir, e para quem
-- ────────────────────────────────────────────────────────────────────────────
-- Uma função só, usada pelas policies da tabela E do bucket — mesmo desenho de
-- `documento_alcanca`, que decide o lado de quem recebe. Duas cópias da régua
-- divergiriam no primeiro ajuste.
CREATE OR REPLACE FUNCTION public.documento_pode_emitir(p_filial_alvo text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role   text;
  v_filial text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role, filial INTO v_role, v_filial
    FROM public.user_profiles WHERE id = auth.uid();

  -- `role = 'admin'` literal, e não auth_is_admin(): aquela inclui CEO e
  -- conselheiro, que são alunos (vide feedback_auth_is_admin_inclui_alunos).
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- Gerente: só a própria unidade, e nunca 'todas' (NULL).
  IF v_role = 'gerente' THEN
    RETURN p_filial_alvo IS NOT NULL
       AND COALESCE(v_filial, '') <> ''
       AND p_filial_alvo = v_filial;
  END IF;

  RETURN false;
END;
$function$;

COMMENT ON FUNCTION public.documento_pode_emitir(text) IS
  'Quem pode publicar documento com este alvo (migr. 528): admin em qualquer unidade e em "todas"; gerente só na própria e nunca em "todas".';

REVOKE ALL ON FUNCTION public.documento_pode_emitir(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documento_pode_emitir(text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS da tabela
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documentos_insert ON public.documentos;
CREATE POLICY documentos_insert ON public.documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.documento_pode_emitir(filial_alvo)
    -- Autoria não se escolhe: é ela que decide o que o gerente pode editar
    -- depois, e um INSERT com `publicado_por` de outro seria a porta lateral.
    AND (
      COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
      OR publicado_por = auth.uid()
    )
  );

DROP POLICY IF EXISTS documentos_update ON public.documentos;
CREATE POLICY documentos_update ON public.documentos
  FOR UPDATE TO authenticated
  USING (
    COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
    OR (public.documento_pode_emitir(filial_alvo) AND publicado_por = auth.uid())
  )
  WITH CHECK (
    COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
    OR (public.documento_pode_emitir(filial_alvo) AND publicado_por = auth.uid())
  );

DROP POLICY IF EXISTS documentos_delete ON public.documentos;
CREATE POLICY documentos_delete ON public.documentos
  FOR DELETE TO authenticated
  USING (
    COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
    OR (public.documento_pode_emitir(filial_alvo) AND publicado_por = auth.uid())
  );

-- Rascunho: quem publicou vê o próprio, mesmo antes de ir ao ar (migr. 513
-- deixava isso só para o admin, quando só ele emitia).
DROP POLICY IF EXISTS documentos_select ON public.documentos;
CREATE POLICY documentos_select ON public.documentos
  FOR SELECT TO authenticated
  USING (
    COALESCE(ativo, true)
    AND public.documento_alcanca(filial_alvo)
    AND (
      publicado_em IS NOT NULL
      OR publicado_por = auth.uid()
      OR COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. As policies do bucket
-- ────────────────────────────────────────────────────────────────────────────
-- Sem isto o gerente para no upload, antes de o banco ver qualquer coisa.
DROP POLICY IF EXISTS documentos_bucket_insert ON storage.objects;
CREATE POLICY documentos_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND COALESCE((SELECT p.role IN ('admin', 'gerente') FROM public.user_profiles p
                   WHERE p.id = auth.uid()), false)
  );

-- Trocar/apagar objeto: o admin manda no bucket todo; o gerente, no que subiu.
DROP POLICY IF EXISTS documentos_bucket_update ON storage.objects;
CREATE POLICY documentos_bucket_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (
      COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
      OR (owner = auth.uid()
          AND COALESCE((SELECT p.role = 'gerente' FROM public.user_profiles p WHERE p.id = auth.uid()), false))
    )
  );

DROP POLICY IF EXISTS documentos_bucket_delete ON storage.objects;
CREATE POLICY documentos_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (
      COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
      OR (owner = auth.uid()
          AND COALESCE((SELECT p.role = 'gerente' FROM public.user_profiles p WHERE p.id = auth.uid()), false))
    )
  );

-- Leitura do arquivo: o ramo do documento passa a cobrir o rascunho de quem o
-- publicou — senão o gerente salva o rascunho, vê a linha na tela e não
-- consegue abrir o próprio arquivo.
DROP POLICY IF EXISTS documentos_bucket_read ON storage.objects;
CREATE POLICY documentos_bucket_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (
      COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()), false)
      OR EXISTS (
        SELECT 1 FROM public.documentos d
         WHERE d.arquivo_path = storage.objects.name
           AND COALESCE(d.ativo, true)
           AND (d.publicado_em IS NOT NULL OR d.publicado_por = auth.uid())
           AND public.documento_alcanca(d.filial_alvo)
      )
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. A RPC que carimba a hora
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publicar_documento(p_documento_id uuid)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_quando timestamptz;
  v_doc    public.documentos;
BEGIN
  SELECT * INTO v_doc FROM public.documentos WHERE id = p_documento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- MIGR 528: o gerente publica o que é dele, na unidade dele. A régua de
  -- quem emite mora numa função só, a mesma das policies.
  IF NOT (
       COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p
                  WHERE p.id = auth.uid()), false)
       OR (public.documento_pode_emitir(v_doc.filial_alvo)
           AND v_doc.publicado_por = auth.uid())
     ) THEN
    RAISE EXCEPTION 'Você publica documento na sua unidade, e só o que você mesmo criou.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.documentos
     SET publicado_em = now()
   WHERE id = p_documento_id
     AND publicado_em IS NULL
  RETURNING publicado_em INTO v_quando;

  IF v_quando IS NULL THEN
    RAISE EXCEPTION 'Documento não encontrado ou já publicado.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_quando;
END;
$function$;

REVOKE ALL ON FUNCTION public.publicar_documento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publicar_documento(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ─────────────────────────────────────────────────────────────
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'documentos';
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'documentos_bucket%';
--   -- com JWT de gerente (service_role passa batido):
--   --   INSERT com filial_alvo NULL           → recusado
--   --   INSERT com filial_alvo de outra unidade → recusado
--   --   INSERT com a própria unidade          → aceito
