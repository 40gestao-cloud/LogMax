-- 445_20260817_a_camiseta_p_e_a_camiseta_g_sao_a_mesma_camiseta.sql
--
-- NA MAXLOOK, CADA VARIANTE ERA UM PRODUTO INTEIRO.
--
-- `tamanho` e `cor` são obrigatórios na ficha (migr. 360) e o índice único é
-- `(filial, codigo)`. Some as duas coisas e cada combinação vira um cadastro
-- do zero: camiseta P/M/G em 2 cores = 6 produtos, 6 códigos, 6 fichas, até 18
-- fotos — e 6 etiquetas idênticas, porque a etiqueta imprime nome e preço e
-- não sabe de tamanho nem de cor. Uma loja de roupa de verdade cadastra o
-- MODELO e abre a GRADE.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE MUDA, E O QUE DE PROPÓSITO NÃO MUDA
--
-- Não vira tabela de variantes. A variante continua sendo uma linha de
-- `produtos` — e isso é decisão, não preguiça: estoque, PDV, CMV (425), custo
-- médio (417), FEFO (424), etiqueta e loja online todos operam sobre
-- `produtos.id`. Mover a variante para outra tabela seria reescrever os sete
-- ao mesmo tempo, no meio do curso, para chegar ao mesmo lugar.
--
-- O que faltava era o AGRUPAMENTO e a GERAÇÃO:
--
--   `modelo_codigo`  liga as variantes do mesmo modelo. NULL = produto avulso,
--                    que é o caso da mercearia e da TechMax.
--   `gerar_grade_variantes` abre a grade a partir de um produto já cadastrado:
--                    combina tamanhos × cores, copia a ficha, o preço, o custo
--                    e as fotos, e cria só o que falta.
--
-- Assim o aluno cadastra a camiseta UMA vez, marca P/M/G × Preto/Branco e
-- recebe as 6 variantes prontas — com código próprio, saldo próprio e etiqueta
-- que diz qual é qual.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DECISÕES DA GERAÇÃO
--
-- * **Saldo NÃO é copiado.** A variante nasce com estoque 0. Copiar o saldo do
--   modelo criaria mercadoria do nada — o oposto do que a 417 e a 425 fizeram
--   ao exigir que estoque venha de compra.
-- * **Cada variante ganha EAN próprio, interno.** Copiar o do modelo faria o
--   PDV vender o tamanho errado; deixar vazio esbarraria na obrigatoriedade da
--   migr. 443. Sai um EAN-13 de prefixo 2 (`ean13_interno`), que é o que a GS1
--   reserva para uso da loja — e é o que torna a etiqueta de cada tamanho
--   distinta de verdade, não só no papel.
-- * **A base é renomeada junto.** O produto de partida é uma variante como as
--   outras; sem o sufixo, "Camiseta Básica" e "Camiseta Básica — M / Preto"
--   conviveriam na mesma grade e ninguém saberia o que é a primeira.
-- * **Só cria o que falta.** Rodar de novo depois de acrescentar uma cor abre
--   as combinações novas e não toca nas existentes — é o caminho normal de uso
--   (a coleção chega em duas remessas), não um caso de borda.
-- * **`loja_online` e `vitrine_publica` nascem desligados** nas variantes.
--   Publicar é ato com dono (migr. 443) e não se herda por cópia.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 443 (`ean13_interno`).

BEGIN;

-- ── 1. O laço entre as variantes ────────────────────────────────────────────

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS modelo_codigo text;

COMMENT ON COLUMN public.produtos.modelo_codigo IS
  'Código do MODELO a que esta variante pertence (migr. 445). NULL = produto avulso. Duas linhas com o mesmo modelo_codigo na mesma filial são tamanhos/cores do mesmo produto.';

CREATE INDEX IF NOT EXISTS idx_produtos_modelo
  ON public.produtos (filial, modelo_codigo) WHERE modelo_codigo IS NOT NULL;

-- Duas variantes P/Preto do mesmo modelo é erro de cadastro, sempre: uma das
-- duas some do estoque de quem procura e vira saldo fantasma.
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_variante
  ON public.produtos (
    filial,
    modelo_codigo,
    lower(btrim(COALESCE(atributos ->> 'tamanho', ''))),
    lower(btrim(COALESCE(atributos ->> 'cor', '')))
  )
  WHERE ativo = true AND modelo_codigo IS NOT NULL;

-- ── 2. A geração da grade ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gerar_grade_variantes(
  p_produto_id uuid,
  p_tamanhos   text[],
  p_cores      text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_base     public.produtos;
  v_custo    numeric(15,4);
  v_modelo   text;
  v_nome     text;
  v_tam      text;
  v_cor      text;
  v_codigo   text;
  v_seq      int;
  v_novo_id  uuid;
  v_criadas  int := 0;
  v_tams     text[];
  v_cores    text[];
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_base FROM public.produtos WHERE id = p_produto_id;
  IF v_base.id IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_base.filial), false) THEN
    RAISE EXCEPTION 'Produto de outra filial.' USING ERRCODE = '42501';
  END IF;
  -- Mesma autoridade de quem cadastra produto: a policy de INSERT de `produtos`
  -- é da filial, e esta RPC é SECURITY DEFINER — sem esta linha ela seria uma
  -- porta mais larga que a tela.
  IF NOT COALESCE(
       public.auth_is_admin()
       OR public.auth_in_setor('compras', 'logistica', 'estoque')
       OR public.auth_gerente_da(v_base.filial), false) THEN
    RAISE EXCEPTION 'Abrir grade é de quem cadastra produto: compras, logística, estoque ou o gerente da filial.'
      USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_base.tipo, 'estoque_venda') <> 'estoque_venda' THEN
    RAISE EXCEPTION 'Grade é de mercadoria. Patrimônio e material de consumo não têm tamanho e cor.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Limpeza das listas: vazio fora, repetido fora, espaço fora. A grade vem de
  -- campo digitado, e "P, M, G, " tem quatro itens se ninguém olhar.
  SELECT array_agg(t ORDER BY ord) INTO v_tams FROM (
    SELECT DISTINCT ON (upper(btrim(u))) btrim(u) AS t, ord
      FROM unnest(COALESCE(p_tamanhos, ARRAY[]::text[])) WITH ORDINALITY AS x(u, ord)
     WHERE btrim(u) <> ''
     ORDER BY upper(btrim(u)), ord
  ) s;
  SELECT array_agg(c ORDER BY ord) INTO v_cores FROM (
    SELECT DISTINCT ON (upper(btrim(u))) btrim(u) AS c, ord
      FROM unnest(COALESCE(p_cores, ARRAY[]::text[])) WITH ORDINALITY AS x(u, ord)
     WHERE btrim(u) <> ''
     ORDER BY upper(btrim(u)), ord
  ) s;

  IF v_tams IS NULL OR v_cores IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um tamanho e uma cor.' USING ERRCODE = 'P0001';
  END IF;

  v_modelo := COALESCE(NULLIF(btrim(v_base.modelo_codigo), ''), v_base.codigo);

  -- Nome do modelo = nome da base sem o sufixo de variante, para a segunda
  -- rodada não produzir "Camiseta — M / Preto — G / Branco".
  v_nome := btrim(split_part(v_base.nome, ' — ', 1));

  SELECT preco_custo INTO v_custo FROM public.produtos_custo WHERE produto_id = v_base.id;

  -- Ponto de partida da numeração: o maior código da filial. `codigo_seq` é a
  -- parte numérica de `codigo` (coluna gerada da migr. 265), que existe
  -- justamente porque a base tem código com e sem padding.
  SELECT COALESCE(MAX(codigo_seq), 0) INTO v_seq
    FROM public.produtos WHERE ativo = true AND filial = v_base.filial;

  -- A base entra na grade como as outras.
  UPDATE public.produtos
     SET modelo_codigo = v_modelo,
         nome = v_nome || ' — '
                || COALESCE(NULLIF(btrim(atributos ->> 'tamanho'), ''), '?') || ' / '
                || COALESCE(NULLIF(btrim(atributos ->> 'cor'), ''), '?')
   WHERE id = v_base.id;

  FOREACH v_tam IN ARRAY v_tams LOOP
    FOREACH v_cor IN ARRAY v_cores LOOP
      -- Já existe (inclusive a própria base)? Não toca.
      IF EXISTS (
        SELECT 1 FROM public.produtos
         WHERE ativo = true
           AND filial = v_base.filial
           AND modelo_codigo = v_modelo
           AND lower(btrim(COALESCE(atributos ->> 'tamanho', ''))) = lower(v_tam)
           AND lower(btrim(COALESCE(atributos ->> 'cor', '')))     = lower(v_cor)
      ) THEN
        CONTINUE;
      END IF;

      -- Código só numérico, sequencial dentro da filial — o mesmo padrão do
      -- botão "Gerar" do cadastro. Nada de sufixo de tamanho/cor no código: o
      -- que distingue a variante é a ficha, e código que carrega atributo
      -- envelhece mal (a peça muda de cor no ano seguinte e o código mente).
      -- Pula o que já estiver ocupado em vez de estourar o índice único e
      -- derrubar a grade inteira.
      LOOP
        v_seq    := v_seq + 1;
        v_codigo := lpad(v_seq::text, 3, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.produtos
           WHERE ativo = true AND filial = v_base.filial AND codigo = v_codigo
        );
      END LOOP;

      INSERT INTO public.produtos (
        codigo, nome, estoque, preco, unidade, status, categoria, estoque_minimo,
        fornecedor, filial, imagem_url, imagem_url_2, imagem_url_3, tipo,
        elegivel_beneficios, categoria_id, subcategoria_id, marca, peso,
        peso_unidade, atributos, modelo_codigo,
        -- Publicar é ato com dono (443): a variante nasce fora da loja e fora
        -- da vitrine, mesmo que o modelo esteja publicado.
        loja_online, vitrine_publica,
        -- Saldo não se copia; o EAN não se copia e sim se cria. Ver cabeçalho.
        ean
      ) VALUES (
        v_codigo,
        v_nome || ' — ' || v_tam || ' / ' || v_cor,
        0,
        v_base.preco, v_base.unidade, COALESCE(v_base.status, 'Ativo'), v_base.categoria,
        v_base.estoque_minimo, v_base.fornecedor, v_base.filial,
        v_base.imagem_url, v_base.imagem_url_2, v_base.imagem_url_3,
        v_base.tipo, COALESCE(v_base.elegivel_beneficios, false),
        v_base.categoria_id, v_base.subcategoria_id, v_base.marca, v_base.peso,
        v_base.peso_unidade,
        COALESCE(v_base.atributos, '{}'::jsonb)
          || jsonb_build_object('tamanho', v_tam, 'cor', v_cor),
        v_modelo,
        false, false,
        public.ean13_interno()
      )
      RETURNING id INTO v_novo_id;

      -- O custo acompanha o modelo: é a mesma peça em outro tamanho, e sem isto
      -- a variante entraria no CMV por zero até a primeira compra.
      IF v_custo IS NOT NULL THEN
        INSERT INTO public.produtos_custo (produto_id, preco_custo, origem, updated_at)
        VALUES (v_novo_id, v_custo, 'grade', now())
        ON CONFLICT (produto_id) DO NOTHING;
      END IF;

      v_criadas := v_criadas + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'modelo_codigo', v_modelo,
    'criadas',       v_criadas,
    'combinacoes',   array_length(v_tams, 1) * array_length(v_cores, 1)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_grade_variantes(uuid, text[], text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gerar_grade_variantes(uuid, text[], text[]) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. coluna e índices
--   SELECT indexname FROM pg_indexes WHERE schemaname='public'
--    AND tablename='produtos' AND indexname IN ('idx_produtos_modelo','uq_produtos_variante');
--
--   -- 2. nenhuma grade duplicada nasceu
--   SELECT filial, modelo_codigo, atributos->>'tamanho' AS tam, atributos->>'cor' AS cor, count(*)
--     FROM produtos WHERE ativo AND modelo_codigo IS NOT NULL
--    GROUP BY 1,2,3,4 HAVING count(*) > 1;
--
--   -- 3. a grade de um modelo
--   SELECT codigo, nome, estoque, preco FROM produtos
--    WHERE ativo AND modelo_codigo = 'CAM-001' ORDER BY codigo;
--
-- E o teste que vale a aula: cadastrar "Camiseta Básica" P/Preto na MaxLook,
-- abrir a grade com P,M,G × Preto,Branco e conferir que saíram 6 variantes,
-- cada uma com código próprio, saldo zero e etiqueta que diz o tamanho.
-- =================================================================
