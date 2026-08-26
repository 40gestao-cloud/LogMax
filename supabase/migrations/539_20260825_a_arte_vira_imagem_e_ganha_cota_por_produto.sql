-- 539 — A arte deixa de ser um link e passa a ser uma imagem nossa.
--
-- Hoje `marketing_artes.arte_url` é texto livre, e o carrossel do login joga
-- esse texto direto num `<img src>`. O aluno cola o link da PÁGINA do Canva —
-- que é o que ele naturalmente copia — e aquilo não é uma imagem: o `<img>`
-- quebra e a arte que ele fez nunca aparece. Ninguém é avisado, nem ele nem o
-- professor que aprovou.
--
-- Esta migração dá ao Marketing o mesmo caminho que Cadastros > Produtos já
-- tem: sobe o arquivo, o bucket guarda, a URL é nossa e é sempre uma imagem.
-- O campo continua sendo `arte_url` e o CHECK `chk_arte_url_format` continua
-- valendo — URL pública do Supabase começa com https://, então link externo
-- segue aceito para quem preferir. O upload é caminho novo, não substituição.
--
-- ─── A COTA MUDA DE UNIDADE: DE PROMOÇÃO PARA PRODUTO ──────────────────────
--
-- A régua era `UNIQUE(promocao_id)`: uma arte por promoção. Passa a ser N
-- artes por PRODUTO, com N configurável pelo professor.
--
-- Isso é mais apertado do que parece, e é de propósito. Um produto com três
-- campanhas tinha três artes; agora tem N no curso inteiro. O padrão é 3 (e
-- não 1) porque 1 travaria a segunda campanha do mesmo produto já na segunda
-- aula de Marketing, e a aula viraria o professor mexendo em configuração.
-- Com 3 ele só mexe quando realmente quiser apertar ou afrouxar.
--
-- Soltar o `UNIQUE(promocao_id)` tem um efeito que a tela precisa acompanhar:
-- a mesma promoção passa a aceitar mais de uma arte (até estourar a cota do
-- produto). É o que dá sentido à cota — o aluno faz três versões da peça e o
-- professor escolhe qual vai para a vitrine. Sem soltar, um produto com uma
-- promoção só nunca chegaria a 2, e a cota seria decoração.
--
-- ─── PROMOÇÃO SEM PRODUTO NÃO ACEITA ARTE ──────────────────────────────────
--
-- `marketing_promocoes.produto_id` é NULÁVEL. Se a régua é por produto, arte
-- de promoção sem produto não tem unidade de contagem — e o que fica sem
-- régua vira o caminho que a turma descobre primeiro. Então recusa, com o
-- texto dizendo o que fazer.
--
-- `marketing_artes.promocao_id` já é NOT NULL, então "arte sem promoção" já
-- era impossível e continua sendo. Nada a fazer ali.
--
-- ─── POR QUE GATILHO E NÃO ÍNDICE ──────────────────────────────────────────
--
-- Na migr. 538 o índice único garantiu e o gatilho só explicou. Aqui essa
-- dupla não existe:
--
--   · índice único sabe dizer "no máximo 1", não "no máximo N";
--   · e a régua atravessa duas tabelas (a arte guarda a promoção, o produto
--     está na promoção), e índice não faz JOIN.
--
-- Configurável e garantido-por-índice são excludentes. Escolhido configurável,
-- sobra o gatilho contando — que tem a corrida de sempre: dois alunos passam
-- pela contagem antes de qualquer um gravar. Fecha com `pg_advisory_xact_lock`
-- por produto, o mesmo remédio da 481/537.
--
-- `produto_id` entra denormalizado em `marketing_artes` para a contagem não
-- precisar de JOIN a cada INSERT. A tabela já vive assim — `nome_produto`,
-- `preco_promocional` e as datas são snapshot da promoção desde a origem.
--
-- ─── UM GATILHO SÓ, PREENCHENDO E CONFERINDO ───────────────────────────────
--
-- Preencher `produto_id` e conferir a cota poderiam ser dois gatilhos, e a
-- ordem entre eles decidiria se a conferência lê o campo já preenchido ou
-- ainda nulo. Ordem de gatilho BEFORE é alfabética, o que é frágil demais
-- para uma dependência dessas. Um gatilho só, preenchendo e conferindo na
-- sequência, não tem ordem para dar errado.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. O bucket da arte
--
-- Espelha `produto-imagens` (800 KB, mesmos MIME): o pedido foi "a imagem com
-- qualidade, como está em Cadastro de Produtos". O arquivo já sobe reduzido e
-- recomprimido pelo cliente; este teto é a última linha.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('arte-imagens', 'arte-imagens', true, 819200,
        ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 819200,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp'];

DROP POLICY IF EXISTS "arte_imagens_select" ON storage.objects;
DROP POLICY IF EXISTS "arte_imagens_insert" ON storage.objects;
DROP POLICY IF EXISTS "arte_imagens_update" ON storage.objects;
DROP POLICY IF EXISTS "arte_imagens_delete" ON storage.objects;

-- Leitura livre e ANÔNIMA de propósito: o destino final desta imagem é o
-- carrossel da tela de login, que roda antes de qualquer sessão existir.
CREATE POLICY "arte_imagens_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'arte-imagens');

-- Escrita: a mesma régua da policy `artes_insert` da tabela — Marketing ou o
-- gerente da unidade (`auth_in_setor` já deixa admin e CEO passarem). O gate
-- de verdade continua sendo o RLS da linha: subir arquivo sem conseguir
-- gravar a URL na tabela não leva a lugar nenhum.
--
-- `auth_gerente_da` não dá para chamar aqui (storage.objects não tem coluna
-- `filial`), então o gerente entra pelo `role`, como na migr. 429.
CREATE POLICY "arte_imagens_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'arte-imagens'
    AND (
      public.auth_in_setor('marketing')
      OR EXISTS (SELECT 1 FROM public.user_profiles up
                  WHERE up.id = auth.uid() AND up.role IN ('admin','ceo','gerente'))
    )
  );

CREATE POLICY "arte_imagens_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'arte-imagens'
    AND (
      public.auth_in_setor('marketing')
      OR EXISTS (SELECT 1 FROM public.user_profiles up
                  WHERE up.id = auth.uid() AND up.role IN ('admin','ceo','gerente'))
    )
  );

CREATE POLICY "arte_imagens_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'arte-imagens'
    AND (
      public.auth_in_setor('marketing')
      OR EXISTS (SELECT 1 FROM public.user_profiles up
                  WHERE up.id = auth.uid() AND up.role IN ('admin','ceo','gerente'))
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. A configuração do professor
--
-- Singleton com `id = 1`, o mesmo formato de `aula_config` e `blackout_config`.
-- `max_vitrine` mora aqui junto porque quem decide os dois é a mesma pessoa,
-- na mesma conversa; quem CONSOME é que difere (a cota é sentida pelo aluno ao
-- publicar, o teto da vitrine pelo professor ao aprovar — migr. 540).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.marketing_config (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_artes_por_produto integer  NOT NULL DEFAULT 3  CHECK (max_artes_por_produto BETWEEN 1 AND 20),
  max_vitrine           integer  NOT NULL DEFAULT 12 CHECK (max_vitrine BETWEEN 1 AND 40),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_por        uuid
);

COMMENT ON TABLE public.marketing_config IS
  'Números que o professor mexe no Marketing: quantas artes por produto e '
  'quantos itens cabem no carrossel do login. Linha única (id=1). Migr. 539.';
COMMENT ON COLUMN public.marketing_config.max_artes_por_produto IS
  'Padrão 3, não 1: com 1 a segunda campanha do mesmo produto já travaria.';

INSERT INTO public.marketing_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.marketing_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_config FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.marketing_config TO authenticated;
GRANT ALL    ON TABLE public.marketing_config TO service_role;

-- Leitura para qualquer autenticado: a tela do aluno precisa do número para
-- dizer "2 de 3" ANTES de ele preencher, não só no erro depois.
DROP POLICY IF EXISTS marketing_config_read  ON public.marketing_config;
DROP POLICY IF EXISTS marketing_config_write ON public.marketing_config;

CREATE POLICY marketing_config_read ON public.marketing_config
  FOR SELECT TO authenticated USING (true);

-- Escrita só do professor. `role = 'admin'` literal, não `auth_is_admin()`,
-- que inclui CEO e conselheiro — esses são alunos, e a cota existe para
-- limitá-los.
CREATE POLICY marketing_config_write ON public.marketing_config
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. `produto_id` na arte + a cota
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.marketing_artes ADD COLUMN IF NOT EXISTS produto_id uuid;

COMMENT ON COLUMN public.marketing_artes.produto_id IS
  'Snapshot do produto da promoção (mesmo padrão de nome_produto/datas). '
  'Existe para a cota contar por produto sem JOIN a cada INSERT. Migr. 539.';

-- Backfill do que já existe, antes de qualquer régua nova entrar em vigor.
UPDATE public.marketing_artes a
   SET produto_id = mp.produto_id
  FROM public.marketing_promocoes mp
 WHERE mp.id = a.promocao_id
   AND a.produto_id IS DISTINCT FROM mp.produto_id;

CREATE INDEX IF NOT EXISTS idx_marketing_artes_produto
  ON public.marketing_artes (produto_id);

-- A UNIQUE de promoção sai: quem manda agora é a cota por produto.
ALTER TABLE public.marketing_artes DROP CONSTRAINT IF EXISTS marketing_artes_promocao_id_key;

CREATE OR REPLACE FUNCTION public.fn_arte_produto_e_cota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_produto uuid;
  v_max     integer;
  v_tem     integer;
  v_nome    text;
BEGIN
  SELECT mp.produto_id INTO v_produto
    FROM public.marketing_promocoes mp
   WHERE mp.id = NEW.promocao_id;

  IF v_produto IS NULL THEN
    RAISE EXCEPTION 'Esta promoção não aponta para nenhum produto do catálogo, e a arte é publicada por produto. Escolha o produto na promoção antes de publicar a arte.'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.produto_id := v_produto;

  -- Editar a arte (trocar a imagem, corrigir o link) não é publicar outra:
  -- se o produto não mudou, não há cota nova a consumir.
  IF TG_OP = 'UPDATE' AND OLD.produto_id IS NOT DISTINCT FROM v_produto THEN
    RETURN NEW;
  END IF;

  -- Serializa por produto: sem isto, dois alunos contam "2 de 3" ao mesmo
  -- tempo, os dois passam, e o produto termina com 4.
  PERFORM pg_advisory_xact_lock(hashtext('marketing_artes_cota'), hashtext(v_produto::text));

  SELECT COALESCE(max_artes_por_produto, 3) INTO v_max
    FROM public.marketing_config WHERE id = 1;
  v_max := COALESCE(v_max, 3);   -- linha ausente não vira ausência de régua

  SELECT count(*) INTO v_tem
    FROM public.marketing_artes a
   WHERE a.produto_id = v_produto
     AND a.id <> NEW.id;

  IF v_tem >= v_max THEN
    SELECT nome INTO v_nome FROM public.produtos WHERE id = v_produto;
    RAISE EXCEPTION
      'O produto "%" já tem % arte(s) publicada(s), que é o limite atual. Peça ao professor para aumentar em Sessões Gerais → Marketing → Configurações, ou apague uma das artes existentes.',
      COALESCE(v_nome, 'deste item'), v_tem
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_arte_produto_e_cota ON public.marketing_artes;
CREATE TRIGGER trg_arte_produto_e_cota
  BEFORE INSERT OR UPDATE ON public.marketing_artes
  FOR EACH ROW EXECUTE FUNCTION public.fn_arte_produto_e_cota();

COMMIT;

-- Verificação:
--
--   -- Bucket no ar:
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'arte-imagens';
--
--   -- A cota vigente e o que já foi usado:
--   SELECT max_artes_por_produto FROM marketing_config WHERE id = 1;
--   SELECT produto_id, count(*) FROM marketing_artes GROUP BY 1 ORDER BY 2 DESC;
--
-- TESTE MANUAL
--   aluno publica 3 artes do mesmo produto  → passa
--   publica a 4ª                            → recusa dizendo o nome e o limite
--   professor sobe o limite para 4          → a 4ª passa
--   promoção sem produto                    → recusa pedindo para escolher o produto
