-- 519 — A aprovação não sobrevive à requisição excluída.
--
-- O admin excluía uma requisição em Aprovações, a tela dizia "excluído", e o
-- card continuava lá. Ele clicava de novo, de novo, e concluía que não dava
-- para excluir. Dava: a requisição ia mesmo para `ativo = false`. O que ficava
-- era a APROVAÇÃO — outra tabela, sem coluna `ativo`, que ninguém mandava
-- embora junto. A lista de Aprovações lê `aprovacoes_compras`, não
-- `requisicoes`; enquanto a linha da aprovação existir, o card existe.
--
-- O hard delete já levava a aprovação junto (FK ON DELETE CASCADE). O soft
-- delete, que é o caminho que a tela usa, não levava nada — é o mesmo buraco
-- de sempre: soft-delete não cascateia sozinho.
--
-- Dois estragos, não um:
--   1. decisão já tomada → o card fica para sempre em "Decisões tomadas",
--      marcado "requisição excluída";
--   2. decisão ainda pendente → a aprovação continua na fila sem requisição
--      legível, e a tela acusa "aprovação pendente sem requisição" num aviso
--      amarelo que nunca apaga. Havia 36 linhas assim nas quatro turmas
--      (25 só na LogMax-ERP).
--
-- Excluir é o último recurso do admin e significa "some com o documento e com
-- a correspondência dele nas outras telas" — é o que a própria confirmação
-- promete. A aprovação é correspondência do documento, não documento à parte.
--
-- Reabrir continua funcionando: `reabrir_requisicao` já recria a aprovação
-- quando não acha nenhuma (o INSERT no ramo `v_ap_id IS NULL`).

BEGIN;

CREATE OR REPLACE FUNCTION public.aprovacao_segue_a_requisicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Só a transição ativa → inativa. Reabrir (inativa → ativa) passa livre, e
  -- os outros updates não são assunto deste gatilho.
  IF COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true) THEN
    DELETE FROM public.aprovacoes_compras WHERE requisicao_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.aprovacao_segue_a_requisicao() IS
  'Soft-delete de requisição leva a aprovação junto — o hard delete já levava pela FK.';

DROP TRIGGER IF EXISTS trg_aprovacao_segue_requisicao ON public.requisicoes;
CREATE TRIGGER trg_aprovacao_segue_requisicao
  AFTER UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.aprovacao_segue_a_requisicao();

-- Limpeza do que já ficou para trás: aprovação cuja requisição está inativa
-- (ou nem existe mais). São os cards que o admin tentou excluir e voltaram.
DELETE FROM public.aprovacoes_compras a
 WHERE NOT EXISTS (
   SELECT 1 FROM public.requisicoes r
    WHERE r.id = a.requisicao_id AND COALESCE(r.ativo, true)
 );

COMMIT;
