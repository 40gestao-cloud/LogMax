-- 438_20260817_o_arroz_de_cinco_quilos_nao_cabia_no_cadastro.sql
--
-- UM ALUNO FOI CADASTRAR ARROZ DE 5 KG, 50 PACOTES, E NÃO CONSEGUIU.
--
-- O cadastro de produto confundia duas medidas que num supermercado nunca são
-- a mesma:
--
--   * a unidade em que o item ENTRA E SAI do estoque  → 50 pacotes = 50 UN
--   * a medida do CONTEÚDO da embalagem               → 5 KG por pacote
--
-- `ProdutosView` amarrava a segunda à primeira: o rótulo do campo Peso/Volume
-- era montado com `extras.unidade`, o seletor de unidade de estoque. Quem
-- vendia por pacote lia "Peso / Volume (UN) *" e digitava um número solto. O
-- modelo de planilha repetia a amarração ("5 para 5 KG").
--
-- O resultado está nos dados das quatro turmas, e é pior que a tela:
--
--   turma          filial/unidade   n   peso mín   peso máx
--   Aprendiz       SuperMax / UN    21     1,000    900,000
--   Aprendiz       SuperMax / L      3     2,000    500,000
--   Aprendiz       SuperMax / KG     9     1,000     35,000
--   Adm            SuperMax / UN     9     0,500    500,000
--
-- 900 num produto vendido por UN são 900 g ou 900 kg? 0,5 é meio quilo ou é
-- 500 g que alguém converteu na mão? 500 num produto vendido por L é meio
-- litro escrito em mililitro. Não há como saber — o campo nunca disse em que
-- medida estava, e a turma preencheu em três medidas diferentes na mesma coluna.
--
-- Pior ainda: `produtos.peso` não é lido por LUGAR NENHUM do sistema. Não
-- entra em etiqueta, nem em PDV, nem em relatório, nem em RPC. Era campo
-- OBRIGATÓRIO (só na SuperMax) para gravar dado ambíguo que ninguém consome.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. `peso_unidade` — o conteúdo passa a declarar sua própria medida
--
-- Coluna nova, com lista fechada em G/KG/ML/L. A partir daqui "5" nunca fica
-- sozinho: é 5 KG, e o estoque continua contando pacotes em UN.
--
-- O BACKFILL SÓ TOCA O CASO NÃO-AMBÍGUO, de propósito. Onde a unidade de
-- estoque já é a própria medida (KG, L, G, ML), o rótulo antigo dizia
-- literalmente que o peso estava naquela unidade — então herda. Onde a unidade
-- é discreta (UN, CX, PC, PCT), o valor fica com `peso_unidade` NULL: adivinhar
-- entre grama e quilo seria inventar um fato e imprimi-lo como se fosse
-- cadastro. São ~40 linhas nas quatro turmas somadas, e a tela agora mostra
-- "unidade não informada" até alguém corrigir — que é a conversa de aula que
-- este campo deveria ter provocado desde o começo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. `estoque_minimo` — de integer para numeric(15,3)
--
-- A migr. 079 passou `produtos.estoque` e `movimentacoes_estoque.qtd` para
-- numeric(15,3) justamente para a mercearia vender por peso. `estoque_minimo`
-- ficou integer desde a migr. 008 e nunca foi junto. Consequência: produto
-- vendido a KG não consegue ter mínimo de 2,5 kg — nem pelo formulário, nem
-- por SQL. O modelo de planilha promete `decimal` nos três campos de
-- quantidade, contradizendo o próprio banco.
--
-- Conferido antes de mexer: nenhum índice, coluna gerada ou trigger depende de
-- `estoque_minimo`; a única função que a lê é `criar_requisicoes_compra_lote`,
-- e o destino lá (`requisicoes.minimo_no_pedido`) já é numeric — ou seja, a
-- coluna integer estava ARREDONDANDO na saída de uma coluna que aceitava a
-- fração. Comparações `estoque <= estoque_minimo` (placar, sugestão de compra)
-- funcionam igual em numeric.
--
-- `frac_estoque` nos 4 bancos: zero produtos com saldo fracionário, inclusive
-- entre os vendidos a KG. Não é coincidência — o formulário nunca deixou.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A VIEW É DERRUBADA E RECRIADA
--
-- `produtos_com_custo` expõe `estoque_minimo`, e o Postgres não altera o tipo
-- de coluna que uma view referencia. Recriar é seguro pelos mesmos motivos
-- levantados na migr. 419, reconferidos agora nos 4 projetos:
--
--   * zero dependentes da view (pg_depend/pg_rewrite: vazio nos quatro);
--   * hash de colunas idêntico nos quatro (a80a8bbc…) — a 419 está aplicada
--     em todos, então a lista canônica abaixo vale para todos;
--   * `security_invoker` vai DENTRO do CREATE, senão a view volta a security
--     definer e o custo vaza pela RLS de `produtos_custo`;
--   * grants restaurados nominalmente, `anon` de fora como já estava;
--   * tudo em transação — a view não fica ausente para ninguém.
--
-- Esta migração SUCEDE a 419 como definição canônica: a lista ganha
-- `peso_unidade` logo depois de `peso`. Novo hash esperado ao final, igual nos
-- quatro bancos.
--
-- Não mexe em `produtos.unidade`: a turma Adm tem produtos com unidade 'RL',
-- fora de `UNIDADES_PRODUTO`. Fechar essa lista por CHECK derrubaria a
-- migração naquele banco, e a régua de unidade é assunto de outra conversa.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. Unidade do conteúdo da embalagem ─────────────────────────────────────

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS peso_unidade text;

COMMENT ON COLUMN public.produtos.peso_unidade IS
  'Medida do CONTEÚDO da embalagem (G/KG/ML/L) — independente de produtos.unidade, que é a medida de entrada/saída do estoque. Arroz 5 KG vendido em pacote: peso=5, peso_unidade=KG, unidade=UN. Vide migr. 438.';

COMMENT ON COLUMN public.produtos.peso IS
  'Quantidade do conteúdo da embalagem, na medida declarada em peso_unidade. NULL para item vendido a granel (a unidade de estoque já é a medida).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_produtos_peso_unidade') THEN
    ALTER TABLE public.produtos
      ADD CONSTRAINT chk_produtos_peso_unidade
      CHECK (peso_unidade IS NULL OR peso_unidade IN ('G', 'KG', 'ML', 'L'));
  END IF;

  -- Unidade sem valor é rótulo órfão. O inverso (peso sem unidade) continua
  -- permitido de propósito: é exatamente o estado das ~40 linhas ambíguas que
  -- o backfill abaixo se recusa a adivinhar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_produtos_peso_unidade_orfa') THEN
    ALTER TABLE public.produtos
      ADD CONSTRAINT chk_produtos_peso_unidade_orfa
      CHECK (peso IS NOT NULL OR peso_unidade IS NULL);
  END IF;
END $$;

-- Backfill do caso não-ambíguo: onde a unidade de estoque JÁ É a medida, o
-- rótulo antigo dizia que o peso estava nela. Herda. O resto fica NULL.
UPDATE public.produtos
   SET peso_unidade = upper(btrim(unidade))
 WHERE peso IS NOT NULL
   AND peso_unidade IS NULL
   AND upper(btrim(COALESCE(unidade, ''))) IN ('G', 'KG', 'ML', 'L');

-- ── 2. Mínimo fracionário ───────────────────────────────────────────────────

DROP VIEW IF EXISTS public.produtos_com_custo;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'produtos'
       AND column_name = 'estoque_minimo' AND data_type <> 'numeric'
  ) THEN
    ALTER TABLE public.produtos
      ALTER COLUMN estoque_minimo TYPE numeric(15,3) USING estoque_minimo::numeric(15,3);
  END IF;
END $$;

COMMENT ON COLUMN public.produtos.estoque_minimo IS
  'Ponto de reposição, na mesma unidade e escala de produtos.estoque (numeric 15,3 desde a migr. 438). Mercearia precisa de mínimo fracionário: 2,5 KG é um mínimo legítimo.';

-- ── 3. View canônica (sucede a lista da migr. 419) ──────────────────────────

DO $$
DECLARE
  v_faltando text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_faltando
    FROM unnest(ARRAY[
      'id','codigo','nome','categoria','estoque','preco','unidade','status','created_at',
      'ativo','estoque_minimo','ean','fornecedor','filial','imagem_url','tipo',
      'patrimonio_numero','patrimonio_responsavel','patrimonio_localizacao',
      'criado_por','atualizado_por','updated_at','elegivel_beneficios','vitrine_publica',
      'categoria_id','subcategoria_id','marca','peso','peso_unidade','atributos',
      'imagem_url_2','imagem_url_3','codigo_seq','loja_online'
    ]) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'produtos' AND column_name = c
   );

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'produtos não tem: %. Este banco divergiu do schema das outras turmas — alinhe a tabela antes de recriar a view.',
      v_faltando USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE VIEW public.produtos_com_custo
WITH (security_invoker = true) AS
  SELECT p.id,
         p.codigo,
         p.nome,
         p.categoria,
         p.estoque,
         p.preco,
         p.unidade,
         p.status,
         p.created_at,
         p.ativo,
         p.estoque_minimo,
         p.ean,
         p.fornecedor,
         p.filial,
         p.imagem_url,
         p.tipo,
         p.patrimonio_numero,
         p.patrimonio_responsavel,
         p.patrimonio_localizacao,
         p.criado_por,
         p.atualizado_por,
         p.updated_at,
         p.elegivel_beneficios,
         p.vitrine_publica,
         p.categoria_id,
         p.subcategoria_id,
         p.marca,
         p.peso,
         p.peso_unidade,
         p.atributos,
         p.imagem_url_2,
         p.imagem_url_3,
         p.codigo_seq,
         p.loja_online,
         c.preco_custo,
         c.origem              AS custo_origem,
         c.ultima_compra_em    AS custo_ultima_compra_em,
         c.ultimo_custo_compra AS custo_ultima_compra_valor
    FROM public.produtos p
    LEFT JOIN public.produtos_custo c ON c.produto_id = p.id;

COMMENT ON VIEW public.produtos_com_custo IS
  'Produtos + custo mascarado pela RLS de produtos_custo (migr. 262). Definição canônica das 4 turmas — vide migr. 438, que sucede a 419 acrescentando peso_unidade.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos_com_custo TO authenticated;
GRANT ALL                            ON public.produtos_com_custo TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência depois de rodar nos 4 — os três têm de sair iguais nos quatro:
--
--   SELECT md5(string_agg(column_name, ',' ORDER BY ordinal_position))
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'produtos_com_custo';
--
--   SELECT data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='produtos' AND column_name='estoque_minimo';
--
-- E o passivo que sobra de propósito, por turma — é a lição de casa da SuperMax:
--
--   SELECT filial, codigo, nome, unidade, peso
--     FROM produtos
--    WHERE ativo AND peso IS NOT NULL AND peso_unidade IS NULL
--    ORDER BY filial, codigo;
