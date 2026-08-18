-- 457_20260817_a_carga_saiu_e_o_estoque_nao_ficava_sabendo.sql
--
-- OITO PEDIDOS A CAMINHO E NINGUÉM AVISADO.
--
-- O fluxo de compra termina em alguém conferindo a carga: Compras emite o
-- pedido, o fornecedor despacha, o pedido vai para 'Em Entrega' e o Estoque
-- registra o recebimento. Só que **nada dizia ao Estoque que a carga estava a
-- caminho**. O único lugar onde essa fila aparecia era dentro da própria tela
-- de Recebimentos, para quem já tivesse decidido abri-la.
--
-- Hoje, nas 4 turmas, são oito pedidos em 'Em Entrega' sem recebimento
-- nenhum. É a fila mais silenciosa do sistema: não vence, não apita, não
-- aparece — e enquanto ela espera, o estoque está errado para baixo e a
-- Sugestão de Compras pode mandar comprar de novo o que já vem na estrada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONDE O AVISO ENTRA
--
-- Na transição para 'Em Entrega', que é o momento em que a informação nasce —
-- e não quando alguém abre uma tela. Gatilho em `pedidos`, não um IF na tela
-- de Compras: o mesmo motivo das migrs. 425, 440, 442, 444, 446 e 448. Pedido
-- que mude de estado pelo F12, por correção em SQL ou por um fluxo futuro
-- avisa igual.
--
-- O destinatário é `logistica` — o setor que confere a mercadoria, pela
-- separação que a migr. 284 fixou: quem emite o pedido não confirma a própria
-- entrega. E o link leva direto a `estoque-recebimentos`, que é onde a ação
-- acontece.
--
-- POR QUE SÓ NA TRANSIÇÃO
--
-- `AFTER UPDATE OF status ... WHEN (novo = 'Em Entrega' AND antigo <> ...)`
-- dispara uma vez por pedido. Sem o `WHEN`, qualquer edição de valor ou prazo
-- reemitiria o aviso e o sino viraria ruído — e aviso que aparece sempre para
-- de ser lido, que é o mesmo raciocínio da faixa de fila de trabalho.
--
-- O pedido que JÁ está 'Em Entrega' hoje não gera notificação retroativa: o
-- gatilho age na travessia. Para esses oito, quem passa a mostrar é a bolinha
-- na barra lateral, que conta estado e não evento — as duas peças se completam
-- de propósito.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_pedido_avisa_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_numero    text;
  v_fornec    text;
  v_descricao text;
BEGIN
  v_numero := COALESCE(NEW.numero, 'Pedido #' || upper(right(NEW.id::text, 6)));

  SELECT nome INTO v_fornec FROM public.fornecedores WHERE id = NEW.fornecedor_id;

  -- O que chega, para o aviso valer sozinho: quem lê no sino precisa saber se
  -- é a carga que estava esperando sem abrir mais nada.
  v_descricao := COALESCE(NULLIF(btrim(COALESCE(NEW.item_descricao, '')), ''),
                          (SELECT nome FROM public.produtos WHERE id = NEW.produto_id),
                          'mercadoria');

  PERFORM public.notificar_setor(
    p_setor     => 'logistica',
    p_tipo      => 'aprovacao_pendente',
    p_titulo    => 'Carga a caminho: ' || v_numero,
    p_mensagem  => v_descricao
                   || COALESCE(' — ' || v_fornec, '')
                   || COALESCE(' · chega em ' || to_char(NEW.prazo_entrega, 'DD/MM'), '')
                   || '. Registre o recebimento quando a mercadoria chegar.',
    p_link_view => 'estoque-recebimentos',
    p_urgencia  => 'Média',
    p_ref_id    => NEW.id,
    p_filial    => NEW.filial
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_pedido_avisa_estoque() IS
  'Avisa a logística quando o pedido entra em entrega (migr. 457). No gatilho, não na tela de Compras: a carga que sai por qualquer caminho precisa chegar ao conferente.';

DROP TRIGGER IF EXISTS trg_pedido_avisa_estoque ON public.pedidos;
CREATE TRIGGER trg_pedido_avisa_estoque
  AFTER UPDATE OF status ON public.pedidos
  FOR EACH ROW
  WHEN (NEW.status = 'Em Entrega' AND OLD.status IS DISTINCT FROM 'Em Entrega')
  EXECUTE FUNCTION public.fn_pedido_avisa_estoque();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. o gatilho no lugar
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.pedidos'::regclass AND tgname = 'trg_pedido_avisa_estoque';
--
--   -- 2. a fila que existe agora, e que a bolinha da barra lateral passa a
--   --    mostrar (o gatilho só pega os próximos)
--   SELECT filial, COALESCE(numero, upper(right(id::text, 6))) AS pedido,
--          item_descricao, prazo_entrega
--     FROM pedidos
--    WHERE ativo AND status = 'Em Entrega' AND recebido_em IS NULL
--    ORDER BY filial, prazo_entrega NULLS LAST;
--
--   -- 3. depois de mover um pedido para 'Em Entrega' pela tela de Compras,
--   --    o aviso tem de existir para a logística daquela filial
--   SELECT setor, titulo, mensagem, link_view, filial, created_at
--     FROM notificacoes
--    WHERE link_view = 'estoque-recebimentos'
--    ORDER BY created_at DESC LIMIT 5;
--
-- O teste que vale a aula: em Compras, mover um pedido para "Em Entrega" e ver
-- o sino acender para quem está na logística — sem ninguém avisar por fora do
-- sistema, que é o ponto do exercício.
-- =================================================================
