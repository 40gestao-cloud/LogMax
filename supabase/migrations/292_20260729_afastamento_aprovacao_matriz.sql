-- 292 — Falta só é perdoada se a Matriz aprovar.
--
-- REGRA NOVA. Até aqui, `recalcular_folha_do_ponto` tratava todo dia
-- 'Justificado' como zero desconto, e qualquer pessoa do RH ou gerente da
-- filial produzia dias justificados sozinha — o afastamento entrava e o ponto
-- era reescrito na mesma transação, sem ninguém conferindo. Na prática, quem
-- lançava o afastamento decidia o desconto da folha.
--
-- É o mesmo desenho que a migr. 282 desfez em Compras, Cotação e Férias:
-- lançador e decisor eram a mesma pessoa. Faltou Afastamentos.
--
-- Agora: o afastamento nasce PENDENTE e só perdoa falta depois de aprovado por
-- admin ou CEO. Pendente e Negado seguem existindo como registro do motivo —
-- o dia continua marcado 'Justificado' no ponto, porque houve uma ausência com
-- justificativa declarada —, mas descontam como falta até a aprovação sair.
--
-- Por que a régua fica no CÁLCULO e não no status do ponto: o dia é o que é
-- (ausência justificada); o que a aprovação decide é se ela custa dinheiro.
-- Misturar as duas coisas obrigaria a reescrever o ponto a cada decisão, e a
-- reversão da 273 depende justamente de o ponto guardar o estado anterior.
--
-- BACKFILL: tudo que existe entra como 'Pendente'. Nada foi aprovado porque a
-- aprovação não existia — dar 'Aprovado' de brinde manteria exatamente o
-- perdão silencioso que esta migração veio acabar. Efeito colateral desejado:
-- os 755 dias do afastamento até 2028 na turma aprendiz param de perdoar falta
-- sem que ninguém precise apagar o registro.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Estado de aprovação
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.afastamentos
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'Pendente',
  ADD COLUMN IF NOT EXISTS aprovado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprovador_nome text,
  ADD COLUMN IF NOT EXISTS aprovado_em    timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_decisao text;

DO $$
BEGIN
  ALTER TABLE public.afastamentos
    ADD CONSTRAINT chk_afastamento_status
    CHECK (status IN ('Pendente', 'Aprovado', 'Negado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_afastamentos_status
  ON public.afastamentos (status) WHERE COALESCE(ativo, true);

COMMENT ON COLUMN public.afastamentos.status IS
  'Pendente (default) e Negado: o dia fica Justificado no ponto mas DESCONTA '
  'como falta. Aprovado: zera o desconto. Só admin/CEO decidem. Migração 292.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Só a Matriz decide, e nunca sobre o próprio lançamento
--
-- `auth_is_admin()` não serve aqui: ele inclui conselheiro. A régua pedida é
-- admin ou CEO.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.afastamento_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid();

  IF v_role NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO decidem afastamento. Perdão de falta é decisão da Matriz.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem lança o afastamento não o aprova.'
      USING ERRCODE = '42501';
  END IF;

  NEW.aprovado_por   := auth.uid();
  NEW.aprovador_nome := COALESCE(
    (SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');
  NEW.aprovado_em    := now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_afastamento_decisao_guard ON public.afastamentos;
CREATE TRIGGER trg_afastamento_decisao_guard
  BEFORE UPDATE ON public.afastamentos
  FOR EACH ROW EXECUTE FUNCTION public.afastamento_decisao_guard();

-- Ninguém nasce aprovado: INSERT com status já 'Aprovado' contornaria o guard,
-- que só olha UPDATE.
CREATE OR REPLACE FUNCTION public.afastamento_nasce_pendente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.auth_is_service_role() THEN
    NEW.status         := 'Pendente';
    NEW.aprovado_por   := NULL;
    NEW.aprovador_nome := NULL;
    NEW.aprovado_em    := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_afastamento_nasce_pendente ON public.afastamentos;
CREATE TRIGGER trg_afastamento_nasce_pendente
  BEFORE INSERT ON public.afastamentos
  FOR EACH ROW EXECUTE FUNCTION public.afastamento_nasce_pendente();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. O cálculo passa a olhar a aprovação
--
-- Mantém tudo que a 290 fez (jornada real da turma). A única mudança é que
-- 'Justificado' deixou de ser passe livre: só escapa do desconto o dia cujo
-- afastamento está Aprovado e ativo.
--
-- Dia 'Justificado' SEM afastamento_id desconta. Não há o que aprovar — e é
-- por essa fresta que um justificado solto viraria perdão sem dono.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recalcular_folha_do_ponto(
  p_folha_id        uuid,
  p_target_entrada  text    DEFAULT '07:40',
  p_target_retorno  text    DEFAULT '09:20',
  p_target_saida    text    DEFAULT '11:20',
  p_tolerancia_min  integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_funcionario_id   uuid;
  v_salario_base     numeric(12,2);
  v_mes_ref          text;
  v_status           text;
  v_valor_hora       numeric;
  v_target           time;
  v_jornada          numeric;
  v_horas_mes        numeric;
  v_horas_atraso     numeric := 0;
  v_horas_falta      numeric := 0;
  v_horas_extras     numeric := 0;
  v_horas_perdoadas  numeric := 0;
  v_descontos        numeric;
  v_bonus_extra      numeric;
  v_salario_bruto    numeric;
  v_salario_liquido  numeric;
  v_atraso_min       numeric;
  r                  record;
BEGIN
  PERFORM public._assert_rpc('rh', 'financeiro');

  SELECT funcionario_id, COALESCE(salario_base, salario_bruto), mes_ref, status
    INTO v_funcionario_id, v_salario_base, v_mes_ref, v_status
    FROM folha_pagamento
   WHERE id = p_folha_id
     AND COALESCE(ativo, true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada ou inativa: %', p_folha_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Só é possível recalcular folha em status Pendente (atual: %).', v_status;
  END IF;

  IF v_salario_base IS NULL OR v_salario_base <= 0 THEN
    RAISE EXCEPTION 'Salário base inválido (%) — preencha antes de recalcular.', v_salario_base;
  END IF;

  v_target  := (p_target_entrada || ':00')::time;
  v_jornada := EXTRACT(EPOCH FROM (
                 (p_target_saida || ':00')::time - (p_target_entrada || ':00')::time
               )) / 3600.0;

  IF v_jornada IS NULL OR v_jornada <= 0 THEN
    RAISE EXCEPTION 'Jornada inválida: entrada % e saída % não formam um expediente.', p_target_entrada, p_target_saida
      USING ERRCODE = 'P0001';
  END IF;

  v_horas_mes  := v_jornada * 27.5;
  v_valor_hora := v_salario_base / v_horas_mes;

  FOR r IN
    SELECT p.data, p.entrada, p.horas_trabalhadas, p.status,
           -- Perdoado só quando há afastamento vivo E aprovado por trás.
           COALESCE(a.status = 'Aprovado' AND COALESCE(a.ativo, true), false) AS perdoado
      FROM ponto_eletronico p
      LEFT JOIN afastamentos a ON a.id = p.afastamento_id
     WHERE p.funcionario_id = v_funcionario_id
       AND to_char(p.data, 'YYYY-MM') = v_mes_ref
  LOOP
    IF r.status = 'Falta' THEN
      v_horas_falta := v_horas_falta + v_jornada;

    ELSIF r.status = 'Justificado' THEN
      IF r.perdoado THEN
        v_horas_perdoadas := v_horas_perdoadas + v_jornada;
      ELSE
        -- Justificativa sem aprovação da Matriz desconta como falta.
        v_horas_falta := v_horas_falta + v_jornada;
      END IF;

    ELSIF r.status = 'Hora Extra' THEN
      v_horas_extras := v_horas_extras + GREATEST(COALESCE(r.horas_trabalhadas, 0) - v_jornada, 0);
    END IF;

    -- Atraso só faz sentido em dia trabalhado. Falta e Justificado já foram
    -- cobrados acima (o Justificado não aprovado entrou como falta cheia);
    -- somar atraso por cima seria cobrar o mesmo dia duas vezes.
    IF r.entrada IS NOT NULL
       AND r.status NOT IN ('Falta', 'Justificado')
    THEN
      v_atraso_min := EXTRACT(EPOCH FROM (r.entrada::time - v_target)) / 60.0;
      IF v_atraso_min > p_tolerancia_min THEN
        v_horas_atraso := v_horas_atraso + (v_atraso_min / 60.0);
      END IF;
    END IF;
  END LOOP;

  v_descontos       := ROUND((v_horas_atraso + v_horas_falta) * v_valor_hora, 2);
  v_bonus_extra     := ROUND(v_horas_extras * v_valor_hora * 1.5, 2);
  v_salario_bruto   := ROUND(v_salario_base + v_bonus_extra, 2);
  v_salario_liquido := ROUND(v_salario_bruto - v_descontos, 2);

  IF v_descontos > v_salario_bruto THEN
    v_descontos       := v_salario_bruto;
    v_salario_liquido := 0;
  END IF;

  UPDATE folha_pagamento
     SET salario_bruto   = v_salario_bruto,
         descontos       = v_descontos,
         salario_liquido = v_salario_liquido,
         horas_atraso    = ROUND(v_horas_atraso, 2),
         horas_falta     = v_horas_falta,
         horas_extras    = v_horas_extras
   WHERE id = p_folha_id;

  RETURN jsonb_build_object(
    'valor_hora',       ROUND(v_valor_hora, 2),
    'jornada_diaria',   ROUND(v_jornada, 2),
    'horas_mes',        ROUND(v_horas_mes, 2),
    'horas_atraso',     ROUND(v_horas_atraso, 2),
    'horas_falta',      v_horas_falta,
    'horas_perdoadas',  v_horas_perdoadas,
    'horas_extras',     v_horas_extras,
    'descontos',        v_descontos,
    'bonus_extra',      v_bonus_extra,
    'salario_base',     v_salario_base,
    'salario_bruto',    v_salario_bruto,
    'salario_liquido',  v_salario_liquido
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Backfill explícito
--
-- O DEFAULT já cobre linha nova; este UPDATE é para as que existiam antes da
-- coluna e vieram com NULL em bancos onde o ALTER não preencheu.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.afastamentos SET status = 'Pendente' WHERE status IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Fila de aprovação da Matriz (tudo entra Pendente):
--   SELECT status, count(*) FROM afastamentos
--    WHERE COALESCE(ativo, true) GROUP BY 1;
--
--   -- Dias que DEIXARAM de ser perdoados (passam a descontar até aprovarem):
--   SELECT count(*) FROM ponto_eletronico p
--     JOIN afastamentos a ON a.id = p.afastamento_id
--    WHERE p.status = 'Justificado' AND a.status <> 'Aprovado';
--
--   -- Recalcule uma folha Pendente: horas_perdoadas mostra o que a aprovação
--   -- da Matriz salvou, separado de horas_falta.
-- ────────────────────────────────────────────────────────────────────────────
