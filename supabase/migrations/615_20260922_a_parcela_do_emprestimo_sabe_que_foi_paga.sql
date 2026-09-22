-- 615_20260922_a_parcela_do_emprestimo_sabe_que_foi_paga.sql
--
-- `parcelas_emprestimo.status` nasce 'Pendente' e NUNCA muda. Não há gatilho,
-- não há RPC, não há UPDATE em lugar nenhum do sistema que o mova para 'Paga'.
-- A baixa acontece na conta a pagar; a parcela nem fica sabendo.
--
-- Ninguém percebeu porque nenhuma parcela venceu ainda. Em 21/10 a SuperMax
-- paga a primeira: o dinheiro sai do caixa, o título é quitado — e o painel
-- "Parcelas em Aberto" da unidade continua listando as 60, para sempre, porque
-- ele filtra por `status = 'Pendente'`. A memória de cálculo também nunca
-- mostraria "juros já pagos".
--
-- A parcela passa a seguir o título: quitou a conta a pagar, a parcela é paga;
-- desfez a baixa, ela volta a pendente. O título é a fonte — é nele que o
-- dinheiro se move, e é ele que tem `pago_em`, que é de onde a pontualidade
-- vai sair depois.
--
-- AFTER, não BEFORE: o sync não participa da decisão da baixa, só registra o
-- efeito dela. E `OF status` para não disparar em toda edição de descrição ou
-- vencimento.
--
-- 'Parcial' não é 'Paga': meia parcela paga é parcela em aberto, e é assim que
-- a unidade tem de enxergar na tela.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_parcela_emprestimo_segue_o_titulo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.origem, '') <> 'emprestimo' THEN
    RETURN NEW;
  END IF;

  UPDATE public.parcelas_emprestimo
     SET status = CASE WHEN NEW.status = 'Pago' THEN 'Paga' ELSE 'Pendente' END
   WHERE contas_pagar_id = NEW.id
     AND status IS DISTINCT FROM CASE WHEN NEW.status = 'Pago' THEN 'Paga' ELSE 'Pendente' END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_contas_pagar_sync_parcela ON public.contas_pagar;
CREATE TRIGGER trg_contas_pagar_sync_parcela
  AFTER UPDATE OF status ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_parcela_emprestimo_segue_o_titulo();

-- O que já foi pago antes deste gatilho existir.
UPDATE public.parcelas_emprestimo pe
   SET status = 'Paga'
  FROM public.contas_pagar cp
 WHERE cp.id = pe.contas_pagar_id
   AND cp.status = 'Pago'
   AND pe.status <> 'Paga';

COMMIT;
