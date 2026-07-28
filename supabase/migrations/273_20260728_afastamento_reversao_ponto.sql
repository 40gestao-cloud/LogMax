-- Afastamento: cancelar volta a ser possível sem apagar a falta para sempre.
--
-- ACHADO (Etapa 2 do plano): `aplicar_afastamento_no_ponto` escreve
-- 'Justificado' nos dias do período — criando a linha de ponto, ou pisando na
-- que existia. Nada desfaz. A tela de Afastamentos inativa o registro
-- (soft delete) e o ponto fica 'Justificado' para sempre: a falta desaparece,
-- `recalcular_folha_do_ponto` segue sem descontar, e o motivo — que morava no
-- afastamento — não é mais consultável. Pior no hard delete: a FK é
-- ON DELETE SET NULL, então o dia perde até o ponteiro de por que foi
-- justificado. (P4, com o agravante do soft-delete que não cascateia.)
--
-- Zero vítimas hoje no ERP: ninguém cancelou afastamento ainda. É o mecanismo
-- que está furado, não os dados.
--
-- Para desfazer com honestidade é preciso saber o que havia antes. O aplicar
-- passa a guardar isso na própria linha do ponto; a reversão restaura, e
-- apaga só o que ela mesma criou.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos com colaboradores.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Memória do que o afastamento sobrescreveu
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ponto_eletronico
  ADD COLUMN IF NOT EXISTS status_antes_afastamento text,
  ADD COLUMN IF NOT EXISTS horas_antes_afastamento  numeric(10,2),
  ADD COLUMN IF NOT EXISTS criado_por_afastamento   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ponto_eletronico.criado_por_afastamento IS
  'true = a linha só existe porque um afastamento a criou; reverter apaga. '
  'false = havia ponto no dia e o afastamento sobrescreveu; reverter restaura '
  'status_antes_afastamento/horas_antes_afastamento. Migração 273.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Aplicar passa a registrar o estado anterior
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aplicar_afastamento_no_ponto(p_afastamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_afastamento afastamentos;
  v_dia         date;
  v_aplicados   int := 0;
  v_pulados     int := 0;
  v_existente   record;
BEGIN
  PERFORM public._assert_rpc('rh');

  SELECT * INTO v_afastamento
    FROM afastamentos
   WHERE id = p_afastamento_id
     AND ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Afastamento % não encontrado ou inativo.', p_afastamento_id
      USING ERRCODE = 'P0002';
  END IF;

  v_dia := v_afastamento.data_inicio;
  WHILE v_dia <= v_afastamento.data_fim LOOP
    SELECT id, afastamento_id, status, horas_trabalhadas
      INTO v_existente
      FROM ponto_eletronico
     WHERE funcionario_id = v_afastamento.funcionario_id
       AND data           = v_dia
     LIMIT 1;

    IF v_existente.id IS NULL THEN
      INSERT INTO ponto_eletronico
        (funcionario_id, data, status, horas_trabalhadas, afastamento_id, criado_por_afastamento)
      VALUES (v_afastamento.funcionario_id, v_dia, 'Justificado', 0, p_afastamento_id, true);
      v_aplicados := v_aplicados + 1;

    ELSIF v_existente.afastamento_id IS NULL
       OR v_existente.afastamento_id = p_afastamento_id
    THEN
      UPDATE ponto_eletronico
         SET status                   = 'Justificado',
             horas_trabalhadas        = 0,
             afastamento_id           = p_afastamento_id,
             -- Só na primeira sobrescrita: reaplicar não pode gravar
             -- 'Justificado' como se fosse o estado original do dia.
             status_antes_afastamento = COALESCE(status_antes_afastamento, v_existente.status),
             horas_antes_afastamento  = COALESCE(horas_antes_afastamento, v_existente.horas_trabalhadas)
       WHERE id = v_existente.id;
      v_aplicados := v_aplicados + 1;

    ELSE
      v_pulados := v_pulados + 1;
    END IF;

    v_dia := v_dia + 1;
  END LOOP;

  UPDATE afastamentos
     SET aplicado_no_ponto = true,
         aplicado_em       = now()
   WHERE id = p_afastamento_id;

  RETURN jsonb_build_object('aplicados', v_aplicados, 'pulados', v_pulados);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Reverter: apaga o que criou, restaura o que sobrescreveu
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverter_afastamento_no_ponto(p_afastamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apagados    int := 0;
  v_restaurados int := 0;
BEGIN
  WITH apagadas AS (
    DELETE FROM public.ponto_eletronico
     WHERE afastamento_id = p_afastamento_id
       AND criado_por_afastamento = true
    RETURNING 1
  )
  SELECT count(*) INTO v_apagados FROM apagadas;

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

  UPDATE public.afastamentos
     SET aplicado_no_ponto = false,
         aplicado_em       = NULL
   WHERE id = p_afastamento_id;

  RETURN jsonb_build_object('apagados', v_apagados, 'restaurados', v_restaurados);
END;
$$;

REVOKE ALL ON FUNCTION public.reverter_afastamento_no_ponto(uuid) FROM public;
REVOKE ALL ON FUNCTION public.reverter_afastamento_no_ponto(uuid) FROM authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Inativar o afastamento reverte o ponto sozinho
-- ────────────────────────────────────────────────────────────────────────────
-- A tela usa soft delete, e FK não cascateia soft delete. Sem este trigger a
-- reversão dependeria de alguém lembrar de chamá-la.

CREATE OR REPLACE FUNCTION public.afastamento_reverte_ao_inativar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.ativo, true) = true AND COALESCE(NEW.ativo, true) = false THEN
    PERFORM public.reverter_afastamento_no_ponto(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_afastamento_reverte_ao_inativar ON public.afastamentos;
CREATE TRIGGER trg_afastamento_reverte_ao_inativar
  AFTER UPDATE OF ativo ON public.afastamentos
  FOR EACH ROW EXECUTE FUNCTION public.afastamento_reverte_ao_inativar();

-- Hard delete: a FK é ON DELETE SET NULL, que deixaria o dia 'Justificado'
-- sem dono. Reverter ANTES de a FK agir.
CREATE OR REPLACE FUNCTION public.afastamento_reverte_ao_excluir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reverter_afastamento_no_ponto(OLD.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_afastamento_reverte_ao_excluir ON public.afastamentos;
CREATE TRIGGER trg_afastamento_reverte_ao_excluir
  BEFORE DELETE ON public.afastamentos
  FOR EACH ROW EXECUTE FUNCTION public.afastamento_reverte_ao_excluir();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--   -- Órfãos: dia justificado sem afastamento vivo por trás. Deve ser zero.
--   SELECT count(*) FROM ponto_eletronico p
--    WHERE p.status = 'Justificado'
--      AND (p.afastamento_id IS NULL
--           OR EXISTS (SELECT 1 FROM afastamentos a
--                       WHERE a.id = p.afastamento_id AND COALESCE(a.ativo,true) = false));
--
--   -- Teste do ciclo (em turma de teste):
--   --   SELECT aplicar_afastamento_no_ponto('<id>');
--   --   UPDATE afastamentos SET ativo = false WHERE id = '<id>';
--   --   -- os dias criados somem; os sobrescritos voltam ao status original.
-- ════════════════════════════════════════════════════════════════════════════
