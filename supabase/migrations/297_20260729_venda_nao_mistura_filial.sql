-- 297 — Venda não mistura filial. Nem pelo balcão, nem pela loja.
--
-- O QUE ESTAVA ABERTO
--
-- `criar_venda_pdv` confere existência e estoque de cada produto, mas nunca
-- comparou a filial do produto com a filial da venda. O checkout público
-- (`api/loja.ts`) compara — é o que barra o visitante que edita a página no
-- F12 — só que a confirmação não reconferia, e a RLS de
-- `pedidos_online_itens` é `FOR ALL` para quem opera a loja.
--
-- Resultado: um usuário autenticado de vendas ou gerente da MaxLook podia
-- inserir na mão um item com `produto_id` da SuperMax dentro de um pedido
-- MaxLook e confirmar. Sairia venda MaxLook baixando estoque da SuperMax. O
-- mesmo valia para o PDV, chamando a RPC direto com um payload montado.
--
-- POR QUE UM TRIGGER, E NÃO UM IF DENTRO DA RPC
--
-- A regra é sobre o dado, não sobre quem escreve: item de venda pertence à
-- filial da venda, ponto. Num trigger ela vale para o PDV, para a loja e para
-- qualquer caminho futuro — inclusive INSERT direto via PostgREST, que nenhum
-- IF dentro de uma RPC alcança. E não exige reescrever a `criar_venda_pdv`,
-- que é o caminho crítico de venda das 4 turmas.
--
-- O trigger aborta a transação inteira, então a venda, os itens já inseridos
-- e as movimentações de estoque voltam atrás juntos.
--
-- `search_path` explícito e tabelas qualificadas com `public.` — vide o caso
-- do "Database error deleting user" nas funções de trigger.
--
-- Produto ou venda com `filial` NULL não bloqueia: é dado antigo, e recusar
-- agora quebraria cadastro legítimo que nunca teve filial. A comparação só
-- acontece quando os dois lados sabem de onde são.
--
-- Conferi antes de apertar: nas 4 turmas, TODO item de venda já existente bate
-- com a filial da venda (inclusive a única venda 'Matriz' da adm, de produto
-- 'Matriz'). Nenhum fluxo legítimo depende de misturar.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_valida_filial_item_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial_venda   text;
  v_filial_produto text;
  v_nome_produto   text;
BEGIN
  SELECT filial INTO v_filial_venda
    FROM public.vendas WHERE id = NEW.venda_id;

  SELECT filial, nome INTO v_filial_produto, v_nome_produto
    FROM public.produtos WHERE id = NEW.produto_id;

  IF v_filial_venda IS NOT NULL
     AND v_filial_produto IS NOT NULL
     AND v_filial_produto <> v_filial_venda THEN
    RAISE EXCEPTION
      'O produto "%" é da filial % e a venda é da filial % — uma filial não vende o estoque da outra.',
      COALESCE(v_nome_produto, NEW.nome_produto), v_filial_produto, v_filial_venda
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_valida_filial_item_venda ON public.itens_venda;
CREATE TRIGGER trg_valida_filial_item_venda
  BEFORE INSERT OR UPDATE OF produto_id, venda_id ON public.itens_venda
  FOR EACH ROW EXECUTE FUNCTION public.fn_valida_filial_item_venda();

-- ────────────────────────────────────────────────────────────────────────────
-- O guard do pedido continua valendo, e antes do trigger.
--
-- Redundante de propósito: o trigger falharia no meio da `criar_venda_pdv`,
-- com uma mensagem sobre item de venda. Aqui a recusa acontece antes de
-- qualquer escrita e diz o que o aluno precisa saber — que o PEDIDO está
-- adulterado, com o código dele.
--
-- Assinatura idêntica à da 296, então é CREATE OR REPLACE puro: sem DROP e
-- sem risco de sobrecarga ambígua (PGRST203).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirmar_pedido_online(
  p_pedido_id       uuid,
  p_forma_pagamento text,
  p_cliente_id      uuid    DEFAULT NULL,
  p_parcelas        integer DEFAULT 1,
  p_ignorar_cupom   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido    public.pedidos_online;
  v_itens     jsonb;
  v_venda_id  uuid;
  v_nome      text;
  v_desconto  numeric(15,2);
  v_total_fin numeric(15,2);
  v_cupom_cod text;
  v_intruso   text;
BEGIN
  SELECT * INTO v_pedido
    FROM public.pedidos_online
   WHERE id = p_pedido_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido online não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_opera_loja(v_pedido.filial) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF v_pedido.status = 'Confirmado' THEN
    RAISE EXCEPTION 'Pedido % já virou a venda %.', v_pedido.codigo, v_pedido.venda_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_pedido.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Pedido % está cancelado.', v_pedido.codigo USING ERRCODE = 'P0001';
  END IF;

  -- Forma que deixa conta em aberto precisa de devedor.
  IF p_forma_pagamento IN ('Fiado', 'Cartão Crédito') AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION
      '% gera conta a receber em aberto — escolha o cliente, senão a cobrança fica sem devedor.',
      p_forma_pagamento
      USING ERRCODE = 'P0001';
  END IF;

  -- Item de outra filial no pedido só chega aqui se alguém escreveu direto na
  -- tabela: o checkout público recusa antes de gravar.
  SELECT pr.nome INTO v_intruso
    FROM public.pedidos_online_itens i
    JOIN public.produtos pr ON pr.id = i.produto_id
   WHERE i.pedido_id = p_pedido_id
     AND pr.filial IS NOT NULL
     AND pr.filial <> v_pedido.filial
   LIMIT 1;

  IF v_intruso IS NOT NULL THEN
    RAISE EXCEPTION
      'Pedido % tem item de outra filial ("%") e não pode ser confirmado.',
      v_pedido.codigo, v_intruso
      USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'produto_id',     i.produto_id,
           'nome_produto',   i.nome_produto,
           'qtd',            i.qtd,
           'preco_unitario', i.preco_unitario,
           'subtotal',       i.subtotal
         ) ORDER BY i.created_at)
    INTO v_itens
    FROM public.pedidos_online_itens i
   WHERE i.pedido_id = p_pedido_id;

  IF v_itens IS NULL OR jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Pedido % não tem itens.', v_pedido.codigo USING ERRCODE = 'P0001';
  END IF;

  -- Sem cupom, a venda é o total cheio dos itens. `criar_venda_pdv` confere
  -- que total − desconto = total_final, então os três andam juntos.
  IF p_ignorar_cupom THEN
    v_desconto  := 0;
    v_total_fin := v_pedido.total;
    v_cupom_cod := NULL;
  ELSE
    v_desconto  := v_pedido.cupom_desconto;
    v_total_fin := v_pedido.total_final;
    v_cupom_cod := v_pedido.cupom_codigo;
  END IF;

  v_venda_id := public.criar_venda_pdv(
    p_cliente_id      => p_cliente_id,
    p_total           => v_pedido.total,
    p_desconto        => v_desconto,
    p_total_final     => v_total_fin,
    p_forma_pagamento => p_forma_pagamento,
    p_parcelas        => COALESCE(p_parcelas, 1),
    p_itens           => v_itens,
    p_filial          => v_pedido.filial,
    p_cupom_codigo    => v_cupom_cod,
    p_cupom_desconto  => v_desconto
  );

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.pedidos_online
     SET status         = 'Confirmado',
         venda_id       = v_venda_id,
         cupom_ignorado = COALESCE(p_ignorar_cupom, false),
         atendido_por   = auth.uid(),
         atendente_nome = COALESCE(v_nome, 'Atendente'),
         atendido_em    = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'ok', true,
    'venda_id', v_venda_id,
    'codigo',   v_pedido.codigo,
    'total',    v_total_fin,
    'cupom_ignorado', COALESCE(p_ignorar_cupom, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirmar_pedido_online(uuid, text, uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_online(uuid, text, uuid, integer, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_valida_filial_item_venda() FROM PUBLIC, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação
--
--   -- Trigger no lugar:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.itens_venda'::regclass AND NOT tgisinternal;
--
--   -- Nenhum item histórico viola a regra (deve voltar zero linhas):
--   SELECT v.filial AS venda, pr.filial AS produto, count(*)
--     FROM itens_venda iv
--     JOIN vendas v   ON v.id  = iv.venda_id
--     JOIN produtos pr ON pr.id = iv.produto_id
--    WHERE pr.filial IS DISTINCT FROM v.filial
--    GROUP BY 1, 2;
--
--   -- Uma assinatura só de confirmar_pedido_online (5 argumentos):
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'confirmar_pedido_online';
-- ────────────────────────────────────────────────────────────────────────────
