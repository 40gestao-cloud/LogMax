-- 341 — `pdi_itens` e `movimentacoes_carreira` ganham filial, e entram na trilha.
--
-- Ficaram de fora da migr. 337 por um motivo específico: a policy do histórico
-- (`historico_select`, migr. 331) libera linha com `filial IS NULL` para todo
-- usuário autenticado. Sem a coluna, a trilha do plano de desenvolvimento de
-- uma pessoa e a do movimento de carreira dela vazariam para o sistema inteiro
-- — inclusive para outra filial.
--
-- A coluna resolve a causa, não o sintoma. E ela vem preenchida de onde a
-- informação já existe:
--
--   pdi_itens              → filial da avaliação a que o item pertence
--   movimentacoes_carreira → filial de destino da movimentação (é para onde a
--                            pessoa vai), com a de origem e a do cadastro como
--                            recurso quando a de destino não foi informada
--
-- Trigger mantém preenchido daqui para a frente, para a tela não precisar saber
-- disso.
--
-- Como na 337, `salario_novo` NÃO entra nas colunas observadas: a trilha é lida
-- por quem enxerga a filial, e registrar a mudança de salário publicaria a
-- folha de cada colega. Cargo e departamento entram — são públicos na prática e
-- são o que dá sentido à movimentação.

BEGIN;

-- ── pdi_itens ───────────────────────────────────────────────────────────────

ALTER TABLE public.pdi_itens ADD COLUMN IF NOT EXISTS filial text;

UPDATE public.pdi_itens p
   SET filial = a.filial
  FROM public.avaliacoes a
 WHERE a.id = p.avaliacao_id AND p.filial IS NULL;

CREATE OR REPLACE FUNCTION public.set_filial_pdi_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.filial IS NULL AND NEW.avaliacao_id IS NOT NULL THEN
    SELECT a.filial INTO NEW.filial FROM public.avaliacoes a WHERE a.id = NEW.avaliacao_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_filial_pdi_item ON public.pdi_itens;
CREATE TRIGGER trg_filial_pdi_item
  BEFORE INSERT OR UPDATE ON public.pdi_itens
  FOR EACH ROW EXECUTE FUNCTION public.set_filial_pdi_item();

CREATE INDEX IF NOT EXISTS idx_pdi_itens_filial ON public.pdi_itens (filial);

-- ── movimentacoes_carreira ──────────────────────────────────────────────────

ALTER TABLE public.movimentacoes_carreira ADD COLUMN IF NOT EXISTS filial text;

UPDATE public.movimentacoes_carreira m
   SET filial = COALESCE(m.filial_nova, m.filial_anterior,
                         (SELECT f.filial FROM public.funcionarios f WHERE f.id = m.funcionario_id))
 WHERE m.filial IS NULL;

CREATE OR REPLACE FUNCTION public.set_filial_movimentacao_carreira()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.filial IS NULL THEN
    NEW.filial := COALESCE(
      NEW.filial_nova,
      NEW.filial_anterior,
      (SELECT f.filial FROM public.funcionarios f WHERE f.id = NEW.funcionario_id));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_filial_movimentacao_carreira ON public.movimentacoes_carreira;
CREATE TRIGGER trg_filial_movimentacao_carreira
  BEFORE INSERT OR UPDATE ON public.movimentacoes_carreira
  FOR EACH ROW EXECUTE FUNCTION public.set_filial_movimentacao_carreira();

CREATE INDEX IF NOT EXISTS idx_mov_carreira_filial ON public.movimentacoes_carreira (filial);

-- ── Trilha ──────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_historico ON public.pdi_itens;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.pdi_itens
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('descricao', 'prazo');

DROP TRIGGER IF EXISTS trg_historico ON public.movimentacoes_carreira;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.movimentacoes_carreira
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('tipo', 'cargo_novo', 'departamento_novo');

-- ── Apagão didático ─────────────────────────────────────────────────────────
-- Nenhuma das duas entra: são registro de pessoa, e a 339 já decidiu que o
-- apagão leva o movimento da operação, não o cadastro nem a vida funcional.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rode a 333 (backfill) depois desta: idempotente, dá ponto de partida às duas
-- tabelas novas sem tocar no que já tem trilha.
--
-- Verificação:
--
--   -- 1) Ninguém ficou sem filial (o que restar é órfão de avaliação/funcionário):
--   SELECT count(*) FILTER (WHERE filial IS NULL) AS sem_filial, count(*) FROM pdi_itens;
--   SELECT count(*) FILTER (WHERE filial IS NULL) AS sem_filial, count(*) FROM movimentacoes_carreira;
--
--   -- 2) 29 tabelas com trilha:
--   SELECT count(DISTINCT tgrelid) FROM pg_trigger WHERE tgname = 'trg_historico';
--
--   -- 3) Nenhuma linha de histórico pode conter salário:
--   SELECT count(*) FROM historico_operacoes
--    WHERE entidade = 'movimentacoes_carreira' AND detalhe ILIKE '%salario%';
