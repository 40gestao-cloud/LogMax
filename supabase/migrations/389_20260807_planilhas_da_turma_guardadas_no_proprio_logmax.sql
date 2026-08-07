-- =================================================================
-- 389 — A planilha preenchida passa a morar no próprio LogMax.
--
-- O buraco, relatado da sala: o aluno baixa o modelo, preenche em casa e
-- então depende de pendrive, WhatsApp ou Drive pessoal para reencontrar o
-- arquivo na aula seguinte. Metade perde, metade manda a versão errada, e
-- ninguém consegue continuar de onde parou. O trabalho existe; o lugar
-- para guardá-lo é que não existia.
--
-- Solução mais barata que dava: um bucket privado + uma tabela de metadados.
-- Sem endpoint novo (o Vercel Hobby está em 12/12 functions), sem editor,
-- sem sincronização. O aluno envia o .xlsx, ele fica ali, e ele baixa de
-- volta de qualquer máquina em que se logar.
--
-- Decisões que valem estar escritas:
--   • O arquivo é do ALUNO, não da filial. A pasta é o `auth.uid()` e a
--     policy de storage confere isso pelo primeiro nível do caminho —
--     mesmo desenho do bucket `curriculos` (migr. 314). Trocar de filial
--     no meio do curso não faz o aluno perder o que fez.
--   • Docente (admin/CEO/conselheiro) LÊ tudo e não escreve nada. Serve
--     para acompanhar quem está fazendo e para abrir o arquivo junto com o
--     aluno; corrigir por cima do trabalho do outro não é o combinado.
--   • Reenviar o MESMO nome substitui e incrementa `versao`, em vez de
--     empilhar "produtos (2) final FINAL.xlsx". É a operação que o aluno
--     realmente faz — ele continua o mesmo arquivo toda aula.
--   • `UNIQUE (user_id, arquivo_nome)` com `WHERE ativo` — soft-delete
--     precisa de índice parcial, senão o nome fica queimado para sempre
--     depois da primeira exclusão.
--   • 5 MB por arquivo e só formato de planilha. O bucket não é mochila:
--     sem o teto, ele vira depósito de vídeo em duas semanas.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Bucket privado ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'planilhas-turma', 'planilhas-turma', false, 5242880,
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', -- .xlsx
    'application/vnd.ms-excel',                                          -- .xls
    'application/vnd.oasis.opendocument.spreadsheet',                    -- .ods
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. Policies do storage ────────────────────────────────────────
-- Mesmo desenho de `curriculos`: a pasta raiz do caminho é o dono.
DROP POLICY IF EXISTS planilhas_turma_insert ON storage.objects;
CREATE POLICY planilhas_turma_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'planilhas-turma'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS planilhas_turma_update ON storage.objects;
CREATE POLICY planilhas_turma_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'planilhas-turma'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'planilhas-turma'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS planilhas_turma_delete ON storage.objects;
CREATE POLICY planilhas_turma_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'planilhas-turma'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura: o dono e o docente. `auth_is_admin()` aqui (e não
-- `auth_is_conselho()`) porque o CEO da turma também acompanha o material —
-- isto é sala de aula, não deliberação de Conselho.
DROP POLICY IF EXISTS planilhas_turma_read ON storage.objects;
CREATE POLICY planilhas_turma_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'planilhas-turma'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR COALESCE(auth_is_admin(), false)
    )
  );

-- ── 3. Metadados ──────────────────────────────────────────────────
-- O Storage sozinho já listaria os arquivos da pasta, mas não guarda a que
-- tela a planilha pertence nem o nome de quem a enviou — e é isso que faz
-- a tela do docente ser uma lista legível em vez de um monte de caminho.
CREATE TABLE IF NOT EXISTS public.planilhas_trabalho (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  nome_snapshot text,
  entidade      text NOT NULL
                  CHECK (entidade IN ('clientes','fornecedores','produtos','servicos','requisicoes','outro')),
  filial        text,
  arquivo_nome  text NOT NULL,
  path          text NOT NULL UNIQUE,
  tamanho_bytes int  NOT NULL DEFAULT 0,
  versao        int  NOT NULL DEFAULT 1,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.planilhas_trabalho IS
  'Planilha de trabalho do aluno guardada no LogMax. O arquivo e do aluno, nao da filial: trocar de unidade nao faz perder o que ele fez.';
COMMENT ON COLUMN public.planilhas_trabalho.versao IS
  'Sobe a cada reenvio do mesmo nome. E a operacao real do aluno — continuar o mesmo arquivo — em vez de empilhar "final FINAL (2)".';

-- Soft-delete exige índice parcial: sem o `WHERE ativo`, excluir uma
-- planilha queimaria o nome dela para sempre.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_planilha_por_aluno
  ON public.planilhas_trabalho (user_id, lower(arquivo_nome)) WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_planilhas_trabalho_user
  ON public.planilhas_trabalho (user_id, updated_at DESC);

ALTER TABLE public.planilhas_trabalho ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planilhas_trabalho_read ON public.planilhas_trabalho;
CREATE POLICY planilhas_trabalho_read ON public.planilhas_trabalho
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR COALESCE(auth_is_admin(), false));

-- Escrita é só do dono — inclusive para o docente. Ele lê e baixa; corrigir
-- por cima do arquivo do aluno não é o combinado.
DROP POLICY IF EXISTS planilhas_trabalho_insert ON public.planilhas_trabalho;
CREATE POLICY planilhas_trabalho_insert ON public.planilhas_trabalho
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS planilhas_trabalho_update ON public.planilhas_trabalho;
CREATE POLICY planilhas_trabalho_update ON public.planilhas_trabalho
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Bucket privado e com teto:
-- SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'planilhas-turma';
-- Esperado: public = false, 5242880.
--
-- 2) As 4 policies de storage no lugar:
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname='storage' AND tablename='objects'
--    AND policyname LIKE 'planilhas_turma%' ORDER BY 1;
--
-- 3) Aluno não enxerga a pasta do outro. Logado como aluno A:
-- SELECT count(*) FROM storage.objects
--  WHERE bucket_id='planilhas-turma'
--    AND (storage.foldername(name))[1] <> auth.uid()::text;
-- Esperado: 0 (a menos que seja docente).
--
-- 4) Reenviar o mesmo nome não duplica linha:
-- SELECT user_id, arquivo_nome, versao, count(*)
--   FROM planilhas_trabalho WHERE ativo GROUP BY 1,2,3 HAVING count(*) > 1;
-- Esperado: zero linhas.
