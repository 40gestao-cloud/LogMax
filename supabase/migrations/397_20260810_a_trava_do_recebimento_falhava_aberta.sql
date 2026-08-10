-- =================================================================
-- 397 — A trava do recebimento falhava aberta fora de Logística.
--
-- A 396 pôs a trigger `trg_mov_estoque_casa_com_pedido` pra recusar
-- entrada de estoque que não casasse com o produto do pedido. Ela
-- funciona — para quem está em Logística. Para todo o resto ela deixa
-- passar, e o motivo é a RLS:
--
--   • `mov_insert` em `movimentacoes_estoque` cobra só
--     `auth_pode_filial(filial)`. Qualquer aluno da filial insere
--     movimentação — vendas, RH, marketing.
--   • `pedidos` só é legível por compras/logistica/gerente-da-filial.
--   • A função da trigger nasceu SEM `SECURITY DEFINER`, então o SELECT
--     dela roda sob a RLS de quem chamou. Para quem não enxerga
--     `pedidos`, o SELECT não acha linha, `v_produto_pedido` volta NULL
--     — e NULL é o caso "compra eventual", que passa de propósito.
--
-- Ou seja: a trava barrava exatamente quem tinha motivo legítimo para
-- dar entrada, e ignorava quem não tinha. Falha aberta é pior que trava
-- nenhuma, porque parece proteção.
--
-- `SECURITY DEFINER` resolve: a consulta passa a enxergar a linha
-- sempre, e a comparação acontece para todo mundo. A função não recebe
-- nem devolve dado do pedido — só compara uuid e usa o nome do produto
-- na mensagem de erro —, então não abre leitura nova a ninguém.
--
-- `SET search_path` continua obrigatório (é o que impede sequestro de
-- resolução de nome numa função que roda como dono).
--
-- CREATE OR REPLACE mantém a trigger existente apontada para a função:
-- o OID não muda, então não é preciso recriar o gatilho.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._mov_estoque_casa_com_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_produto_pedido uuid;
  v_numero         text;
  v_esperado       text;
BEGIN
  -- Movimentação que não vem de recebimento (venda, ajuste de inventário,
  -- requisição de material) não tem pedido pra comparar.
  IF NEW.recebimento_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.produto_id, COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6)))
    INTO v_produto_pedido, v_numero
    FROM public.recebimentos r
    JOIN public.pedidos p ON p.id = r.pedido_id
   WHERE r.id = NEW.recebimento_id;

  -- Compra eventual (produto_id NULL) segue livre: não nasceu do catálogo,
  -- não há produto declarado pra cobrar.
  IF v_produto_pedido IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.produto_id IS DISTINCT FROM v_produto_pedido THEN
    SELECT nome INTO v_esperado FROM public.produtos WHERE id = v_produto_pedido;
    RAISE EXCEPTION
      'Entrada não confere com o pedido: % foi comprado para "%". Dê entrada nesse produto ou registre a divergência.',
      v_numero, COALESCE(v_esperado, 'produto do pedido')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   SELECT proname, prosecdef, proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname = '_mov_estoque_casa_com_pedido';
--   -- prosecdef = true, proconfig = {search_path=public}
