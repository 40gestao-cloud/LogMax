-- 476 — Documentos: a Matriz publica, a filial recebe.
--
-- Faltava o caminho mais banal de uma empresa: mandar um arquivo pra todo
-- mundo. Regulamento, contrato-modelo, manual, roteiro da atividade — hoje
-- isso sai por fora do sistema (grupo de mensagem, pendrive, e-mail), e o
-- aluno aprende que documento oficial circula por qualquer canal. Circula por
-- um canal só, e ele registra quem leu.
--
-- ─── O QUE ESTE MÓDULO É ────────────────────────────────────────────────────
--
-- Mão única. A Matriz publica (upload), as unidades recebem e baixam. Aluno
-- não sobe nada — e isso não é limitação de tela, é RLS: o INSERT em
-- `documentos` e no bucket exige `role = 'admin'` literal.
--
-- Por que `role = 'admin'` e não `auth_is_admin()`: o helper inclui CEO e
-- conselheiro, que são ALUNOS jogando papéis (vide a régua da migr. 410 e do
-- cofre de senhas na 409). Documento oficial é ato do professor.
--
-- ─── ALCANCE ────────────────────────────────────────────────────────────────
--
-- `filial_alvo IS NULL` é o padrão e significa "todas as unidades". Preenchido,
-- vira documento de uma unidade só. A Matriz enxerga tudo, sempre — inclusive
-- para conferir o que mandou.
--
-- ─── CONFIRMAÇÃO DE LEITURA ─────────────────────────────────────────────────
--
-- `documentos_leitura` é o mesmo desenho de `avisos_matriz_ciencia` (migr.
-- 263): a fila de não-lidos é o que faz o modal "Novo Documento Disponível"
-- aparecer, e some quando a pessoa confirma. Sem isso o modal ou nunca some
-- ou some sem ninguém ter lido.
--
-- ─── ARQUIVO ────────────────────────────────────────────────────────────────
--
-- Bucket `documentos` PRIVADO: acesso por URL assinada, nunca por link
-- adivinhável. A policy de leitura do storage resolve pelo arquivo — só entrega
-- o objeto se existir documento ativo apontando pra ele e o alcance bater. Sem
-- isso o bucket seria um buraco: quem descobrisse o caminho baixaria o
-- documento de outra unidade.
--
-- PDF e Word (.docx/.doc), 10 MB. Um arquivo por documento, no formato que o
-- professor escolher — não há conversão entre formatos, e prometer isso na
-- tela seria mentir pro aluno.
--
-- ─── A TRAVA DO DESLIGADO ───────────────────────────────────────────────────
--
-- As policies restritivas da 308 foram criadas varrendo as tabelas que
-- existiam naquele dia. Tabela nova nasce fora da varredura — então as três
-- são recriadas aqui para as duas tabelas novas. Ler continua liberado: quem
-- foi desligado precisa carregar a tela pra ver o aviso disso.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tabelas
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.documentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo             text NOT NULL,
  descricao          text,
  -- Caminho dentro do bucket. É a chave que a policy do storage usa pra
  -- decidir quem baixa: guardar só a URL não daria pra recortar por unidade.
  arquivo_path       text NOT NULL,
  arquivo_nome       text NOT NULL,
  arquivo_mime       text,
  arquivo_tamanho    bigint,
  filial_alvo        text CHECK (filial_alvo IN ('SuperMax', 'MaxLook', 'TechMax')),
  publicado_por      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  publicado_por_nome text,
  ativo              boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.documentos IS
  'Migr. 476 — documentos publicados pela Matriz. Mão única: só role=admin escreve; as unidades leem e baixam.';
COMMENT ON COLUMN public.documentos.filial_alvo IS
  'NULL = todas as unidades (padrão). Preenchido = documento de uma unidade só.';

CREATE INDEX IF NOT EXISTS documentos_ativo_idx ON public.documentos (ativo, created_at DESC);

CREATE TABLE IF NOT EXISTS public.documentos_leitura (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id  uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  nome_snapshot text,
  filial        text,
  lido_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (documento_id, user_id)
);

COMMENT ON TABLE public.documentos_leitura IS
  'Migr. 476 — confirmação de leitura. Espelha avisos_matriz_ciencia (263): é o que tira o documento da fila do modal.';

CREATE INDEX IF NOT EXISTS documentos_leitura_user_idx
  ON public.documentos_leitura (user_id, documento_id);

ALTER TABLE public.documentos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_leitura  ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Alcance — uma função só, usada pela RLS da tabela e pela do storage
--
-- Duas cópias da mesma regra divergem no primeiro ajuste. Uma função, dois
-- chamadores.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.documento_alcanca(p_filial_alvo text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

  -- A Matriz enxerga tudo: quem publica precisa conferir o que publicou.
  IF v_role IN ('admin', 'ceo', 'conselheiro') THEN
    RETURN true;
  END IF;

  RETURN p_filial_alvo IS NULL OR p_filial_alvo = v_filial;
END;
$function$;

COMMENT ON FUNCTION public.documento_alcanca(text) IS
  'Migr. 476 — o documento alcança quem está logado? Usada pela RLS de `documentos` e pela policy de leitura do bucket.';

REVOKE ALL ON FUNCTION public.documento_alcanca(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.documento_alcanca(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.documento_alcanca(text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS documentos_select ON public.documentos;
CREATE POLICY documentos_select ON public.documentos
  FOR SELECT TO authenticated
  USING (COALESCE(ativo, true) AND public.documento_alcanca(filial_alvo));

-- Escrita: o professor, e só. `role = 'admin'` literal — `auth_is_admin()`
-- incluiria CEO e conselheiro, que são alunos.
DROP POLICY IF EXISTS documentos_insert ON public.documentos;
CREATE POLICY documentos_insert ON public.documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS documentos_update ON public.documentos;
CREATE POLICY documentos_update ON public.documentos
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS documentos_delete ON public.documentos;
CREATE POLICY documentos_delete ON public.documentos
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Leitura confirmada: cada um vê e cria a própria. A Matriz vê todas — sem
-- isso não dá pra saber quem leu, que é metade do motivo de existir a tabela.
DROP POLICY IF EXISTS documentos_leitura_select ON public.documentos_leitura;
CREATE POLICY documentos_leitura_select ON public.documentos_leitura
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles p
                WHERE p.id = auth.uid() AND p.role IN ('admin', 'ceo', 'conselheiro'))
  );

DROP POLICY IF EXISTS documentos_leitura_insert ON public.documentos_leitura;
CREATE POLICY documentos_leitura_insert ON public.documentos_leitura
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Confirmar leitura
--
-- RPC em vez de INSERT solto pelo cliente: ela carimba nome e filial do
-- momento da leitura. Um ano depois, "quem leu" continua respondendo mesmo que
-- a pessoa tenha mudado de unidade.
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

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Bucket privado
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos', 'documentos', false, 10485760,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS documentos_bucket_read   ON storage.objects;
DROP POLICY IF EXISTS documentos_bucket_insert ON storage.objects;
DROP POLICY IF EXISTS documentos_bucket_update ON storage.objects;
DROP POLICY IF EXISTS documentos_bucket_delete ON storage.objects;

-- Ler o objeto exige um documento ativo apontando pra ele E o alcance batendo.
-- Resolver pelo arquivo é o que impede o caminho adivinhado de entregar o
-- documento de outra unidade.
CREATE POLICY documentos_bucket_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND EXISTS (
      SELECT 1 FROM public.documentos d
       WHERE d.arquivo_path = storage.objects.name
         AND COALESCE(d.ativo, true)
         AND public.documento_alcanca(d.filial_alvo)
    )
  );

-- Subir/trocar/apagar arquivo: o professor. O upload acontece ANTES de existir
-- a linha em `documentos`, então esta policy não pode depender dela.
CREATE POLICY documentos_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND EXISTS (SELECT 1 FROM public.user_profiles p
                 WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY documentos_bucket_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND EXISTS (SELECT 1 FROM public.user_profiles p
                 WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY documentos_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND EXISTS (SELECT 1 FROM public.user_profiles p
                 WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Trava do desligado nas tabelas novas (migr. 308)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t      text;
  v_cmd  text;
  v_nome text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documentos', 'documentos_leitura'] LOOP
    FOREACH v_cmd IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      v_nome := 'zz_desligado_bloqueia_' || lower(v_cmd);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_nome, t);
      IF v_cmd = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
             WITH CHECK (NOT public.auth_desligado())', v_nome, t);
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated
             USING (NOT public.auth_desligado())', v_nome, t, v_cmd);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Realtime — documento publicado aparece sem F5
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'documentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.documentos;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
