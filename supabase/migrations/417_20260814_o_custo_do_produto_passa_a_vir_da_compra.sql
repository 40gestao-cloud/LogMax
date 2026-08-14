-- 417_20260814_o_custo_do_produto_passa_a_vir_da_compra.sql
--
-- O CICLO COMPRA → CUSTO → PREÇO → MARGEM ESTAVA CORTADO NO MEIO.
--
-- `produtos_custo.preco_custo` só muda quando alguém digita em Cadastros →
-- Produtos. O Recebimento — que é onde a mercadoria de fato entra, pelo valor
-- que o fornecedor cobrou — não encosta nele. Resultado: a turma cota três
-- fornecedores, aprova o mais barato, recebe a carga… e a margem que o
-- Catálogo mostra continua sendo a do número que alguém chutou no cadastro.
-- A cotação não realimenta nada, e qualquer DRE futuro nasceria com um CMV de
-- mentira.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MÉDIA PONDERADA MÓVEL, QUE É COMO O VAREJO FAZ
--
-- Não basta sobrescrever o custo pelo da última nota. Se há 100 unidades a
-- R$ 10 no estoque e chegam 20 a R$ 13, o custo da casa não virou R$ 13 —
-- virou R$ 10,50:
--
--     (100 × 10,00 + 20 × 13,00) / 120 = 10,50
--
-- É esse número que serve para precificar e para apurar resultado. O custo da
-- última compra fica guardado à parte (`ultimo_custo_compra`), porque é o que
-- o comprador olha para saber se o fornecedor subiu o preço.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONDE A CONTA ACONTECE
--
-- Trigger BEFORE INSERT em `movimentacoes_estoque`. O saldo do produto é
-- atualizado por `trg_atualiza_estoque`, que é AFTER INSERT — então no BEFORE
-- o `produtos.estoque` ainda é o de antes da entrada, que é exatamente o peso
-- que a média ponderada precisa. Fazer a mesma conta depois exigiria subtrair
-- a quantidade recém-somada e torcer para nenhum outro caminho ter mexido no
-- saldo no meio.
--
-- Só entra na conta a movimentação que veio de recebimento (`recebimento_id`
-- preenchido). Ajuste de inventário, requisição de material e devolução de
-- venda mexem no saldo mas não são compra: não têm nota, não têm preço, não
-- podem redefinir o custo da casa.
--
-- O preço unitário sai de `pedidos.valor_total / pedidos.item_qtd`. O pedido é
-- 1:1 com a requisição (uma linha, um item) desde sempre — quando isso deixar
-- de valer, esta divisão é o primeiro lugar a corrigir.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O custo passa a dizer de onde veio
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.produtos_custo
  ADD COLUMN IF NOT EXISTS origem              text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ultima_compra_em    date,
  ADD COLUMN IF NOT EXISTS ultimo_custo_compra numeric(15,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.produtos_custo'::regclass
       AND conname  = 'produtos_custo_origem_valida'
  ) THEN
    ALTER TABLE public.produtos_custo
      ADD CONSTRAINT produtos_custo_origem_valida
      CHECK (origem IN ('manual', 'compra'));
  END IF;
END $$;

COMMENT ON COLUMN public.produtos_custo.origem IS
  'De onde veio o preco_custo vigente: "manual" (digitado no cadastro) ou "compra" (média ponderada, calculada no recebimento).';
COMMENT ON COLUMN public.produtos_custo.ultimo_custo_compra IS
  'Preço unitário da última entrada por recebimento. Não é o custo da casa — é o do último pedido.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A conta
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_custo_medio_da_entrada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valor_pedido  numeric;
  v_qtd_pedido    numeric;
  v_custo_unit    numeric(15,4);
  v_qtd_entrada   numeric;
  v_estoque_antes numeric;
  v_custo_atual   numeric;
  v_custo_novo    numeric(15,4);
BEGIN
  IF NEW.recebimento_id IS NULL
     OR NEW.produto_id IS NULL
     OR COALESCE(NEW.tipo, '') <> 'Entrada' THEN
    RETURN NEW;
  END IF;

  v_qtd_entrada := COALESCE(NEW.qtd, 0);
  IF v_qtd_entrada <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT p.valor_total, p.item_qtd
    INTO v_valor_pedido, v_qtd_pedido
    FROM public.recebimentos r
    JOIN public.pedidos p ON p.id = r.pedido_id
   WHERE r.id = NEW.recebimento_id;

  -- Pedido sem valor ou sem quantidade não tem preço unitário para dar. Entra
  -- no estoque do mesmo jeito — o custo é que fica como estava. Silêncio de
  -- propósito: recusar a entrada por causa de um campo em branco no pedido
  -- travaria o almoxarifado por um problema que é de Compras.
  IF COALESCE(v_valor_pedido, 0) <= 0 OR COALESCE(v_qtd_pedido, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_custo_unit := ROUND(v_valor_pedido / v_qtd_pedido, 4);

  SELECT estoque      INTO v_estoque_antes FROM public.produtos       WHERE id = NEW.produto_id;
  SELECT preco_custo  INTO v_custo_atual   FROM public.produtos_custo WHERE produto_id = NEW.produto_id;

  IF v_custo_atual IS NULL OR COALESCE(v_estoque_antes, 0) <= 0 THEN
    -- Primeiro custo, ou estoque zerado (nada para ponderar): a compra manda.
    v_custo_novo := v_custo_unit;
  ELSE
    v_custo_novo := ROUND(
      (v_estoque_antes * v_custo_atual + v_qtd_entrada * v_custo_unit)
      / (v_estoque_antes + v_qtd_entrada), 4);
  END IF;

  INSERT INTO public.produtos_custo AS pc
    (produto_id, preco_custo, origem, ultima_compra_em, ultimo_custo_compra, updated_at)
  VALUES
    (NEW.produto_id, v_custo_novo, 'compra',
     COALESCE(NEW.data, public.acre_today()), v_custo_unit, now())
  ON CONFLICT (produto_id) DO UPDATE
    SET preco_custo         = EXCLUDED.preco_custo,
        origem              = 'compra',
        ultima_compra_em    = EXCLUDED.ultima_compra_em,
        ultimo_custo_compra = EXCLUDED.ultimo_custo_compra,
        updated_at          = now();

  RETURN NEW;
END;
$$;

-- Nome com 'c': triggers BEFORE disparam em ordem alfabética, e este roda
-- antes do `trg_mov_estoque_casa_com_pedido`. Não muda o resultado — se o
-- guard recusar a entrada, a transação inteira volta atrás e o custo com ela.
DROP TRIGGER IF EXISTS trg_custo_medio_da_entrada ON public.movimentacoes_estoque;
CREATE TRIGGER trg_custo_medio_da_entrada
  BEFORE INSERT ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_custo_medio_da_entrada();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. A view mascarada passa a mostrar a procedência
--
-- `produtos_com_custo` é como o front lê o custo (a tabela tem RLS própria
-- desde a migr. 262). CREATE OR REPLACE VIEW não pode renomear nem reordenar
-- coluna existente: as novas só entram no FIM, e as antigas têm de sair na
-- mesma ordem em que já estão.
--
-- E a ordem NÃO é a mesma nos 4 bancos. Este bloco nasceu com a lista de
-- colunas escrita à mão, copiada da LogMax-ERP, e quebrou na turma Aprendiz
-- com 42P16 ("cannot change name of view column categoria to estoque"): lá
-- `categoria` é a 4ª coluna e na ERP é a 9ª. A ERP ainda tem uma diferença
-- própria — a view não expõe `loja_online`, que existe na tabela. São três
-- formatos para a mesma view, herdados de bootstraps de turma feitos em
-- momentos diferentes.
--
-- Por isso a lista das colunas antigas é LIDA DO PRÓPRIO BANCO em vez de
-- escrita aqui: cada projeto reconstrói a view com a ordem que já tinha, e as
-- quatro colunas de custo entram no fim. Reexecutar é seguro — as novas são
-- excluídas da leitura e recolocadas no mesmo lugar.
--
-- `security_invoker` vai declarado dentro do CREATE: sem isso o REPLACE
-- devolve a view ao padrão (security definer) e o custo vazaria para quem a
-- RLS barra.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(format('p.%I', column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'produtos_com_custo'
     AND column_name NOT IN ('preco_custo', 'custo_origem',
                             'custo_ultima_compra_em', 'custo_ultima_compra_valor');

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'View produtos_com_custo não existe neste banco — aplique a migração 262 antes desta.';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW public.produtos_com_custo WITH (security_invoker = true) AS '
    'SELECT %s, c.preco_custo, '
    '       c.origem              AS custo_origem, '
    '       c.ultima_compra_em    AS custo_ultima_compra_em, '
    '       c.ultimo_custo_compra AS custo_ultima_compra_valor '
    '  FROM public.produtos p '
    '  LEFT JOIN public.produtos_custo c ON c.produto_id = p.id',
    v_cols);
END $$;

COMMIT;

-- Coluna nova em view exposta pelo PostgREST exige recarga do cache.
NOTIFY pgrst, 'reload schema';
