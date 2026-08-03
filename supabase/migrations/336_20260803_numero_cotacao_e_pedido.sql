-- 336 — Cotação e pedido ganham número, no mesmo formato da requisição.
--
-- A 335 numerou a requisição e o formato se provou no uso. Deixar os outros
-- dois documentos com id curto (#A1B2C3) faria o fluxo ter dois vocabulários:
-- o aluno diria "a REQ-SM-2026-0007 virou o pedido A1B2C3", e a segunda metade
-- da frase não ajuda ninguém a achar nada.
--
--   COT-SM-2026-0001  cotação
--   PC-SM-2026-0001   pedido de compra
--
-- 'PC' e não 'PED' porque existe pedido de VENDA no sistema; quando ele for
-- numerado será 'PV', e as duas siglas não se confundem no meio de uma frase.
--
-- O contador (`documento_sequencias`) e a régua de concorrência vieram da 335 —
-- aqui só entram o formatador genérico e um trigger que serve as duas tabelas.

BEGIN;

-- ── Formatador e trigger genéricos ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.formatar_numero_documento(
  p_prefixo text,
  p_filial  text,
  p_ano     integer,
  p_seq     integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT p_prefixo || '-' ||
         CASE p_filial
           WHEN 'SuperMax' THEN 'SM'
           WHEN 'MaxLook'  THEN 'ML'
           WHEN 'TechMax'  THEN 'TM'
           ELSE upper(left(COALESCE(p_filial, 'XX'), 2))
         END
         || '-' || p_ano::text || '-' || lpad(p_seq::text, 4, '0');
$function$;

-- TG_ARGV[0] = prefixo visível, TG_ARGV[1] = chave do contador. Um trigger
-- serve qualquer documento novo sem função nova.
CREATE OR REPLACE FUNCTION public.set_numero_documento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ano integer;
BEGIN
  IF NEW.numero IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Ano do Acre: a partir das 19h locais o UTC já virou o dia seguinte, e em
  -- 31/12 o documento sairia numerado com o ano que vem.
  v_ano := extract(year FROM public.acre_today())::integer;

  NEW.numero := public.formatar_numero_documento(
    TG_ARGV[0], NEW.filial, v_ano,
    public.proximo_numero_documento(TG_ARGV[1], COALESCE(NEW.filial, 'XX'), v_ano));

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_numero_documento() FROM PUBLIC, anon;

-- ── Colunas, triggers, backfill ─────────────────────────────────────────────

ALTER TABLE public.cotacoes ADD COLUMN IF NOT EXISTS numero text;
ALTER TABLE public.pedidos  ADD COLUMN IF NOT EXISTS numero text;

DROP TRIGGER IF EXISTS trg_numero_documento ON public.cotacoes;
CREATE TRIGGER trg_numero_documento BEFORE INSERT ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.set_numero_documento('COT', 'cotacoes');

DROP TRIGGER IF EXISTS trg_numero_documento ON public.pedidos;
CREATE TRIGGER trg_numero_documento BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.set_numero_documento('PC', 'pedidos');

-- Ordem de criação, como na 335: número fora de ordem ensina que numeração não
-- significa nada.
WITH numerados AS (
  SELECT id, filial, extract(year FROM created_at)::integer AS ano,
         row_number() OVER (PARTITION BY filial, extract(year FROM created_at)
                            ORDER BY created_at NULLS LAST, id)::integer AS seq
    FROM public.cotacoes WHERE numero IS NULL
)
UPDATE public.cotacoes c
   SET numero = public.formatar_numero_documento('COT', n.filial, n.ano, n.seq)
  FROM numerados n WHERE n.id = c.id;

WITH numerados AS (
  SELECT id, filial, extract(year FROM created_at)::integer AS ano,
         row_number() OVER (PARTITION BY filial, extract(year FROM created_at)
                            ORDER BY created_at NULLS LAST, id)::integer AS seq
    FROM public.pedidos WHERE numero IS NULL
)
UPDATE public.pedidos p
   SET numero = public.formatar_numero_documento('PC', n.filial, n.ano, n.seq)
  FROM numerados n WHERE n.id = p.id;

INSERT INTO public.documento_sequencias (entidade, filial, ano, ultimo)
SELECT 'cotacoes', filial, extract(year FROM created_at)::integer, count(*)::integer
  FROM public.cotacoes WHERE numero IS NOT NULL
 GROUP BY filial, extract(year FROM created_at)
ON CONFLICT (entidade, filial, ano)
DO UPDATE SET ultimo = greatest(public.documento_sequencias.ultimo, excluded.ultimo);

INSERT INTO public.documento_sequencias (entidade, filial, ano, ultimo)
SELECT 'pedidos', filial, extract(year FROM created_at)::integer, count(*)::integer
  FROM public.pedidos WHERE numero IS NOT NULL
 GROUP BY filial, extract(year FROM created_at)
ON CONFLICT (entidade, filial, ano)
DO UPDATE SET ultimo = greatest(public.documento_sequencias.ultimo, excluded.ultimo);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cotacoes_numero
  ON public.cotacoes (numero) WHERE numero IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero
  ON public.pedidos (numero) WHERE numero IS NOT NULL;

-- ── A conta a pagar passa a citar o pedido pelo número ──────────────────────
-- A descrição nasce aqui e é o que o Financeiro lê na fila de pagamento. Com
-- "Pedido #A1B2C3" ele tinha de abrir a lista de pedidos e comparar sufixos de
-- uuid para achar a origem da despesa. Só muda o texto das contas novas — as
-- antigas ficam como estão, porque descrição é o que foi escrito na época.

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

  INSERT INTO public.pedidos (
    cotacao_id, requisicao_id, fornecedor_id, valor_total, prazo_entrega,
    status, filial, item_descricao, item_qtd
  ) VALUES (
    v_cot.id, v_cot.requisicao_id, v_cot.fornecedor_id, v_cot.valor_total,
    v_prazo, 'Aprovado', v_cot.filial, v_req.item, v_req.qtd
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

-- Verificação:
--
--   SELECT count(*) FROM cotacoes WHERE numero IS NULL;   -- 0
--   SELECT count(*) FROM pedidos  WHERE numero IS NULL;   -- 0
--   SELECT entidade, filial, ano, ultimo FROM documento_sequencias ORDER BY 1, 2;
--
--   -- A próxima conta a pagar gerada deve nascer como
--   -- "PC-SM-2026-0007 — Toner (REQ-SM-2026-0012)".
