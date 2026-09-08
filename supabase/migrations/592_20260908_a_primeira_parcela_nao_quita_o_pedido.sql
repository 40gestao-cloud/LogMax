-- ════════════════════════════════════════════════════════════════════════════
-- 592 — A primeira parcela não quita o pedido inteiro
--
-- PAGAR 1 DE 3 PARCELAS MARCAVA O PEDIDO COMO PAGO — E O TIRAVA DA FILA DO
-- FINANCEIRO COM DOIS TERÇOS DO DINHEIRO NA RUA.
--
-- Reproduzido no PV-SM-2026-0001 (3 parcelas de R$ 300,00), em transação
-- revertida: marcando só a parcela 1/3 como paga, o pedido virou 'Pago' com
-- 2 parcelas e R$ 600,00 em aberto. A tela Financeiro > Pedidos de Venda
-- filtra por `pago_em`, então o documento sai da fila e ninguém mais o vê.
--
-- ── Onde o elo se perdeu ────────────────────────────────────────────────────
--
-- A migr. 569 passou a gerar UM TÍTULO POR PARCELA, e gravou em
-- `pedidos_venda.conta_receber_id` apenas a PRIMEIRA — uma coluna não guarda
-- seis títulos. O gatilho da migr. 400, escrito quando o pedido tinha um título
-- só, continua casando por essa coluna:
--
--     WHERE conta_receber_id = NEW.id
--
-- Ou seja: ele responde "esta conta é A conta do pedido?", quando a pergunta
-- passou a ser "ainda falta alguma conta deste pedido?".
--
-- O elo certo já existe e já vem preenchido em todas as parcelas desde a 569:
-- `contas_receber.pedido_venda_id`. É por ele que a 569 varre para cancelar, e
-- é por ele que o fechamento passa a varrer agora.
--
-- ── A regra nova, nas duas direções ─────────────────────────────────────────
--
--   * fecha  → quando não sobra nenhum título em aberto E existe pelo menos um
--              pago. O "pelo menos um pago" não é preciosismo: cancelar todas
--              as parcelas também zera os abertos, e sem essa condição o
--              cancelamento marcaria o pedido como quitado.
--   * reabre → título estornado (volta a 'Aberto') devolve o pedido para a fila.
--              Sem isto, corrigir um recebimento lançado por engano deixaria o
--              pedido quitado para sempre, e o buraco voltaria pela outra porta.
--
-- `status` continua fora deste gatilho: quem o escreve é
-- `fn_pedido_venda_status_pelos_marcos`, a partir de `separado_em`/`pago_em`.
-- Limpar `pago_em` já faz o status voltar sozinho para 'Aguardando Separação'
-- ou 'Separado', conforme o caso. Duas réguas para o mesmo campo divergem no
-- primeiro ajuste — a migr. 400 já tinha aprendido isso.
--
-- ── Pedido antigo, de um título só ──────────────────────────────────────────
--
-- Continua funcionando: o pedido anterior à 569 tem `conta_receber_id`
-- apontando para o único título, e a varredura considera as duas amarrações.
-- Nas 4 turmas, hoje: nenhum pedido marcado pago com parcela em aberto — a
-- régua nova nasce sem passivo a corrigir.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._conta_receber_fecha_pedido_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ped     uuid;
  v_abertos integer;
  v_pagos   integer;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- De que pedido é este título? Pelo elo novo (uma linha por parcela) ou,
  -- para o documento anterior à migr. 569, pela coluna do próprio pedido.
  v_ped := NEW.pedido_venda_id;
  IF v_ped IS NULL THEN
    SELECT id INTO v_ped
      FROM public.pedidos_venda
     WHERE conta_receber_id = NEW.id
     LIMIT 1;
  END IF;

  IF v_ped IS NULL THEN
    RETURN NEW;
  END IF;

  -- A conta do pedido é a soma das parcelas, não a primeira delas. Título
  -- cancelado não é dívida: não segura o fechamento nem conta como pago.
  SELECT count(*) FILTER (WHERE COALESCE(c.status, '') NOT IN ('Pago', 'Recebido', 'Cancelado')),
         count(*) FILTER (WHERE c.status IN ('Pago', 'Recebido'))
    INTO v_abertos, v_pagos
    FROM public.contas_receber c
   WHERE COALESCE(c.ativo, true)
     AND (c.pedido_venda_id = v_ped
          OR c.id = (SELECT conta_receber_id FROM public.pedidos_venda WHERE id = v_ped));

  IF v_abertos = 0 AND v_pagos > 0 THEN
    UPDATE public.pedidos_venda
       SET pago_em       = COALESCE(pago_em, now()),
           pago_por      = COALESCE(pago_por, auth.uid()),
           pago_por_nome = COALESCE(
             pago_por_nome,
             (SELECT nome FROM public.user_profiles WHERE id = auth.uid()))
     WHERE id = v_ped
       AND pago_em IS NULL
       AND COALESCE(ativo, true)
       AND COALESCE(status, '') <> 'Cancelado';
  ELSIF v_abertos > 0 THEN
    -- Estorno: o pedido volta a dever, e volta para a fila do Financeiro.
    UPDATE public.pedidos_venda
       SET pago_em       = NULL,
           pago_por      = NULL,
           pago_por_nome = NULL
     WHERE id = v_ped
       AND pago_em IS NOT NULL
       AND COALESCE(ativo, true)
       AND COALESCE(status, '') <> 'Cancelado';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public._conta_receber_fecha_pedido_venda() IS
  'Fecha o pedido de venda quando TODAS as parcelas estão pagas, e o reabre se alguma for estornada (migr. 592). Antes casava por pedidos_venda.conta_receber_id, que guarda só a primeira parcela desde a migr. 569 — pagar 1 de 3 quitava o pedido inteiro.';

-- O gatilho já existe desde a migr. 400; recriado para garantir que aponta
-- para esta definição em banco que tenha divergido.
DROP TRIGGER IF EXISTS trg_conta_receber_fecha_pedido_venda ON public.contas_receber;
CREATE TRIGGER trg_conta_receber_fecha_pedido_venda
  AFTER UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public._conta_receber_fecha_pedido_venda();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. mesmo corpo nos quatro
--   SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='_conta_receber_fecha_pedido_venda';
--
--   -- 2. nenhum pedido quitado com parcela em aberto — esperado: vazio
--   SELECT pv.numero, pv.status,
--          count(*) FILTER (WHERE COALESCE(c.status,'') NOT IN ('Pago','Recebido','Cancelado')) AS abertas
--     FROM pedidos_venda pv
--     JOIN contas_receber c ON c.pedido_venda_id = pv.id AND COALESCE(c.ativo,true)
--    WHERE COALESCE(pv.ativo,true) AND pv.pago_em IS NOT NULL
--    GROUP BY pv.id, pv.numero, pv.status
--   HAVING count(*) FILTER (WHERE COALESCE(c.status,'') NOT IN ('Pago','Recebido','Cancelado')) > 0;
--
--   -- 3. exercício (transação revertida): pagar 1 de N não pode fechar
--   -- BEGIN;
--   --   UPDATE contas_receber SET status='Pago', pago_em=now()
--   --    WHERE id = (SELECT id FROM contas_receber WHERE pedido_venda_id = '<pv>' ORDER BY vencimento LIMIT 1);
--   --   SELECT numero, status, pago_em FROM pedidos_venda WHERE id = '<pv>';
--   -- ROLLBACK;
-- =================================================================
