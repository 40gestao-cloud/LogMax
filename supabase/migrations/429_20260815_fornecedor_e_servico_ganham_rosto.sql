-- Fornecedor e serviço passam a ter imagem.
--
-- Até aqui as duas telas eram parede de texto: o card do fornecedor mostrava o
-- mesmo ícone de caixa para todos, e o do serviço nem isso. Quem tem trinta
-- fornecedores lê trinta nomes para achar um. Logo do fornecedor e foto do
-- serviço resolvem isso na primeira olhada.
--
-- Coluna nova em vez de chave dentro de `atributos`: o form de fornecedor
-- reconstrói o JSONB a cada save a partir dos campos declarados para o nicho da
-- filial, e apaga o que não reconhece — a imagem sumiria na primeira edição de
-- um fornecedor SuperMax, que não tem atributos declarados.

ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS logo_url text;

ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS imagem_url text;

-- Bucket único para os dois: mesmo limite, mesmos MIME, mesma régua de quem
-- pode escrever. Idempotente (o INSERT roda de novo sem quebrar).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cadastro-imagens',
  'cadastro-imagens',
  true,
  1048576,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 1048576,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp'];

DROP POLICY IF EXISTS "cadastro_imagens_select" ON storage.objects;
DROP POLICY IF EXISTS "cadastro_imagens_insert" ON storage.objects;
DROP POLICY IF EXISTS "cadastro_imagens_update" ON storage.objects;
DROP POLICY IF EXISTS "cadastro_imagens_delete" ON storage.objects;

-- Leitura livre: bucket público, a URL já é pública por definição.
CREATE POLICY "cadastro_imagens_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cadastro-imagens');

-- Escrita: a união de quem escreve em `fornecedores` (compras, financeiro,
-- logística — migr. 187) e em `servicos` (logística). `auth_in_setor` já deixa
-- admin e CEO passarem; o gerente entra pelo `role`, porque aqui não existe
-- coluna `filial` para chamar `auth_gerente_da()`. O gate de verdade continua
-- sendo o RLS da linha: subir um arquivo sem conseguir gravar a URL na tabela
-- não leva a lugar nenhum.
CREATE POLICY "cadastro_imagens_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cadastro-imagens'
    AND (
      public.auth_in_setor('compras','financeiro','logistica')
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin','ceo','gerente')
      )
    )
  );

CREATE POLICY "cadastro_imagens_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cadastro-imagens'
    AND (
      public.auth_in_setor('compras','financeiro','logistica')
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin','ceo','gerente')
      )
    )
  );

CREATE POLICY "cadastro_imagens_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cadastro-imagens'
    AND (
      public.auth_in_setor('compras','financeiro','logistica')
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin','ceo','gerente')
      )
    )
  );

NOTIFY pgrst, 'reload schema';
