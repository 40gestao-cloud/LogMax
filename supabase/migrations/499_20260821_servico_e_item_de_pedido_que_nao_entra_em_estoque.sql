-- 499_20260821_servico_e_item_de_pedido_que_nao_entra_em_estoque.sql
--
-- Fecha o beco sem saída da compra eventual de SERVIÇO, achado na auditoria dos
-- fluxos de requisição (2026-08-21).
--
-- ── O beco ──────────────────────────────────────────────────────────────────
-- A requisição sempre soube pedir serviço: `unidadesDeRequisicao()` oferece a
-- unidade SV, e o comentário em src/lib/unidades.ts é explícito — "só a
-- requisição pede serviço — produto é sempre coisa". Manutenção do ar, frete,
-- licença, dedetização: tudo isso é compra eventual legítima.
--
-- Só que a migr. 480 passou a exigir `produtos.id` no pedido. Então a
-- requisição de serviço é cotável, é aprovável pelo Financeiro — e trava no
-- Gerar Pedido, sem saída nenhuma na tela: o catálogo de produto não tem
-- unidade SV nem tipo "serviço", e o cadastro de `servicos`, que existe desde o
-- começo, o pedido não sabia apontar.
--
-- ── Como ERP de verdade resolve ─────────────────────────────────────────────
-- Não transformando serviço em produto. Serviço é OUTRA CATEGORIA DE ITEM do
-- pedido — o item D do SAP (com folha de medição, ML81N) contra o item M de
-- material; no Protheus, a mesma separação entre SB1 de mercadoria e o de
-- serviço. As consequências vêm de graça e são as certas:
--
--   • serviço NÃO tem saldo, lote, validade nem número de série;
--   • o "recebimento" de serviço é ACEITE (a folha de medição): confirma que
--     foi executado, libera o pagamento e NÃO mexe em estoque;
--   • serviço nunca vira CMV: ele é DESPESA do período, classificada pelo
--     centro de custo. Mercadoria vira estoque e só depois CMV, na venda.
--
-- É isto que esta migração escreve.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
-- 1. `pedidos.servico_id` e `requisicoes.servico_id`, com CHECK impedindo que a
--    linha aponte para produto E serviço ao mesmo tempo (a categoria é uma só).
--    Nenhum dos dois é obrigatório: pedido antigo não tem nenhum, e forçar
--    agora derrubaria o ciclo no meio.
-- 2. `gerar_pedido_de_cotacao` ganha `p_servico_id` e passa a exigir UM dos
--    dois. A mensagem de recusa fala a língua do que a requisição pediu: se a
--    unidade é SV, ela manda cadastrar em Cadastros > Serviços, não Produtos.
--    O vínculo é gravado também na requisição, como a 480 já fazia — a próxima
--    contratação do mesmo serviço nasce amarrada.
-- 3. Trava de banco: movimentação de estoque com `recebimento_id` de pedido de
--    serviço é recusada. A tela não vai tentar, mas serviço que entra no saldo
--    é estoque fantasma que ninguém consegue explicar depois.
-- 4. DRE: a despesa excluía TODA conta a pagar com `pedido_id` — regra certa
--    para mercadoria (que vira estoque e só depois CMV), errada para serviço,
--    que nunca vira estoque. Contratação de serviço volta a aparecer como
--    despesa, no grupo do centro de custo.
--
-- A alteração do DRE é feita por regexp sobre `pg_get_functiondef`, e não
-- transcrevendo a função inteira: são 4,6 KB de conta e a régua do projeto é
-- copiar do banco. Uma linha muda, e a trava aborta se o texto não mudar.


BEGIN;

-- ── 1. A categoria do item ──────────────────────────────────────────────────

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS servico_id uuid REFERENCES public.servicos(id);

ALTER TABLE public.requisicoes
  ADD COLUMN IF NOT EXISTS servico_id uuid REFERENCES public.servicos(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pedidos_item_produto_ou_servico') THEN
    ALTER TABLE public.pedidos
      ADD CONSTRAINT chk_pedidos_item_produto_ou_servico
      CHECK (produto_id IS NULL OR servico_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_requisicoes_item_produto_ou_servico') THEN
    ALTER TABLE public.requisicoes
      ADD CONSTRAINT chk_requisicoes_item_produto_ou_servico
      CHECK (produto_id IS NULL OR servico_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pedidos_servico_id
  ON public.pedidos (servico_id) WHERE servico_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requisicoes_servico_id
  ON public.requisicoes (servico_id) WHERE servico_id IS NOT NULL;

COMMENT ON COLUMN public.pedidos.servico_id IS
  'Serviço contratado. Excludente com produto_id: a linha é material OU serviço, nunca os dois. Serviço não tem saldo — o recebimento dele é aceite, e o custo é despesa do período, não estoque. Migr. 499.';
COMMENT ON COLUMN public.requisicoes.servico_id IS
  'Serviço do catálogo ao qual a requisição foi amarrada por quem compra. Gêmea de produto_id (migr. 480/499).';

-- ── 2. O pedido aceita as duas categorias ───────────────────────────────────
DROP FUNCTION IF EXISTS public.gerar_pedido_de_cotacao(uuid, uuid);

CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(
  p_cotacao_id uuid,
  -- Lidos só quando a requisição não trouxe o vínculo. Defaults nulos mantêm a
  -- chamada de um argumento válida para a Reposição.
  p_produto_id uuid DEFAULT NULL,
  p_servico_id uuid DEFAULT NULL
)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cot        public.cotacoes;
  v_req        public.requisicoes;
  v_pedido     public.pedidos;
  v_prazo      date;
  v_prazo_forn integer;
  v_vencimento date;
  v_produto_id uuid;
  v_servico_id uuid;
  v_prod       public.produtos;
  v_serv       public.servicos;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_cotacao_id FOR UPDATE;

  IF v_cot.id IS NULL THEN
    RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- COALESCE porque `auth_pode_filial` devolve NULL para conta sem filial
  -- (migr. 411/495), e `IF NOT NULL` não entra no bloco.
  IF NOT COALESCE(public.auth_pode_filial(v_cot.filial), false) THEN
    RAISE EXCEPTION 'Cotação de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_cot.ativo IS NOT TRUE OR v_cot.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só cotação aprovada e ativa gera pedido (status atual: %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pedidos WHERE cotacao_id = v_cot.id AND ativo) THEN
    RAISE EXCEPTION 'Esta cotação já tem pedido gerado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cot.requisicao_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.pedidos WHERE requisicao_id = v_cot.requisicao_id AND ativo
     ) THEN
    RAISE EXCEPTION 'Esta requisição já foi atendida por outro pedido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = v_cot.requisicao_id;

  -- ── O vínculo com o catálogo ──────────────────────────────────────────────
  -- Reposição já vem resolvida da requisição. Eventual depende do comprador —
  -- que agora escolhe a CATEGORIA: material ou serviço.
  v_produto_id := COALESCE(v_req.produto_id, p_produto_id);
  v_servico_id := COALESCE(v_req.servico_id, p_servico_id);

  IF v_produto_id IS NOT NULL AND v_servico_id IS NOT NULL THEN
    RAISE EXCEPTION 'O pedido é de um produto OU de um serviço, não dos dois.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_produto_id IS NULL AND v_servico_id IS NULL THEN
    -- A mensagem fala a língua do que foi pedido: unidade SV é serviço, e
    -- mandar cadastrar produto ali é o que fazia o aluno criar "Manutenção do
    -- ar-condicionado" como mercadoria de estoque.
    IF upper(COALESCE(v_req.unidade, '')) = 'SV' THEN
      RAISE EXCEPTION
        'O pedido precisa apontar para um serviço do catálogo. Diga qual serviço é "%" — ou cadastre-o em Cadastros > Serviços e gere o pedido de novo.',
        COALESCE(v_req.item, 'este item')
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION
      'O pedido precisa apontar para um item do catálogo. Escolha qual produto é "%" — ou, se for contratação de serviço, escolha o serviço. Não achou? Cadastre em Cadastros > Produtos (ou > Serviços) e gere o pedido de novo.',
      COALESCE(v_req.item, 'este item')
      USING ERRCODE = 'P0001';
  END IF;

  IF v_produto_id IS NOT NULL THEN
    SELECT * INTO v_prod FROM public.produtos WHERE id = v_produto_id;
    IF v_prod.id IS NULL OR v_prod.ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'Produto não encontrado ou inativo.' USING ERRCODE = 'P0001';
    END IF;
    -- Catálogo é por unidade: comprar contra o produto da vizinha faria a
    -- entrada do recebimento mexer no estoque dela.
    IF v_prod.filial IS DISTINCT FROM v_cot.filial THEN
      RAISE EXCEPTION 'O produto "%" é do catálogo da %, e este pedido é da %.',
        v_prod.nome, v_prod.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO v_serv FROM public.servicos WHERE id = v_servico_id;
    IF v_serv.id IS NULL OR v_serv.ativo IS NOT TRUE OR COALESCE(v_serv.status, 'Ativo') = 'Inativo' THEN
      RAISE EXCEPTION 'Serviço não encontrado ou inativo.' USING ERRCODE = 'P0001';
    END IF;
    -- `servicos.filial` é nulável: serviço cadastrado sem unidade vale para
    -- todas (é o caso do que a holding contrata). Com unidade, vale a régua do
    -- produto.
    IF v_serv.filial IS NOT NULL AND v_serv.filial <> v_cot.filial THEN
      RAISE EXCEPTION 'O serviço "%" é do catálogo da %, e este pedido é da %.',
        v_serv.nome, v_serv.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- O comprador normalizou um texto livre: a requisição passa a saber de qual
  -- item ela estava falando. É o que faz a próxima compra do mesmo item nascer
  -- como Reposição (ou já amarrada ao serviço), sem ninguém redigitar nome.
  IF v_req.id IS NOT NULL AND v_req.produto_id IS NULL AND v_req.servico_id IS NULL THEN
    UPDATE public.requisicoes
       SET produto_id = v_produto_id, servico_id = v_servico_id
     WHERE id = v_req.id;
  END IF;

  v_prazo := CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
                  THEN v_cot.prazo_entrega::date END;

  -- Cotação sem data prometida: usa o prazo médio do fornecedor.
  IF v_prazo IS NULL AND v_cot.fornecedor_id IS NOT NULL THEN
    SELECT prazo_entrega_dias INTO v_prazo_forn
      FROM public.fornecedores WHERE id = v_cot.fornecedor_id;
    IF COALESCE(v_prazo_forn, 0) > 0 THEN
      v_prazo := public.acre_today() + v_prazo_forn;
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd, produto_id, servico_id
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd,
    v_produto_id, v_servico_id
  )
  RETURNING * INTO v_pedido;

  IF v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.requisicoes SET status = 'Atendida'
     WHERE id = v_cot.requisicao_id AND status = 'Aprovado';
  END IF;

  -- +30 dias quando a cotação não trouxe prazo — a conta precisa de vencimento.
  v_vencimento := COALESCE(v_prazo, public.acre_today() + 30);

  INSERT INTO public.contas_pagar (
    fornecedor_id, descricao, valor, vencimento, status, pedido_id, filial
  ) VALUES (
    v_cot.fornecedor_id,
    COALESCE(v_pedido.numero, 'Pedido #' || upper(right(v_pedido.id::text, 6)))
      || ' — ' || COALESCE(v_req.item, 'Compra')
      || COALESCE(' (' || v_req.numero || ')', ''),
    v_cot.valor_total, v_vencimento, 'Pendente', v_pedido.id, v_cot.filial
  );

  RETURN v_pedido;
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_pedido_de_cotacao(uuid, uuid, uuid) TO authenticated, service_role;

-- ── 3. Serviço não entra em estoque ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_movimentacao_servico_nao_tem_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_serv uuid;
BEGIN
  IF NEW.recebimento_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.servico_id INTO v_serv
    FROM public.recebimentos r
    JOIN public.pedidos p ON p.id = r.pedido_id
   WHERE r.id = NEW.recebimento_id;

  IF v_serv IS NOT NULL THEN
    RAISE EXCEPTION 'Serviço não tem saldo de estoque — o recebimento dele é o aceite da execução, e não gera entrada.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mov_servico_nao_tem_saldo ON public.movimentacoes_estoque;
CREATE TRIGGER trg_mov_servico_nao_tem_saldo
  BEFORE INSERT ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_movimentacao_servico_nao_tem_saldo();

-- ── 4. DRE: serviço é despesa, mercadoria não ───────────────────────────────
-- Cirúrgico sobre a função vigente. `AND cp.pedido_id IS NULL` excluía TODA
-- conta ligada a pedido — certo para mercadoria (que entra no estoque e vira
-- CMV na venda), errado para serviço, que nunca vira estoque e por isso some
-- do resultado sem aparecer em lugar nenhum.
DO $migracao$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'gerar_dre';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 499: gerar_dre não existe neste projeto.';
  END IF;

  -- Já corrigida (re-execução): segue.
  IF v_def ~ 'servico_id IS NOT NULL' THEN
    RAISE NOTICE 'MIGR 499: gerar_dre já considera serviço — nada a fazer.';
    RETURN;
  END IF;

  v_novo := replace(
    v_def,
    'AND cp.pedido_id IS NULL',
    'AND (cp.pedido_id IS NULL'
      || ' OR EXISTS (SELECT 1 FROM public.pedidos pse'
      || ' WHERE pse.id = cp.pedido_id AND pse.servico_id IS NOT NULL))');

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'MIGR 499: a linha "AND cp.pedido_id IS NULL" não foi encontrada em gerar_dre — abortando em vez de recriar a função como estava.';
  END IF;

  EXECUTE v_novo;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'gerar_pedido_de_cotacao';
--   -- espera UMA linha: gerar_pedido_de_cotacao(uuid,uuid,uuid)
--
--   SELECT prosrc ~ 'servico_id IS NOT NULL' FROM pg_proc WHERE proname = 'gerar_dre';
--   -- true
--
-- TESTE MANUAL (compra eventual de serviço):
--   Requisições > Do Setor > Eventual, item "Manutenção do ar-condicionado",
--     unidade SV → cotar → aprovar no Financeiro → Gerar Pedido: a tela pede o
--     SERVIÇO do catálogo, não o produto.
--   Recebimento desse pedido → Confirmar é o ACEITE: não pede produto, não pede
--     lote/IMEI, não mexe no estoque, e libera o pagamento.
--   Financeiro > DRE do período → o valor aparece em despesas, no grupo do
--     centro de custo (mercadoria continua fora, como deve).
-- ════════════════════════════════════════════════════════════════════════════
