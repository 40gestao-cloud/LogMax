-- 449_20260817_o_material_voltava_ao_estoque_e_continuava_gasto.sql
--
-- DESFAZER A SAÍDA DEVOLVIA O MATERIAL E NÃO DEVOLVIA O DINHEIRO.
--
-- Auditoria de erro caro e silencioso (docs/auditoria-erro-silencioso.md), dois
-- padrões no mesmo ponto: "gatilho que cobre metade" e "qual é o caminho de
-- volta?".
--
-- A migr. 442 fez o material de consumo aparecer no resultado: ao dar saída de
-- uma requisição, `trg_consumo_material_do_estoque` grava a linha em
-- `consumos_material`, e o DRE soma essa linha nas despesas do mês.
--
-- O gatilho é AFTER **INSERT**. O da tabela ao lado não:
--
--   trg_atualiza_estoque   AFTER INSERT OR DELETE OR UPDATE
--   trg_consumo_material   AFTER INSERT
--
-- E `movimentacoes_estoque` tem policy de UPDATE e de DELETE para logística e
-- para o gerente da filial. Então o almoxarife que corrige a própria saída —
-- errou a quantidade, lançou no produto errado, deu baixa em duplicidade e
-- apagou uma — desfaz o estoque e **não desfaz a despesa**:
--
--   saída de 10 resmas   → estoque −10, consumo R$ 250 no DRE
--   apaga a movimentação → estoque +10, consumo R$ 250 no DRE   (errado)
--   corrige 10 → 4       → estoque +6,  consumo R$ 250 no DRE   (errado)
--
-- O material está na prateleira e continua contado como gasto. Ninguém vê: não
-- há tela que confronte a linha do consumo com a movimentação que a gerou, e o
-- erro só aparece no fechamento do mês, como resultado pior do que foi.
--
-- A FK ajuda a esconder: `movimentacao_id` é ON DELETE SET NULL. Apagar a
-- movimentação não apaga o consumo — só corta o fio que provaria a origem
-- dele. É a "regra por proxy" vista de outro ângulo: a linha continua
-- plausível, e nada mais aponta para o fato que ela dizia representar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A CORREÇÃO: O CONSUMO SEGUE A MOVIMENTAÇÃO
--
-- A movimentação é o fato; o consumo é a leitura financeira dele. Um gatilho
-- espelha os três desfazimentos possíveis:
--
--   movimentação apagada          → consumo inativado
--   movimentação inativada        → consumo inativado
--   deixou de ser Saída de requisição → consumo inativado
--   quantidade corrigida          → qtd e valor recalculados
--
-- Inativa em vez de apagar (`ativo = false`), como todo soft-delete do
-- projeto: o DRE já filtra `cm.ativo`, e a linha fica no banco para quem for
-- auditar o que foi desfeito.
--
-- O custo unitário NÃO é recalculado na correção de quantidade. Ele é o custo
-- médio do dia em que o material saiu, carimbado como a 425 carimba o custo na
-- venda; recalcular pelo preço de hoje faria uma correção de digitação mudar o
-- resultado de um mês fechado.
--
-- BEFORE DELETE, e não AFTER: depois do DELETE a FK já zerou `movimentacao_id`
-- e não haveria mais como achar a linha do consumo.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 442.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_consumo_material_segue_movimentacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vale boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.consumos_material
       SET ativo = false
     WHERE movimentacao_id = OLD.id AND ativo;
    RETURN OLD;
  END IF;

  -- A linha nova ainda representa uma saída de material de requisição?
  v_vale := COALESCE(NEW.ativo, true)
        AND NEW.requisicao_estoque_id IS NOT NULL
        AND COALESCE(NEW.tipo, '') = 'Saída'
        AND COALESCE(NEW.qtd, 0) > 0
        AND NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id;

  IF NOT v_vale THEN
    UPDATE public.consumos_material
       SET ativo = false
     WHERE movimentacao_id = NEW.id AND ativo;
    RETURN NEW;
  END IF;

  -- Quantidade corrigida: o valor acompanha, o custo unitário fica. A linha
  -- volta a valer se a movimentação tinha sido inativada e foi reativada —
  -- senão esta migração repetiria, dentro dela mesma, o erro que veio corrigir.
  UPDATE public.consumos_material cm
     SET qtd   = NEW.qtd,
         valor = ROUND(NEW.qtd * COALESCE(cm.custo_unitario, 0), 2),
         data  = COALESCE(NEW.data, cm.data),
         ativo = true
   WHERE cm.movimentacao_id = NEW.id
     AND (cm.qtd IS DISTINCT FROM NEW.qtd
          OR cm.data IS DISTINCT FROM COALESCE(NEW.data, cm.data)
          OR NOT cm.ativo)
     -- O índice único da 442 é parcial em `ativo`: reativar por cima de um
     -- lançamento novo da mesma requisição estouraria a restrição.
     AND (cm.ativo OR NOT EXISTS (
           SELECT 1 FROM public.consumos_material outro
            WHERE outro.requisicao_estoque_id = cm.requisicao_estoque_id
              AND outro.ativo AND outro.id <> cm.id));

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_consumo_material_segue_movimentacao() IS
  'Mantém `consumos_material` colado à movimentação que o gerou (migr. 449): desfazer ou corrigir a saída desfaz ou corrige a despesa no DRE. O custo unitário carimbado não é recalculado.';

DROP TRIGGER IF EXISTS trg_consumo_material_segue_mov ON public.movimentacoes_estoque;
CREATE TRIGGER trg_consumo_material_segue_mov
  AFTER UPDATE ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_consumo_material_segue_movimentacao();

DROP TRIGGER IF EXISTS trg_consumo_material_mov_apagada ON public.movimentacoes_estoque;
CREATE TRIGGER trg_consumo_material_mov_apagada
  BEFORE DELETE ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_consumo_material_segue_movimentacao();

-- O índice único da 442 é parcial em `ativo`: consumo inativado libera a
-- requisição para um lançamento novo, que é o que a correção do almoxarife
-- precisa. Nada a mudar — registrado aqui porque é o que faz o caminho de
-- volta terminar em algum lugar em vez de travar.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. os dois gatilhos no lugar — esperado: 2 linhas
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.movimentacoes_estoque'::regclass
--      AND tgname IN ('trg_consumo_material_segue_mov','trg_consumo_material_mov_apagada');
--
--   -- 2. despesa sem fato: consumo ativo cuja movimentação sumiu ou não é mais
--   --    saída de requisição — esperado: zero linhas
--   SELECT cm.id, cm.valor, cm.data
--     FROM consumos_material cm
--     LEFT JOIN movimentacoes_estoque me ON me.id = cm.movimentacao_id
--    WHERE cm.ativo
--      AND (me.id IS NULL OR NOT COALESCE(me.ativo, true) OR me.tipo <> 'Saída');
--
--   -- 3. quantidade divergente entre o fato e a despesa — esperado: zero linhas
--   SELECT cm.id, cm.qtd AS consumo, me.qtd AS movimentacao, cm.valor
--     FROM consumos_material cm
--     JOIN movimentacoes_estoque me ON me.id = cm.movimentacao_id
--    WHERE cm.ativo AND cm.qtd <> me.qtd;
--
-- Linhas que a sonda 2 acusar são anteriores a esta migração: o gatilho age na
-- alteração, não varre o passado. Zero nas 4 turmas em 17/08 — o fluxo da 442
-- é do mesmo dia e ninguém tinha desfeito uma saída ainda.
--
-- O teste que vale a aula: requisitar 10 resmas, conferir o consumo no DRE,
-- corrigir a movimentação para 4 e ver a despesa cair junto.
-- =================================================================
