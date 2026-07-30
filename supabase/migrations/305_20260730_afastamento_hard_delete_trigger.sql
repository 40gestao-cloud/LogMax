-- 305 — Hard delete de afastamento sempre falhou. Separa reversão de bookkeeping.
--
-- ACHADO. `DELETE FROM afastamentos` devolve:
--
--   27000: tuple to be deleted was already modified by an operation triggered
--          by the current command
--
-- A 273 criou `trg_afastamento_reverte_ao_excluir` BEFORE DELETE, que chama
-- `reverter_afastamento_no_ponto`. Essa função faz duas coisas diferentes:
--
--   1. desfaz o que o afastamento escreveu em ponto_eletronico;
--   2. anota no PRÓPRIO afastamento que ele não está mais aplicado
--      (UPDATE afastamentos SET aplicado_no_ponto = false ...).
--
-- No caminho do DELETE, (2) tenta atualizar a linha que o comando está
-- apagando. Postgres recusa. Nunca apareceu porque a tela só faz soft delete —
-- o caminho AFTER UPDATE (inativar) funciona e é o usado no dia a dia. Hard
-- delete, feito à mão no SQL Editor, estava quebrado desde a 273.
--
-- CORREÇÃO. A parte que mexe no ponto vira função própria; a pública passa a
-- ser "reverter o ponto + anotar no afastamento". O gatilho de DELETE chama só
-- a primeira — a linha vai deixar de existir, não há o que anotar nela.
--
-- Sem mudança de comportamento em nenhum caminho que já funcionava: inativar,
-- reaplicar e a varredura da 291 continuam passando pela função pública.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma. Depende da 304 (o ramo que
-- não fabrica falta mora na função interna criada aqui).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Só o ponto — nada de escrever em afastamentos
--
-- Corpo idêntico ao da 304, menos o UPDATE final. É esta que o BEFORE DELETE
-- passa a chamar.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._reverter_ponto_do_afastamento(p_afastamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_apagados    int := 0;
  v_orfas       int := 0;
  v_restaurados int := 0;
BEGIN
  WITH apagadas AS (
    DELETE FROM public.ponto_eletronico
     WHERE afastamento_id = p_afastamento_id
       AND criado_por_afastamento = true
    RETURNING 1
  )
  SELECT count(*) INTO v_apagados FROM apagadas;

  -- Legado pré-273: sem estado anterior e sem vestígio, a linha é do
  -- afastamento. Restaurá-la como 'Falta' era inventar ausência (migr. 304).
  WITH sem_dono AS (
    DELETE FROM public.ponto_eletronico
     WHERE afastamento_id = p_afastamento_id
       AND COALESCE(criado_por_afastamento, false) = false
       AND status_antes_afastamento IS NULL
       AND entrada             IS NULL
       AND COALESCE(horas_trabalhadas, 0) = 0
       AND registrado_por_nome IS NULL
       AND observacao          IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_orfas FROM sem_dono;

  WITH restauradas AS (
    UPDATE public.ponto_eletronico
       SET status                   = COALESCE(status_antes_afastamento, 'Falta'),
           horas_trabalhadas        = COALESCE(horas_antes_afastamento, 0),
           afastamento_id           = NULL,
           status_antes_afastamento = NULL,
           horas_antes_afastamento  = NULL
     WHERE afastamento_id = p_afastamento_id
    RETURNING 1
  )
  SELECT count(*) INTO v_restaurados FROM restauradas;

  RETURN jsonb_build_object(
    'apagados',       v_apagados,
    'orfas_sem_dono', v_orfas,
    'restaurados',    v_restaurados
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._reverter_ponto_do_afastamento(uuid) FROM public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A pública = ponto + anotação. Quem inativa e quem reaplica usa esta.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverter_afastamento_no_ponto(p_afastamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public._reverter_ponto_do_afastamento(p_afastamento_id);

  UPDATE public.afastamentos
     SET aplicado_no_ponto = false,
         aplicado_em       = NULL
   WHERE id = p_afastamento_id;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.reverter_afastamento_no_ponto(uuid) FROM public;
REVOKE ALL ON FUNCTION public.reverter_afastamento_no_ponto(uuid) FROM authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. O gatilho de DELETE para de escrever no defunto
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.afastamento_reverte_ao_excluir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Só o ponto: anotar aplicado_no_ponto = false numa linha que está sendo
  -- apagada é o que devolvia 27000.
  PERFORM public._reverter_ponto_do_afastamento(OLD.id);
  RETURN OLD;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação — hard delete passa a funcionar:
--
--   BEGIN;
--     DELETE FROM afastamentos WHERE id = '<id>';
--     -- confere que o ponto do período sumiu/voltou ao estado anterior
--     SELECT count(*) FROM ponto_eletronico WHERE afastamento_id = '<id>';
--   ROLLBACK;
-- ────────────────────────────────────────────────────────────────────────────
