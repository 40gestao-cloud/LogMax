-- 440_20260817_a_resma_de_papel_nao_e_mercadoria.sql
--
-- A SUPERMAX COMPRA RESMA DE PAPEL E O SISTEMA A PÕE NO CAIXA.
--
-- `produtos.tipo` tinha dois valores — 'estoque_venda' e 'patrimonio'. Resma de
-- papel, água para a equipe, material de limpeza, saco de lixo, embalagem e
-- cartucho de impressora não são nenhum dos dois, e os dois caminhos erram:
--
--   * como mercadoria, a resma entra na grade do PDV, no catálogo e nos
--     orçamentos — e o formulário AINDA obriga preço de venda, então o aluno
--     tem de inventar um preço para papel que a empresa não vende;
--   * como patrimônio, ela sai do PDV mas perde o saldo: patrimônio não tem
--     estoque, não se requisita ao almoxarifado e nem aparece na lista de
--     Produtos. Uma resma não é bem depreciável.
--
-- ERP real classifica o item pelo DESTINO, não pelo formato. Passa a ser:
--
--   estoque_venda  mercadoria para revenda  → PDV, catálogo, loja, vitrine
--   consumo        material de uso e consumo → estoque + requisição interna
--   patrimonio     imobilizado               → Financeiro > Patrimônio
--
-- ────────────────────────────────────────────────────────────────────────────
-- O FLUXO DE CONSUMO JÁ ESTAVA CONSTRUÍDO — FALTAVA A CLASSIFICAÇÃO
--
-- `requisicoes_estoque` + `criar_requisicao_estoque` + `liberar_requisicao_estoque`
-- fazem exatamente "setor pede material → Estoque libera → sai do saldo", com
-- aprovação e anti-privesc, gravando `movimentacoes_estoque` tipo 'Saída'
-- origem 'Requisição de Estoque'. A metade difícil existe desde a migr. 283. O
-- que não existia era o tipo de item que ela deveria movimentar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- OS FILTROS ERAM BLACKLIST — E POR ISSO O TIPO NOVO NASCERIA VENDÁVEL
--
-- Todo lugar que exclui patrimônio da venda faz `tipo <> 'patrimonio'`, nunca
-- `tipo = 'estoque_venda'`: PDVView, PDVViewSupermax, CatalogoProdutosView,
-- OrcamentosView. É a mesma forma do gatilho anti-privesc de lista fixa, e dá
-- o mesmo resultado: coisa nova nasce desprotegida. Só acrescentar 'consumo' ao
-- CHECK deixaria a resma no caixa exatamente como antes.
--
-- O front vira whitelist no mesmo commit. Mas tela não é regra, e aqui a regra
-- vai onde nada escapa:
--
--   1. `fn_item_venda_so_mercadoria` em `itens_venda` — pega TODA venda, venha
--      do `criar_venda_pdv`, do pedido de venda ou de qualquer insert futuro.
--      É por isso que não recrio a `criar_venda_pdv` (10 KB) para pôr um IF: o
--      guard no gatilho cobre caminhos que a RPC não conhece, e é o precedente
--      que `fn_valida_filial_item_venda` já abriu nesta mesma tabela.
--
--   2. `fn_produto_publicavel` em `produtos` — `loja_online` e
--      `vitrine_publica` só podem ser true em mercadoria. A loja online NÃO
--      passa por `itens_venda` (`confirmar_pedido_online` não cria item de
--      venda), então sem este segundo guard um item de consumo publicado seria
--      pedido e confirmado sem cruzar o primeiro.
--
--   3. `get_vitrine_publica` ganha o filtro de tipo. A RPC selecionava de
--      `produtos WHERE vitrine_publica = true AND imagem_url IS NOT NULL`, sem
--      olhar tipo nenhum: um patrimônio com foto e a flag ligada aparecia na
--      vitrine PÚBLICA, para anônimo. Hoje não há linha nesse estado nas 4
--      turmas (conferido), e é agora que deixa de poder haver.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRAÇÃO **NÃO** FAZ, DE PROPÓSITO
--
-- Não mexe no DRE. Hoje a compra de material de consumo desaparece do
-- resultado: a conta a pagar tem `pedido_id`, e a migr. 425 exclui essas contas
-- das despesas (`AND cp.pedido_id IS NULL`) porque compra de mercadoria vira
-- CMV na venda. Só que a resma nunca é vendida — então não vira CMV, e o
-- dinheiro não aparece em lugar nenhum. Classificar o item é o pré-requisito
-- para consertar isso, não o conserto: **o buraco continua aberto depois desta
-- migração**, do mesmo tamanho que estava. A política (despesa na compra ×
-- despesa no consumo, valorizada pelo custo médio no centro de custo de quem
-- pediu) fica para migração própria, decidida com calma.
--
-- Não converte nenhum produto existente para 'consumo'. Não há como o banco
-- saber que "Papel A4" é consumo e "Arroz 5kg" é mercadoria — quem sabe é a
-- turma, item por item, e reclassificar por adivinhação de nome tiraria
-- mercadoria do PDV sem aviso.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende de 438 e 439 estarem aplicadas.

BEGIN;

-- ── 1. O terceiro tipo ──────────────────────────────────────────────────────

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_tipo;

ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_tipo
  CHECK (tipo IN ('estoque_venda', 'consumo', 'patrimonio'));

COMMENT ON COLUMN public.produtos.tipo IS
  'Destino do item (migr. 440). estoque_venda = mercadoria para revenda, a única vendável. consumo = material de uso e consumo (resma, água, limpeza): tem estoque e sai por requisição interna, nunca pelo PDV. patrimonio = imobilizado, gerido em Financeiro > Patrimônio.';

-- Higiene defensiva: nas 4 turmas não há hoje item não-vendável marcado para
-- loja ou vitrine (conferido), mas se houver em turma nova o gatilho abaixo
-- travaria o próximo UPDATE dela sem que ninguém entendesse o motivo.
UPDATE public.produtos
   SET loja_online = false, vitrine_publica = false
 WHERE COALESCE(tipo, 'estoque_venda') <> 'estoque_venda'
   AND (COALESCE(loja_online, false) OR COALESCE(vitrine_publica, false));

-- ── 2. Só mercadoria é vendável ─────────────────────────────────────────────
--
-- Mesma forma de `fn_valida_filial_item_venda`, que já guarda esta tabela: a
-- regra que precisa valer em toda venda mora no gatilho, não na RPC.

CREATE OR REPLACE FUNCTION public.fn_item_venda_so_mercadoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text;
  v_nome text;
BEGIN
  IF NEW.produto_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tipo, nome INTO v_tipo, v_nome
    FROM public.produtos WHERE id = NEW.produto_id;

  -- Produto sem tipo é legado de antes da coluna existir: vale como mercadoria,
  -- que é o que ele sempre foi na prática.
  IF COALESCE(v_tipo, 'estoque_venda') = 'estoque_venda' THEN
    RETURN NEW;
  END IF;

  IF v_tipo = 'consumo' THEN
    RAISE EXCEPTION
      '"%" é material de uso e consumo, não mercadoria — não se vende. Para tirar do estoque, use Estoque > Requisições de Material.',
      COALESCE(v_nome, NEW.nome_produto) USING ERRCODE = 'P0001';
  END IF;

  RAISE EXCEPTION
    '"%" é patrimônio da empresa — não está à venda. Baixa de bem se faz em Financeiro > Patrimônio.',
    COALESCE(v_nome, NEW.nome_produto) USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS trg_item_venda_so_mercadoria ON public.itens_venda;
CREATE TRIGGER trg_item_venda_so_mercadoria
  BEFORE INSERT OR UPDATE OF produto_id ON public.itens_venda
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_venda_so_mercadoria();

-- ── 3. Só mercadoria vai para a loja e para a vitrine ───────────────────────
--
-- Gatilho separado do `produto_loja_online_guard` de propósito: aquele responde
-- "QUEM pode publicar" (autoridade) e é BEFORE UPDATE; este responde "O QUE
-- pode ser publicado" (natureza do item) e precisa valer no INSERT também.
-- Misturar as duas regras num gatilho faria a checagem de autoridade passar a
-- rodar no INSERT como efeito colateral, o que é mudança de RBAC e não é o
-- assunto desta migração.

CREATE OR REPLACE FUNCTION public.fn_produto_publicavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.tipo, 'estoque_venda') = 'estoque_venda' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.loja_online, false) OR COALESCE(NEW.vitrine_publica, false) THEN
    RAISE EXCEPTION
      '"%" não é mercadoria para revenda (tipo: %) — não entra na loja online nem na vitrine pública.',
      NEW.nome, NEW.tipo USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_produto_publicavel ON public.produtos;
CREATE TRIGGER trg_produto_publicavel
  BEFORE INSERT OR UPDATE OF tipo, loja_online, vitrine_publica ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_publicavel();

-- ── 4. A vitrine pública passa a olhar o tipo ───────────────────────────────
--
-- Cópia fiel do que está no banco, com uma linha a mais no WHERE de `prods`.
-- Continua SECURITY DEFINER (a vitrine é lida por anônimo, sem RLS que ajude) e
-- os grants não mudam.

CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH artes AS (
    SELECT
      'arte'::text                                                              AS tipo,
      a.id::text                                                                AS id,
      a.nome_produto                                                            AS titulo,
      a.descricao_promocao                                                      AS descricao,
      COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url)                      AS imagem_url,
      a.preco_promocional,
      a.data_inicio,
      a.data_fim,
      a.created_at
    FROM public.marketing_artes a
    LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
    LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
    WHERE a.vitrine_publica = true
      AND COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      AND COALESCE(a.data_fim, public.acre_today() + 30) >= public.acre_today()
    ORDER BY a.created_at DESC
    LIMIT 12
  ),
  prods AS (
    SELECT
      'produto'::text   AS tipo,
      id::text          AS id,
      nome              AS titulo,
      categoria         AS descricao,
      imagem_url,
      preco             AS preco_promocional,
      NULL::date        AS data_inicio,
      NULL::date        AS data_fim,
      created_at
    FROM public.produtos
    WHERE vitrine_publica = true
      AND imagem_url IS NOT NULL
      AND COALESCE(status, 'Ativo') = 'Ativo'
      AND COALESCE(ativo,  true)    = true
      -- Migr. 440. Faltava: patrimônio ou material de consumo com foto e a flag
      -- ligada aparecia na vitrine pública, para visitante anônimo.
      AND COALESCE(tipo, 'estoque_venda') = 'estoque_venda'
    ORDER BY created_at DESC
    LIMIT 12
  ),
  combined AS (
    SELECT * FROM artes
    UNION ALL
    SELECT * FROM prods
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(combined) ORDER BY combined.created_at DESC),
    '[]'::jsonb
  )
  FROM combined;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência depois de rodar nos 4:
--
--   -- 1. o CHECK aceita os três
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.produtos'::regclass AND conname = 'chk_produtos_tipo';
--
--   -- 2. os dois gatilhos existem
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid IN ('public.itens_venda'::regclass, 'public.produtos'::regclass)
--      AND tgname IN ('trg_item_venda_so_mercadoria', 'trg_produto_publicavel');
--
--   -- 3. nada não-vendável ficou publicado
--   SELECT count(*) FROM produtos
--    WHERE COALESCE(tipo,'estoque_venda') <> 'estoque_venda'
--      AND (COALESCE(loja_online,false) OR COALESCE(vitrine_publica,false));
--
-- E o teste que vale a aula: cadastrar "Papel A4 75g — resma" como Uso e
-- Consumo, tentar vender no PDV (a tela não oferece; via SQL o gatilho recusa),
-- e tirar do estoque por Estoque > Requisições de Material.
