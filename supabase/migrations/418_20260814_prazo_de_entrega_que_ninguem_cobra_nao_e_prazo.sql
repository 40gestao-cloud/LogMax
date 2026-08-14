-- 418_20260814_prazo_de_entrega_que_ninguem_cobra_nao_e_prazo.sql
--
-- O PEDIDO NUNCA ATRASA.
--
-- `fornecedores.prazo_entrega_dias` é pedido no cadastro desde a migr. 360 e
-- não calcula nada. `pedidos.prazo_entrega` é uma data que só é preenchida se
-- quem lançou a cotação digitou uma, e que a tela mostra crua. Nenhum pedido
-- fica "Atrasado", ninguém cobra fornecedor, e escolher fornecedor continua
-- sendo só preço — quando na compra real prazo e pontualidade valem tanto
-- quanto o valor da proposta.
--
-- Esta migração fecha as duas pontas que faltavam para a data existir e para
-- o atraso ser mensurável:
--
--   1. O pedido nasce com prazo mesmo quando a cotação não trouxe um: cai no
--      prazo médio cadastrado no fornecedor (hoje + prazo_entrega_dias). É o
--      primeiro uso real daquele campo.
--   2. O pedido registra QUANDO foi recebido. Sem isso dá para ver que está
--      atrasado hoje, mas não dá para dizer que o fornecedor entregou com 6
--      dias de atraso no mês passado — que é o dado que alimenta desempenho
--      de fornecedor, o próximo gap da fila.
--
-- O atraso em si não vira coluna nem status: é `prazo_entrega < hoje` com o
-- pedido ainda em aberto, e coluna que guarda o que dá para calcular envelhece
-- errado (o pedido "Atrasado" gravado ontem continuaria atrasado depois de
-- recebido). Quem pinta o atraso é a tela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- SOBRE REESCREVER A `gerar_pedido_de_cotacao`
--
-- Aqui o REPLACE é seguro e o corpo abaixo foi copiado do banco, não da
-- migração que a criou: assinatura e RETURNS pedidos ficam idênticos, e a
-- única mudança é o COALESCE do prazo. Uma coluna OUT trocada derrubaria a
-- função inteira (42P13) e levaria a transação junto.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Quando a carga chegou
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS recebido_em date;

COMMENT ON COLUMN public.pedidos.recebido_em IS
  'Data em que o pedido foi fechado como Recebido. Contra prazo_entrega, dá o atraso real da entrega.';

CREATE OR REPLACE FUNCTION public.fn_pedido_marca_recebimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só a transição para Recebido carimba. Reprocessar, reabrir ou cancelar
  -- depois não reescreve a data: a primeira vez que a carga chegou é a que
  -- conta para medir o fornecedor.
  IF COALESCE(NEW.status, '') = 'Recebido'
     AND COALESCE(OLD.status, '') <> 'Recebido'
     AND NEW.recebido_em IS NULL THEN
    NEW.recebido_em := public.acre_today();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_marca_recebimento ON public.pedidos;
CREATE TRIGGER trg_pedido_marca_recebimento
  BEFORE UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_marca_recebimento();

-- Passado: pedido já fechado ganha a data do último recebimento confirmado.
-- Sem isso o histórico das turmas inteiras ficaria fora de qualquer medição de
-- pontualidade, e o primeiro relatório nasceria vazio.
UPDATE public.pedidos p
   SET recebido_em = sub.ultima_entrega
  FROM (
    SELECT r.pedido_id, MAX(r.data) AS ultima_entrega
      FROM public.recebimentos r
     WHERE r.ativo = true
       AND r.status IN ('Concluído', 'Parcial')
     GROUP BY r.pedido_id
  ) sub
 WHERE p.id = sub.pedido_id
   AND p.status = 'Recebido'
   AND p.recebido_em IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Pedido sem prazo passa a herdar o do fornecedor
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(p_cotacao_id uuid)
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
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_cotacao_id FOR UPDATE;

  IF v_cot.id IS NULL THEN
    RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(v_cot.filial) THEN
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

  v_prazo := CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
                  THEN v_cot.prazo_entrega::date END;

  -- Cotação sem data prometida: usa o prazo médio do fornecedor. É o campo que
  -- Cadastros pede e que até aqui não servia para nada. Fornecedor sem prazo
  -- cadastrado continua gerando pedido sem data — e é o pedido que ninguém
  -- consegue cobrar, o que é a própria lição.
  IF v_prazo IS NULL AND v_cot.fornecedor_id IS NOT NULL THEN
    SELECT prazo_entrega_dias INTO v_prazo_forn
      FROM public.fornecedores WHERE id = v_cot.fornecedor_id;
    IF COALESCE(v_prazo_forn, 0) > 0 THEN
      v_prazo := public.acre_today() + v_prazo_forn;
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd, produto_id
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd, v_req.produto_id
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

COMMIT;

NOTIFY pgrst, 'reload schema';
