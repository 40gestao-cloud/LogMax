-- 546 — O recebimento confirmado não some sem estornar a entrada.
--
-- `RecebimentosView.handleDelete` é isto, inteiro:
--
--     if (!await confirm('Inativar este recebimento? Ele sairá da lista mas o
--                         histórico fica preservado.')) return;
--     await dbDelete('/api/recebimentosview', id);
--
-- Sem olhar o status. Um recebimento 'Concluído' — a carga que JÁ entrou no
-- estoque — sai da lista com esse texto, que promete o oposto do que acontece:
-- o histórico NÃO fica preservado, ele fica pela metade. A movimentação de
-- Entrada continua ativa, o saldo continua inflado, e o lote de validade
-- continua na fila.
--
-- E tem um segundo efeito, novo desde a migr. 531: `fn_recebimento_fecha_pedido`
-- vê que sumiu o único recebimento 'Concluído' e devolve o pedido para
-- 'Em Entrega', limpando `recebido_em`. Então o pedido volta para a fila de
-- "a receber" com a mercadoria dele já contada no saldo. As duas filas mentem
-- ao mesmo tempo, em direções opostas.
--
-- ─── ESTADO NA BASE (ERP, 26/08) ───────────────────────────────────────────
--
--   PC-ML-2026-0048 · recebimento 'Concluído' inativado
--   movimentação de Entrada de 9 un. ATIVA
--   "Boné 9FORTY Ajustável New Era" com 27 un. em saldo — 9 delas fantasma
--
-- ─── A SAÍDA CERTA JÁ EXISTE, E TEM NOME ───────────────────────────────────
--
-- `cancelar_pedido_compra` já sabe dizer isto, com estas palavras:
--
--     'Este pedido ja teve recebimento confirmado - a mercadoria entrou no
--      estoque. Registre uma devolucao ao fornecedor em vez de cancelar.'
--
-- A devolução (migr. 423) faz o trabalho inteiro: baixa o estoque, encolhe o
-- lote em FEFO, abate ou cancela a conta a pagar, reabre o pedido se houver
-- reenvio. Excluir o recebimento não faz nada disso — só apaga a linha que
-- explicava por que o saldo subiu.
--
-- ─── DUAS PEÇAS, PORQUE SÃO DUAS PERGUNTAS ─────────────────────────────────
--
--   1. Um guard, que barra o aluno. É a régua de negócio: conferência feita não
--      se apaga, se devolve.
--   2. Um estorno, que roda para quem passa pelo guard — service_role e o
--      professor, que são quem conserta a base. Se o registro tem de sumir, o
--      saldo tem de voltar junto; deixar a decisão do professor produzir o
--      MESMO estado inconsistente que estamos consertando seria escrever a
--      próxima migração agora.
--
-- O estorno inativa a movimentação em vez de apagá-la: `fn_atualiza_estoque_produto`
-- já desfaz o efeito de linha inativa desde sempre ("Linha inativa não pesa no
-- saldo — é assim que soft delete e edição passam a reverter"), e a linha
-- continua no histórico dizendo o que houve.
--
-- Se a mercadoria já foi vendida, o estorno deixaria o saldo negativo e
-- `fn_atualiza_estoque_produto` aborta a transação com "Estoque insuficiente".
-- A checagem antecipada existe só para trocar essa frase por uma que diga o que
-- fazer — não dá para desfazer uma entrada que já virou venda.
--
-- IMEIs (migr. 444) ficam de fora de propósito: `unidades_estoque` tem status
-- próprio e uma unidade já vendida não pode ser removida por baixo da venda.
-- Elas continuam ligadas ao recebimento inativo, visíveis, para o professor
-- resolver caso a caso.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Guard: conferência feita não se exclui
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recebimento_confirmado_nao_some()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Só a transição ativa → inativa interessa. Reativar e o resto dos updates
  -- não são assunto deste guard.
  IF NOT (COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)) THEN
    RETURN NEW;
  END IF;

  -- Recebimento ainda 'Pendente' é rascunho: nada entrou, some à vontade.
  IF COALESCE(OLD.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NEW;
  END IF;

  -- Quem conserta a base passa — e o estorno da peça 2 roda para eles.
  IF public.auth_is_service_role() OR public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Este recebimento já foi conferido: a mercadoria entrou no estoque e a conta do fornecedor foi liberada. Excluí-lo agora tiraria da tela a linha que explica por que o saldo subiu, sem tirar o saldo. Se a carga voltou para o fornecedor, registre a devolução na própria linha — ela baixa o estoque, encolhe o lote e abate a conta a pagar.'
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_recebimento_confirmado_nao_some ON public.recebimentos;
CREATE TRIGGER trg_recebimento_confirmado_nao_some
  BEFORE UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_confirmado_nao_some();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Estorno: se o registro sai, o saldo volta junto
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recebimento_inativo_estorna_entrada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mov   record;
  v_saldo numeric;
  v_nome  text;
BEGIN
  IF NOT (COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)) THEN
    RETURN NULL;
  END IF;

  FOR v_mov IN
    SELECT m.id, m.produto_id, m.qtd
      FROM public.movimentacoes_estoque m
     WHERE m.recebimento_id = NEW.id
       AND m.tipo = 'Entrada'
       AND COALESCE(m.ativo, true)
  LOOP
    SELECT estoque, nome INTO v_saldo, v_nome
      FROM public.produtos WHERE id = v_mov.produto_id;

    -- Mensagem antes do erro genérico do gatilho de saldo. Ele abortaria a
    -- transação de qualquer jeito; o que muda aqui é o aluno (ou o professor)
    -- saber por quê.
    IF COALESCE(v_saldo, 0) - COALESCE(v_mov.qtd, 0) < 0 THEN
      RAISE EXCEPTION
        'Não dá para desfazer esta entrada: das % unidade(s) que ela trouxe de "%", só % ainda estão em estoque — o resto já saiu (venda, consumo ou transferência). Estornar deixaria o saldo negativo. Registre uma devolução ao fornecedor pela quantidade que ainda existe.',
        trim_scale(COALESCE(v_mov.qtd, 0)), COALESCE(v_nome, 'produto'),
        trim_scale(COALESCE(v_saldo, 0))
        USING ERRCODE = 'P0001';
    END IF;

    -- Só `ativo`: `movimentacoes_estoque` não tem coluna de observação, e
    -- escrever a explicação em `origem` ou `destino` sobrescreveria o número do
    -- pedido, que é o que liga a entrada à compra. Quem conta a história é o
    -- `trg_historico` da tabela e o recebimento inativo ao lado.
    UPDATE public.movimentacoes_estoque
       SET ativo = false
     WHERE id = v_mov.id;
  END LOOP;

  -- O lote de validade nasceu desta carga (migr. 424): sem a carga ele não tem
  -- de que ser lote. Fica inativo, não apagado.
  UPDATE public.vencimentos_estoque
     SET ativo = false
   WHERE recebimento_id = NEW.id AND COALESCE(ativo, true);

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recebimento_estorna_entrada ON public.recebimentos;
CREATE TRIGGER trg_recebimento_estorna_entrada
  AFTER UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_inativo_estorna_entrada();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Conserto do que já está torto
-- ────────────────────────────────────────────────────────────────────────────
-- Toda movimentação de Entrada ainda ativa cujo recebimento já foi inativado.
-- Uma a uma, porque uma que não pode ser estornada (mercadoria já vendida) não
-- pode derrubar as outras — ela vira NOTICE e fica para o professor.
DO $repara$
DECLARE
  v_mov   record;
  v_saldo numeric;
  v_nome  text;
  v_ok    integer := 0;
  v_pulou integer := 0;
BEGIN
  FOR v_mov IN
    SELECT m.id, m.produto_id, m.qtd, m.filial, r.id AS receb_id
      FROM public.movimentacoes_estoque m
      JOIN public.recebimentos r ON r.id = m.recebimento_id
     WHERE m.tipo = 'Entrada'
       AND COALESCE(m.ativo, true)
       AND COALESCE(r.ativo, true) IS FALSE
  LOOP
    SELECT estoque, nome INTO v_saldo, v_nome
      FROM public.produtos WHERE id = v_mov.produto_id;

    IF COALESCE(v_saldo, 0) - COALESCE(v_mov.qtd, 0) < 0 THEN
      v_pulou := v_pulou + 1;
      RAISE NOTICE
        'MIGR 546: entrada de % un. de "%" (%) NÃO estornada — o saldo atual é % e ficaria negativo. Recebimento %.',
        trim_scale(COALESCE(v_mov.qtd, 0)), COALESCE(v_nome, '?'), v_mov.filial,
        trim_scale(COALESCE(v_saldo, 0)), v_mov.receb_id;
      CONTINUE;
    END IF;

    UPDATE public.movimentacoes_estoque
       SET ativo = false
     WHERE id = v_mov.id;
    v_ok := v_ok + 1;
  END LOOP;

  UPDATE public.vencimentos_estoque v
     SET ativo = false
    FROM public.recebimentos r
   WHERE v.recebimento_id = r.id
     AND COALESCE(v.ativo, true)
     AND COALESCE(r.ativo, true) IS FALSE;

  RAISE NOTICE 'MIGR 546: % entrada(s) estornada(s), % pulada(s).', v_ok, v_pulou;
END;
$repara$;

COMMIT;
