-- 531 — Quem fecha o pedido é o banco, não a tela.
--
-- Desde sempre, o pedido só virava 'Recebido' porque `RecebimentosView`, depois
-- de confirmar a entrada, mandava um segundo update:
--
--     const ped = pedidos.find(p => p.id === item.pedido_id);
--     if (ped && ped.status !== 'Recebido' && ...) {
--       try { await dbUpdate('/api/pedidosview', item.pedido_id, {...}); }
--       catch { /* não bloqueia o fluxo */ }
--     }
--
-- Três maneiras de esse update não acontecer, todas mudas:
--
--   (a) `pedidos` é um array em memória. Se a linha não estiver nele — fetch
--       ainda em trânsito, aba aberta antes de o pedido existir —, o `find`
--       devolve undefined e o bloco inteiro é pulado.
--   (b) A RLS pode recusar. `recebimentos` aceita setor 'estoque'; `pedidos`
--       aceita 'compras' e 'logistica'. Um almoxarife de setor 'estoque'
--       confirma a entrada e NÃO tem permissão de fechar o pedido. PostgREST
--       nem devolve erro nesse caso: devolve zero linhas afetadas.
--   (c) O `catch` vazio engole qualquer outra falha.
--
-- Em todas, o resultado é o mesmo e é invisível: o recebimento fica 'Concluído',
-- a mercadoria entra no estoque, e o pedido continua 'Em Entrega' para sempre —
-- sem `recebido_em`, que é a régua de pontualidade do fornecedor (migr. 421), e
-- ocupando a fila de "a receber" com uma carga que já chegou (migr. 530).
--
-- A régua já vive no banco desde a migr. 489 ("o status sai do saldo"), e
-- `fn_pedido_transicao_valida` já sabe dizer que um pedido só se encerra com
-- recebimento conferido. Faltava o outro lado: o encerramento acontecer sozinho
-- quando o recebimento fecha. É o mesmo predicado, agora dos dois lados.
--
-- O caminho de volta também: recebimento inativado ou revertido para 'Pendente'
-- devolve o pedido para 'Em Entrega' e limpa `recebido_em`. Sem isso a
-- conferência desfeita deixava o pedido encerrado e fora de toda fila —
-- `fn_pedido_marca_recebimento` só carimba a data, nunca a apaga.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_recebimento_fecha_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_id     uuid;
  v_status        text;
  v_tem_concluido boolean;
BEGIN
  v_pedido_id := COALESCE(NEW.pedido_id, OLD.pedido_id);
  IF v_pedido_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT status INTO v_status FROM public.pedidos WHERE id = v_pedido_id;

  -- Pedido cancelado não reabre nem encerra: a unidade decidiu não comprar, e
  -- mexer nele por causa de um recebimento seria desfazer a decisão de outro
  -- setor. Pedido inexistente idem (recebimento avulso).
  IF v_status IS NULL OR v_status = 'Cancelado' THEN
    RETURN NULL;
  END IF;

  -- MESMO predicado de `fn_pedido_transicao_valida`. Não é a conta do saldo de
  -- novo: quem faz a conta é `fn_recebimento_status_pelo_saldo` (migr. 489), e
  -- o resultado dela é o status 'Concluído'. Refazer a soma aqui abriria a
  -- porta para as duas discordarem — inclusive no encerramento deliberado com
  -- saldo em aberto (`encerrado_com_saldo`), em que o saldo NÃO fecha e o
  -- pedido tem de encerrar assim mesmo.
  SELECT EXISTS (
    SELECT 1 FROM public.recebimentos r
     WHERE r.pedido_id = v_pedido_id
       AND COALESCE(r.ativo, true)
       AND r.status = 'Concluído'
  ) INTO v_tem_concluido;

  IF v_tem_concluido AND v_status <> 'Recebido' THEN
    -- `recebido_em` sai daqui em branco de propósito: quem o carimba, com a
    -- data da carga e não a do clique, é `fn_pedido_marca_recebimento`.
    UPDATE public.pedidos SET status = 'Recebido' WHERE id = v_pedido_id;

  ELSIF NOT v_tem_concluido AND v_status = 'Recebido' THEN
    UPDATE public.pedidos
       SET status = 'Em Entrega', recebido_em = NULL
     WHERE id = v_pedido_id;
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_recebimento_fecha_pedido() IS
  'Encerra (ou reabre) o pedido conforme exista recebimento ativo Concluído '
  '(migr. 531). Antes disto quem fechava era a tela, e falhava em silêncio '
  'quando a RLS de pedidos recusava o update de quem confirmou a entrada.';

DROP TRIGGER IF EXISTS trg_recebimento_fecha_pedido ON public.recebimentos;
CREATE TRIGGER trg_recebimento_fecha_pedido
  AFTER INSERT OR UPDATE OR DELETE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_fecha_pedido();

-- Passivo: pedido com recebimento conferido que ficou aberto porque o update da
-- tela não chegou. Roda pelo mesmo predicado do gatilho — o UPDATE dispara
-- `fn_pedido_marca_recebimento`, que carimba a data da carga.
UPDATE public.pedidos p
   SET status = 'Recebido'
 WHERE p.ativo IS TRUE
   AND p.status = 'Em Entrega'
   AND EXISTS (
     SELECT 1 FROM public.recebimentos r
      WHERE r.pedido_id = p.id
        AND COALESCE(r.ativo, true)
        AND r.status = 'Concluído');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
--
--   -- não pode sobrar nenhum: recebimento conferido com pedido aberto
--   SELECT p.filial, p.numero, p.status, r.status
--     FROM pedidos p JOIN recebimentos r ON r.pedido_id = p.id AND r.ativo
--    WHERE r.status = 'Concluído' AND p.status NOT IN ('Recebido', 'Cancelado');
--
--   -- nem o contrário: pedido encerrado sem conferência viva
--   SELECT p.filial, p.numero FROM pedidos p
--    WHERE p.status = 'Recebido' AND p.ativo AND NOT EXISTS (
--      SELECT 1 FROM recebimentos r WHERE r.pedido_id = p.id AND r.ativo
--        AND r.status = 'Concluído');
--
-- TESTE MANUAL
--   confirmar a entrada        → pedido vira 'Recebido' sozinho, com a data da
--                                carga, sem a tela mandar nada
--   inativar o recebimento     → pedido volta para 'Em Entrega', sem data, e
--                                reaparece na fila de a receber
--   pedido cancelado           → nada acontece com ele
-- ════════════════════════════════════════════════════════════════════════════
