-- 296 — Dois becos sem saída no atendimento do pedido online.
--
-- ─── 1. Pedido com cupom podia ficar preso na fila ─────────────────────────
--
-- `criar_venda_pdv` revalida o cupom na confirmação, de propósito: o pedido
-- pode passar a noite na fila e o cupom pode ter expirado ou mudado nesse
-- meio. Só que o pedido guarda `cupom_codigo` e `cupom_desconto`, e a tela
-- não tinha como confirmar SEM o cupom — então a RPC levantava
--
--     Cupom expirou em 28/07/2026.
--
-- e o atendente ficava com um pedido que não dava para fechar nem para
-- resolver. A única saída era cancelar o pedido de um comprador que não fez
-- nada de errado.
--
-- Agora existe `p_ignorar_cupom`. Com ele a venda sai pelo valor cheio, e o
-- pedido registra que o desconto caiu — `cupom_codigo` e `cupom_desconto`
-- FICAM como estavam, porque eles são o que foi prometido na página. Quem
-- quiser auditar depois compara os dois: o pedido diz o que foi oferecido, a
-- venda diz o que foi cobrado, e `cupom_ignorado` explica a diferença.
--
-- Cobrar mais do que a página anunciou é decisão de quem atende, não efeito
-- colateral: a tela mostra o valor cheio e exige o clique.
--
-- ─── 2. Fiado e Cartão Crédito sem cliente = conta a receber órfã ─────────
--
-- Essas duas formas geram `contas_receber` com status 'Aberto'. Sem
-- `cliente_id` nasce uma cobrança sem devedor: o apelido do comprador ("jo")
-- fica na descrição da venda e não há de quem cobrar. Para PIX, Dinheiro e
-- Débito não importa — a conta já nasce paga.
--
-- O guard vai na RPC e não só na tela, porque a tela é uma sugestão e a RPC
-- é a regra.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

ALTER TABLE public.pedidos_online
  ADD COLUMN IF NOT EXISTS cupom_ignorado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pedidos_online.cupom_ignorado IS
  'Venda fechada sem aplicar o cupom do pedido (cupom expirou ou mudou entre o pedido e o atendimento). cupom_codigo/cupom_desconto continuam registrando o que foi prometido.';

-- Assinatura nova. Parâmetro com DEFAULT criaria uma SOBRECARGA em vez de
-- substituir a função, e duas versões com default deixam o PostgREST sem
-- saber qual chamar (PGRST203). Por isso derruba antes de criar.
DROP FUNCTION IF EXISTS public.confirmar_pedido_online(uuid, text, uuid, integer);

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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- Uma assinatura só (5 argumentos), senão o PostgREST fica ambíguo:
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'confirmar_pedido_online';
--
--   -- Pedidos fechados sem o cupom que tinham prometido:
--   SELECT codigo, cupom_codigo, cupom_desconto, total, total_final
--     FROM pedidos_online WHERE cupom_ignorado;
