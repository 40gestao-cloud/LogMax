-- 637_20260927_alarme_escolhe_os_dias_da_semana.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- O alarme passa a ter dias da semana
-- ═══════════════════════════════════════════════════════════════════════════
-- Até aqui o alarme da aula (migr. 529) tocava TODO dia no horário marcado:
-- o intervalo de segunda a sexta tocava também no sábado de reposição, e o
-- aviso "hoje tem avaliação" de uma quinta tocava na semana inteira.
--
-- `dias` guarda os dias em que o alarme toca, no padrão do JavaScript
-- (0 = domingo … 6 = sábado), comparados com o dia do ACRE — não o da
-- máquina. O padrão são os sete dias: alarme que já existe continua tocando
-- exatamente como antes.
--
-- ── Um alarme por horário, agora por dia ────────────────────────────────────
-- O índice único (hora, minuto) da 529 impedia "07:30 seg–qua" e "07:30
-- qui–sex" juntos, que com dias passa a ser o uso natural. Ele sai e entra um
-- gatilho que só recusa quando os DIAS se cruzam no mesmo horário — dois
-- modais empilhados no mesmo minuto continuam impossíveis. O erro sai com o
-- mesmo SQLSTATE do índice (23505), que é o que o front traduz para "Já
-- existe um alarme nesse horário".
--
-- O advisory lock serializa o gatilho: sem ele, dois cadastros simultâneos
-- no mesmo horário passariam os dois pela checagem antes de gravar.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

ALTER TABLE public.alarmes_turma
  ADD COLUMN IF NOT EXISTS dias smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alarmes_turma_dias_validos') THEN
    ALTER TABLE public.alarmes_turma
      ADD CONSTRAINT alarmes_turma_dias_validos
      CHECK (cardinality(dias) BETWEEN 1 AND 7
             AND dias <@ ARRAY[0,1,2,3,4,5,6]::smallint[]);
  END IF;
END $$;

COMMENT ON COLUMN public.alarmes_turma.dias IS
  'Migr. 637 — dias da semana em que toca (0 = domingo … 6 = sábado), no fuso do Acre.';

DROP INDEX IF EXISTS public.alarmes_turma_horario_unico;

CREATE OR REPLACE FUNCTION public.alarmes_turma_sem_sobreposicao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('alarmes_turma_horario'));
  IF EXISTS (
    SELECT 1 FROM public.alarmes_turma a
     WHERE a.hora = NEW.hora
       AND a.minuto = NEW.minuto
       AND a.dias && NEW.dias
       AND a.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Já existe um alarme nesse horário num dos dias escolhidos.'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alarmes_turma_sem_sobreposicao ON public.alarmes_turma;
CREATE TRIGGER alarmes_turma_sem_sobreposicao
  BEFORE INSERT OR UPDATE OF hora, minuto, dias ON public.alarmes_turma
  FOR EACH ROW EXECUTE FUNCTION public.alarmes_turma_sem_sobreposicao();

COMMIT;
