-- Compras: fecha o ciclo de vida da requisição e barra compra duplicada.
--
-- ACHADO (confirmado em produção): `requisicoes.status` nunca saía de 'Aprovado'
-- depois da aprovação. A requisição continuava para sempre no dropdown de Nova
-- Cotação, e o guard de duplicidade em CotacoesView olhava pedido POR COTAÇÃO,
-- não por requisição. Resultado real na base LogMax-ERP: a requisição
-- bf331c3f (Extrato de Tomate, 24 un) gerou 2 cotações aprovadas → 2 pedidos →
-- 2 contas a pagar de R$ 79,20 → 48 unidades entraram no estoque.
--
-- Esta migração fecha o furo em três camadas:
--   1. RPC transacional para gerar o pedido (checa duplicidade e marca a
--      requisição como 'Atendida' no mesmo COMMIT).
--   2. Trigger que impede uma 2ª cotação 'Aprovado' na mesma requisição.
--   3. Backfill: requisições que já têm pedido viram 'Atendida'.
--
-- NÃO estorna a compra duplicada existente — isso é decisão do negócio e fica
-- fora daqui de propósito. O trigger só age em escritas novas, então a linha
-- duplicada continua no banco sem bloquear a migração.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. RPC: gerar pedido a partir da cotação aprovada
-- ────────────────────────────────────────────────────────────────────────────
--
-- Por que RPC e não 2 chamadas do cliente: o insert do pedido e a baixa da
-- requisição precisam cair no mesmo COMMIT. Além disso a policy
-- `compras_update` de requisicoes aceita setor 'compras' ou gerente da filial —
-- mas quem gera pedido na UI também pode ser 'logistica' (isCompras em
-- CotacoesView). Pelo cliente, logística criava o pedido e falhava ao baixar a
-- requisição, deixando exatamente o estado que estamos corrigindo.
--
-- FOR UPDATE na cotação serializa cliques duplos / duas abas.

CREATE OR REPLACE FUNCTION public.gerar_pedido_de_cotacao(p_cotacao_id uuid)
RETURNS public.pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cot     public.cotacoes;
  v_req     public.requisicoes;
  v_pedido  public.pedidos;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot
    FROM public.cotacoes
   WHERE id = p_cotacao_id
   FOR UPDATE;

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

  -- Guard por COTAÇÃO (o que já existia no cliente).
  IF EXISTS (SELECT 1 FROM public.pedidos
              WHERE cotacao_id = v_cot.id AND ativo) THEN
    RAISE EXCEPTION 'Esta cotação já tem pedido gerado.' USING ERRCODE = 'P0001';
  END IF;

  -- Guard por REQUISIÇÃO — este é o que faltava e deixou passar a compra dupla.
  IF v_cot.requisicao_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.pedidos
        WHERE requisicao_id = v_cot.requisicao_id AND ativo
     ) THEN
    RAISE EXCEPTION 'Esta requisição já foi atendida por outro pedido.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = v_cot.requisicao_id;

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    -- cotacoes.prazo_entrega é text e pedidos.prazo_entrega é date. O input é
    -- <input type=date>, mas linha legada com texto livre faria o cast estourar
    -- no meio da transação — por isso só converte o que tem forma de ISO.
    CASE WHEN v_cot.prazo_entrega ~ '^\d{4}-\d{2}-\d{2}$'
         THEN v_cot.prazo_entrega::date END,
    'Pendente', v_cot.filial, v_req.item, v_req.qtd
  )
  RETURNING * INTO v_pedido;

  -- Baixa da requisição: sai de 'Aprovado' e some do dropdown de Nova Cotação.
  IF v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.requisicoes
       SET status = 'Atendida'
     WHERE id = v_cot.requisicao_id
       AND status = 'Aprovado';
  END IF;

  RETURN v_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_pedido_de_cotacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_pedido_de_cotacao(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Trigger: no máximo UMA cotação 'Aprovado' por requisição
-- ────────────────────────────────────────────────────────────────────────────
--
-- Trigger em vez de índice único parcial de propósito: a base já tem a linha
-- duplicada do Extrato de Tomate, e CREATE UNIQUE INDEX falharia na hora. O
-- trigger valida só o que for escrito daqui pra frente.
--
-- search_path + tabelas qualificadas seguindo a régua de trigger do projeto.

CREATE OR REPLACE FUNCTION public.cotacoes_unica_aprovada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status <> 'Aprovado' OR NEW.ativo IS NOT TRUE OR NEW.requisicao_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE que não mexe no status (ex.: editar prazo) não precisa revalidar.
  IF TG_OP = 'UPDATE' AND OLD.status = 'Aprovado' AND OLD.ativo IS TRUE THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cotacoes c
     WHERE c.requisicao_id = NEW.requisicao_id
       AND c.id <> NEW.id
       AND c.status = 'Aprovado'
       AND c.ativo
  ) THEN
    RAISE EXCEPTION 'Esta requisição já tem uma cotação aprovada. Cancele a anterior antes de aprovar outra.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cotacoes_unica_aprovada ON public.cotacoes;
CREATE TRIGGER trg_cotacoes_unica_aprovada
  BEFORE INSERT OR UPDATE ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.cotacoes_unica_aprovada();

CREATE INDEX IF NOT EXISTS idx_cotacoes_requisicao_status
  ON public.cotacoes (requisicao_id, status) WHERE ativo;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Backfill: requisição que já tem pedido não pode seguir re-cotável
-- ────────────────────────────────────────────────────────────────────────────
--
-- Sem isto o furo continua aberto pra toda a base existente: 137 requisições
-- 'Aprovado' seguiriam disponíveis para uma segunda cotação. Só toca em quem
-- comprovadamente já virou pedido ativo.
DO $backfill$
DECLARE v_n integer;
BEGIN
  UPDATE public.requisicoes r
     SET status = 'Atendida'
   WHERE r.status = 'Aprovado'
     AND EXISTS (SELECT 1 FROM public.pedidos p
                  WHERE p.requisicao_id = r.id AND p.ativo);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '[266] % requisição(ões) marcada(s) como Atendida.', v_n;
END;
$backfill$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Nenhuma requisição 'Aprovado' com pedido ativo deve sobrar:
-- SELECT count(*) FROM requisicoes r
--  WHERE r.status='Aprovado'
--    AND EXISTS (SELECT 1 FROM pedidos p WHERE p.requisicao_id=r.id AND p.ativo);
--
-- 2) A duplicata histórica continua lá (não estornamos), mas isolada:
-- SELECT requisicao_id, count(*) FROM cotacoes WHERE ativo AND status='Aprovado'
--  GROUP BY 1 HAVING count(*) > 1;
