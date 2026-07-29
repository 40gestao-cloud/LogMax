-- 291 — Afastamento: período sem limite, e reversão que não alcançou o passado.
--
-- ACHADO (ao conferir a 290). A turma `logmax-aprendiz` tinha 1.547 dias de
-- ponto marcados como 'Justificado' — mais do que a turma inteira trabalhou.
-- Dois defeitos distintos por trás:
--
-- 1. PERÍODO SEM TETO. `aplicar_afastamento_no_ponto` percorre dia a dia de
--    data_inicio até data_fim e insere uma linha por dia. Nada valida o
--    tamanho do período. Havia três afastamentos indo de 2026-07-01 até
--    2028-07-24 — 755 dias cada, 1.482 deles no FUTURO. Como dia
--    'Justificado' vale zero desconto em `recalcular_folha_do_ponto`, um
--    afastamento digitado com o ano errado perdoa falta de alguém até 2028,
--    em silêncio, e ninguém revisa 755 linhas para descobrir.
--
--    A tela valida só `data_fim >= data_inicio`. Um dedo errado no ano passa.
--
-- 2. ÓRFÃOS ANTERIORES À 273. A migr. 273 criou o trigger que reverte o ponto
--    quando o afastamento é inativado — mas só passou a valer dali para a
--    frente. Quem foi inativado ANTES continuou segurando o ponto como
--    'Justificado': 792 linhas em 2 afastamentos, todas invisíveis, todas
--    perdoando falta. É exatamente o defeito que a 273 descreveu ("a falta
--    desaparece, recalcular_folha_do_ponto segue sem descontar"), no acervo
--    que ela não varreu.
--
-- Turmas afetadas: só `logmax-aprendiz`. ERP, contabilidade e adm têm zero em
-- ambas as contas — mas a trava vale para as quatro, é o mecanismo que falhava.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Teto de período
--
-- Só dispara quando as datas MUDAM (ou no INSERT). Validar em todo UPDATE
-- travaria a inativação das linhas longas que já existem — o usuário ficaria
-- sem conseguir arrumar justamente o que esta migração veio expor.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.afastamento_valida_periodo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_limite_dias  constant int := 365;
  v_limite_frente constant int := 365;
  v_hoje date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.data_inicio IS NOT DISTINCT FROM OLD.data_inicio
     AND NEW.data_fim    IS NOT DISTINCT FROM OLD.data_fim THEN
    RETURN NEW;
  END IF;

  IF NEW.data_fim < NEW.data_inicio THEN
    RAISE EXCEPTION 'Fim (%) não pode ser antes do início (%).', NEW.data_fim, NEW.data_inicio
      USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.data_fim - NEW.data_inicio) + 1 > v_limite_dias THEN
    RAISE EXCEPTION 'Afastamento de % dias excede o limite de % dias. Confira o ano das datas (% a %).',
      (NEW.data_fim - NEW.data_inicio) + 1, v_limite_dias, NEW.data_inicio, NEW.data_fim
      USING ERRCODE = 'P0001';
  END IF;

  -- Agendar afastamento futuro é legítimo (licença maternidade, cirurgia
  -- marcada). Ir além de um ano à frente é dedo errado no ano, não plano.
  IF NEW.data_fim > v_hoje + v_limite_frente THEN
    RAISE EXCEPTION 'Fim em % passa de um ano à frente. Confira o ano.', NEW.data_fim
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_afastamento_valida_periodo ON public.afastamentos;
CREATE TRIGGER trg_afastamento_valida_periodo
  BEFORE INSERT OR UPDATE ON public.afastamentos
  FOR EACH ROW EXECUTE FUNCTION public.afastamento_valida_periodo();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Varredura dos órfãos anteriores à 273
--
-- Reusa `reverter_afastamento_no_ponto`, que é quem sabe distinguir o dia que
-- só existia por causa do afastamento (apaga) do dia que já tinha registro e
-- foi sobrescrito (restaura status_antes_afastamento).
--
-- Órfão antigo não tem status_antes_afastamento preenchido — a 273 é que criou
-- a coluna. Nesse caso a função cai no COALESCE(..., 'Falta'), que é a leitura
-- correta: o dia volta a ser falta até alguém dizer o contrário.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
  v_total int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT a.id
      FROM public.afastamentos a
      JOIN public.ponto_eletronico p ON p.afastamento_id = a.id
     WHERE COALESCE(a.ativo, true) = false
  LOOP
    PERFORM public.reverter_afastamento_no_ponto(r.id);
    v_total := v_total + 1;
  END LOOP;

  RAISE NOTICE 'Afastamentos inativos revertidos no ponto: %', v_total;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Deve devolver 0: nenhum afastamento inativo segurando ponto.
--   SELECT count(*) FROM ponto_eletronico p
--     JOIN afastamentos a ON a.id = p.afastamento_id
--    WHERE COALESCE(a.ativo, true) = false;
--
--   -- Afastamentos ATIVOS longos demais, que a trava não pode desfazer
--   -- sozinha (são dado seu, não bug do mecanismo):
--   SELECT id, nome_funcionario, tipo, data_inicio, data_fim,
--          (data_fim - data_inicio) + 1 AS dias
--     FROM afastamentos
--    WHERE COALESCE(ativo, true)
--      AND (data_fim - data_inicio) + 1 > 365
--    ORDER BY dias DESC;
--
-- ────────────────────────────────────────────────────────────────────────────
-- PARA RODAR À MÃO, se decidir encurtar os afastamentos longos acima.
-- Não vai no corpo da migração de propósito: apagar dia justificado de alguém
-- é decisão sua, não efeito colateral de aplicar um arquivo.
--
-- Inativar o afastamento já dispara a reversão do ponto (trigger da 273):
--
--   UPDATE afastamentos SET ativo = false WHERE id = '<id>';
--
-- Para corrigir a data em vez de descartar, reverta e reaplique:
--
--   SELECT reverter_afastamento_no_ponto('<id>');
--   UPDATE afastamentos SET data_fim = '<AAAA-MM-DD>' WHERE id = '<id>';
--   SELECT aplicar_afastamento_no_ponto('<id>');
-- ────────────────────────────────────────────────────────────────────────────
