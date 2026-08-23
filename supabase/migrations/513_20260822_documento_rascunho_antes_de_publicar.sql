-- 513 — Documentos: rascunho antes de publicar.
--
-- Hoje o módulo (migr. 476) só tem um estado: existir. O professor escolhe o
-- arquivo e, no mesmo clique, ele chega em todas as unidades. Quem prepara o
-- material da semana com antecedência não tem onde deixá-lo pronto — ou
-- publica antes da hora, ou guarda fora do sistema e volta pra subir na hora
-- da aula, que é exatamente o que este módulo veio tirar do pendrive.
--
-- ─── O ESTADO NOVO ──────────────────────────────────────────────────────────
--
-- `publicado_em NULL` = rascunho. Preenchido = está no ar, e o carimbo é a
-- hora em que ele foi ao ar — não a hora em que o arquivo subiu. É essa
-- diferença que faz "chegou documento novo" continuar honesto: material
-- preparado há uma semana e publicado hoje é novidade de hoje.
--
-- Coluna nova em vez de um `status text`: o rascunho e a data de publicação
-- são a mesma informação, e duas colunas dizendo isso divergem no primeiro
-- UPDATE que esquecer uma delas.
--
-- ─── QUEM ENXERGA RASCUNHO ──────────────────────────────────────────────────
--
-- `role = 'admin'` literal, e ninguém mais. CEO e conselheiro são ALUNOS
-- jogando papéis (a mesma régua da 476 e do cofre de senhas na 409) — se eles
-- vissem o rascunho, "deixar pronto" não guardaria segredo nenhum.
--
-- A trava vale nos DOIS lugares, senão não é trava:
--   · RLS de `documentos` — o rascunho não aparece na lista.
--   · Policy de leitura do bucket — o arquivo do rascunho não baixa por URL
--     assinada, nem pra quem descobrir o caminho.
--
-- E `marcar_documento_lido` recusa rascunho: confirmação de leitura de algo
-- que ainda não foi publicado é linha que ninguém consegue explicar depois.
--
-- ─── SÓ DE IDA ──────────────────────────────────────────────────────────────
--
-- Não existe "despublicar". Documento que já chegou nas unidades e já foi
-- lido não volta a ser rascunho — tirar de circulação é excluir, que é o que
-- a tela sempre ofereceu. Um gatilho fecha o caminho, porque a policy de
-- UPDATE da 476 libera a linha inteira pro admin.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Coluna
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS publicado_em timestamptz;

COMMENT ON COLUMN public.documentos.publicado_em IS
  'Migr. 513 — NULL = rascunho (só role=admin enxerga). Preenchido = hora em que foi ao ar.';

-- Tudo que existe hoje já está no ar: quem publicou pela 476 publicou de
-- verdade. Sem o backfill, a migração transformaria o acervo inteiro em
-- rascunho e sumiria com ele da tela das unidades.
UPDATE public.documentos SET publicado_em = created_at WHERE publicado_em IS NULL;

-- Rascunho primeiro na lista do professor (NULLS FIRST no DESC), publicado em
-- ordem de publicação para as unidades.
DROP INDEX IF EXISTS public.documentos_publicado_idx;
CREATE INDEX documentos_publicado_idx
  ON public.documentos (publicado_em DESC NULLS FIRST, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS da tabela — rascunho é do professor
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS documentos_select ON public.documentos;
CREATE POLICY documentos_select ON public.documentos
  FOR SELECT TO authenticated
  USING (
    COALESCE(ativo, true)
    AND public.documento_alcanca(filial_alvo)
    AND (
      publicado_em IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.user_profiles p
                  WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Bucket — o arquivo do rascunho também não sai
--
-- A 476 resolvia a leitura pela linha em `documentos`; agora a linha precisa
-- estar PUBLICADA. O ramo do admin é o que deixa o professor conferir o
-- próprio rascunho antes de mandar — e é ele quem sobe todo objeto deste
-- bucket, então não há ali o que ler que já não fosse dele.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS documentos_bucket_read ON storage.objects;
CREATE POLICY documentos_bucket_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (
      EXISTS (SELECT 1 FROM public.user_profiles p
               WHERE p.id = auth.uid() AND p.role = 'admin')
      OR EXISTS (
        SELECT 1 FROM public.documentos d
         WHERE d.arquivo_path = storage.objects.name
           AND COALESCE(d.ativo, true)
           AND d.publicado_em IS NOT NULL
           AND public.documento_alcanca(d.filial_alvo)
      )
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Publicar — RPC, para o carimbo ser do banco
--
-- O cliente poderia dar o UPDATE sozinho (a policy da 476 permite), mas aí a
-- hora da publicação viria do relógio do navegador. A fila de não-lidos e o
-- "chegou agora" se penduram nessa hora.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.publicar_documento(p_documento_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_quando timestamptz;
BEGIN
  IF NOT COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p
                    WHERE p.id = auth.uid()), false) THEN
    RAISE EXCEPTION 'Só a Matriz publica documento.' USING ERRCODE = '42501';
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

COMMENT ON FUNCTION public.publicar_documento(uuid) IS
  'Migr. 513 — tira o documento do rascunho e carimba a hora da publicação. Só role=admin.';

REVOKE ALL ON FUNCTION public.publicar_documento(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publicar_documento(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.publicar_documento(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Publicado não volta a ser rascunho
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.documento_publicacao_e_so_de_ida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.publicado_em IS NOT NULL AND NEW.publicado_em IS NULL THEN
    RAISE EXCEPTION 'Documento publicado não volta a ser rascunho — exclua-o.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS documento_publicacao_e_so_de_ida_trg ON public.documentos;
CREATE TRIGGER documento_publicacao_e_so_de_ida_trg
  BEFORE UPDATE ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.documento_publicacao_e_so_de_ida();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Não se confirma leitura de rascunho
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.marcar_documento_lido(p_documento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  -- SECURITY INVOKER: a RLS de `documentos` já esconde o rascunho de quem não
  -- é admin, então para o aluno este EXISTS falha por não achar a linha. A
  -- checagem explícita fecha o caminho também pelo lado do professor e diz o
  -- porquê, em vez de gravar uma leitura órfã.
  IF NOT EXISTS (
    SELECT 1 FROM public.documentos d
     WHERE d.id = p_documento_id AND d.publicado_em IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Documento ainda não publicado.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.documentos_leitura (documento_id, user_id, nome_snapshot, filial)
  SELECT p_documento_id, auth.uid(), up.nome, up.filial
    FROM public.user_profiles up
   WHERE up.id = auth.uid()
  ON CONFLICT (documento_id, user_id) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_documento_lido(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marcar_documento_lido(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.marcar_documento_lido(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
