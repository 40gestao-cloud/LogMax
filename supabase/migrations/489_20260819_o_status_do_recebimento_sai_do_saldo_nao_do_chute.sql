-- 489 — O "Status final" do recebimento passa a sair do saldo, não do select.
--
-- O painel de Confirmar imprime, na linha de cima, "Pedido 42 · Já recebido 5 ·
-- Saldo restante 37". Logo abaixo, perguntava ao conferente, num select solto e
-- com "Concluído" pré-selecionado, se a entrega estava completa. Ou seja:
-- perguntava algo que o sistema já sabia, e aceitava qualquer resposta.
--
-- Os dois erros possíveis são silenciosos e caros:
--
--   (a) Concluído com saldo em aberto → `fn_pedido_marca_recebimento` põe o
--       pedido em 'Recebido', a tela filtra 'Recebido' fora da lista de
--       recebimento, e o RESTO DA CARGA nunca mais tem como entrar. Ainda
--       carimba `recebido_em`, que é a régua de pontualidade do fornecedor.
--
--   (b) Parcial sempre → nunca existe recebimento 'Concluído', e
--       `conta_pagar_exige_recebimento` recusa o pagamento para sempre. A
--       mensagem que aparece ("registre o recebimento antes de pagar") mente:
--       o recebimento foi registrado, conferido e deu entrada no estoque.
--
-- Caso vivo na LogMax-ERP quando isto foi escrito: PC-SM-2026-0140, 42 pedidas,
-- 5 recebidas, recebimento 'Parcial', conta de R$ 252,00 impagável.
--
-- Em ERP real o goods receipt não pergunta: ele fecha quando a quantidade
-- fecha. Encerrar uma entrega com saldo em aberto existe (o fornecedor avisou
-- que não manda o resto, a sobra foi cancelada), mas é ATO DELIBERADO e
-- separado — "delivery completed" no SAP —, não o valor default de um select.
--
-- A regra passa a viver aqui, no banco, e não na tela: é o mesmo caminho que a
-- turma percorre pelo F12, e a tela só espelha.

BEGIN;

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS encerrado_com_saldo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_encerramento text;

COMMENT ON COLUMN public.recebimentos.encerrado_com_saldo IS
  'Entrega encerrada com saldo em aberto por decisão explícita (migr. 489). '
  'Só assim um recebimento fecha o pedido sem a quantidade ter fechado.';
COMMENT ON COLUMN public.recebimentos.motivo_encerramento IS
  'Por que a entrega foi encerrada faltando mercadoria. Obrigatório quando '
  'encerrado_com_saldo é true.';

CREATE OR REPLACE FUNCTION public.fn_recebimento_status_pelo_saldo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedida   numeric;
  v_recebido numeric;
  v_reenvio  numeric;
  v_ja       numeric;
  v_total    numeric;
  v_saldo    numeric;
BEGIN
  -- 'Pendente' é "chegou, ainda não foi conferido" — não decide nada. Só a
  -- confirmação (Concluído/Parcial) passa por aqui.
  IF COALESCE(NEW.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NEW;
  END IF;
  IF NEW.pedido_id IS NULL OR COALESCE(NEW.ativo, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- A MESMA conta que a tela mostra. Usar a view (e não um SUM próprio) é o que
  -- impede o banco e o painel de discordarem sobre o mesmo pedido — inclusive
  -- sobre a devolução com reenvio esperado, que devolve saldo ao pedido.
  SELECT qtd_pedida, qtd_recebida_total, qtd_devolvida_reenvio
    INTO v_pedida, v_recebido, v_reenvio
    FROM public.v_pedido_saldo
   WHERE pedido_id = NEW.pedido_id;

  -- Pedido sem quantidade não permite dizer se fechou. Deixa como veio em vez
  -- de inventar: recusar a conferência por causa de um campo em branco do
  -- pedido seria devolver ao almoxarifado um problema de Compras.
  IF COALESCE(v_pedida, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- No UPDATE a linha já está contada na view; no INSERT ainda não.
  v_ja := CASE WHEN TG_OP = 'UPDATE' AND COALESCE(OLD.ativo, true)
               THEN COALESCE(OLD.qtd_recebida, 0) ELSE 0 END;
  v_total := COALESCE(v_recebido, 0) - v_ja + COALESCE(NEW.qtd_recebida, 0);
  v_saldo := (v_pedida + COALESCE(v_reenvio, 0)) - v_total;

  -- Meia milésima de tolerância: a escala do banco é numeric(15,3) e 12,5
  -- digitado x 12,5 lido podem diferir na última casa (mesma régua do teto de
  -- quantidade na tela).
  IF v_saldo <= 0.0005 THEN
    NEW.status              := 'Concluído';
    NEW.encerrado_com_saldo := false;
    NEW.motivo_encerramento := NULL;
  ELSIF COALESCE(NEW.encerrado_com_saldo, false) THEN
    IF COALESCE(btrim(NEW.motivo_encerramento), '') = '' THEN
      RAISE EXCEPTION 'Encerrar a entrega com saldo em aberto exige o motivo — escreva o que aconteceu com as % unidade(s) que faltam.',
        to_char(v_saldo, 'FM999999990.999') USING ERRCODE = 'P0001';
    END IF;
    NEW.status := 'Concluído';
  ELSE
    NEW.status              := 'Parcial';
    NEW.motivo_encerramento := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Nome escolhido para ORDENAR ANTES de trg_recebimento_segregacao_guard
-- ('sa' < 'se'): gatilhos BEFORE disparam em ordem alfabética, e a promoção
-- para 'Concluído' precisa acontecer antes do guard que checa exatamente esse
-- status — senão quem emitiu o pedido fecharia o próprio recebimento pela
-- porta dos fundos, mandando 'Parcial' e deixando o banco promover.
DROP TRIGGER IF EXISTS trg_recebimento_saldo_status ON public.recebimentos;
CREATE TRIGGER trg_recebimento_saldo_status
  BEFORE INSERT OR UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_status_pelo_saldo();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
--
--   -- ordem dos gatilhos BEFORE (saldo_status tem de vir antes do guard):
--   SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE c.relname = 'recebimentos' AND NOT tgisinternal ORDER BY tgname;
--
-- TESTE MANUAL
--   recebe tudo de uma vez        → status vira 'Concluído', pedido encerra
--   recebe metade                 → vira 'Parcial' mesmo escolhendo Concluído
--   recebe o resto                → vira 'Concluído', conta libera para pagar
--   encerra com saldo sem motivo  → recusa
--   encerra com saldo com motivo  → 'Concluído', pedido encerra com falta
-- ════════════════════════════════════════════════════════════════════════════
