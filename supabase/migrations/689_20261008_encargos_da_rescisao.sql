-- 689 — Encargos da rescisão viram guia; a multa do FGTS sai do termo.
--
-- A 684 criou as guias da FOLHA (INSS/IRRF retidos, FGTS por competência). A
-- rescisão ficou de fora:
--   • INSS e IRRF retidos na rescisão (saldo e 13º) não iam a guia nenhuma;
--   • o FGTS do mês rescisório (8% sobre saldo de salário, aviso indenizado e
--     13º — férias indenizadas não incidem) não existia: a 681 encerra a folha
--     daquele mês e nada o substituía;
--   • a multa de 40% (20% no acordo) era paga NO TERMO, junto do líquido. No
--     mundo real ela é depositada na conta do FGTS pela guia rescisória e o
--     trabalhador saca na Caixa.
--
-- O que muda:
--  1. calcular_rescisao: a multa continua calculada e gravada (multa_fgts),
--     mas sai do total bruto/líquido do termo.
--  2. INSS/IRRF de rescisão Processada/Paga entram na apuração da competência
--     do desligamento (_apurar_encargos_folha, reescrita aqui — é da 684).
--  3. Guia "FGTS rescisório" por rescisão (encargo_tipo 'fgts_rescisorio',
--     contas_pagar.encargo_rescisao_id), vencendo em 10 dias do desligamento:
--     FGTS do mês + a multa quando ela NÃO está no termo.
--  4. Guia rescisória paga → a multa cai na carteira MaxBank do ex-funcionário
--     ("saque do FGTS"), origem 'rescisao_fgts', idempotente.
--
-- Rescisão antiga (multa dentro do termo) é reconhecida pela soma: o total
-- bruto inclui a multa. Nela a guia sai só com o FGTS do mês e o crédito da
-- multa não se repete.

-- ── colunas ────────────────────────────────────────────────────────────────
ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS encargo_rescisao_id uuid REFERENCES public.rescisoes(id) ON DELETE SET NULL;
ALTER TABLE public.contas_pagar DROP CONSTRAINT IF EXISTS chk_contas_pagar_encargo_tipo;
ALTER TABLE public.contas_pagar ADD CONSTRAINT chk_contas_pagar_encargo_tipo
  CHECK (encargo_tipo IS NULL OR encargo_tipo IN ('inss', 'irrf', 'fgts', 'fgts_rescisorio'));
CREATE INDEX IF NOT EXISTS ix_contas_pagar_encargo_rescisao
  ON public.contas_pagar (encargo_rescisao_id) WHERE encargo_rescisao_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_rescisao_fgts
  ON public.maxbank_transacoes (origem_id, carteira) WHERE origem = 'rescisao_fgts';

-- A multa está dentro do termo? (rescisões gravadas antes desta migração)
CREATE OR REPLACE FUNCTION public._rescisao_multa_no_termo(p_r public.rescisoes)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_r.multa_fgts, 0) > 0
     AND abs(COALESCE(p_r.total_bruto, 0) - (
           COALESCE(p_r.saldo_salario, 0) + COALESCE(p_r.aviso_previo_valor, 0)
         + COALESCE(p_r.decimo_terceiro, 0) + COALESCE(p_r.ferias_vencidas, 0)
         + COALESCE(p_r.ferias_proporcionais, 0) + COALESCE(p_r.terco_ferias, 0)
         + COALESCE(p_r.multa_fgts, 0))) < 0.02;
$$;
REVOKE ALL ON FUNCTION public._rescisao_multa_no_termo(public.rescisoes) FROM public, anon, authenticated;

-- ── 1 ──────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_old text := 'v_bruto := v_saldo + v_aviso + v_decimo + v_fer_venc + v_fer_prop + v_terco + v_multa;';
  v_new text := '-- MIGR 689: a multa do FGTS não é paga no termo — vai pela guia rescisória
  -- para a conta do FGTS (o trabalhador saca). Continua em multa_fgts.
  v_bruto := v_saldo + v_aviso + v_decimo + v_fer_venc + v_fer_prop + v_terco;';
BEGIN
  v_def := replace(pg_get_functiondef('public.calcular_rescisao(uuid, text, date, text)'::regprocedure), E'\r', '');
  IF position('MIGR 689' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'calcular_rescisao: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

-- ── 2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._apurar_encargos_folha(p_filial text, p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo     text;
  v_total    numeric(15,2);
  v_resc     numeric(15,2);
  v_fixo     numeric(15,2);
  v_aberta   uuid;
  v_alvo     numeric(15,2);
  v_rotulo   text;
  v_saida    jsonb := '{}';
BEGIN
  IF p_filial IS NULL OR p_competencia IS NULL OR p_competencia !~ '^\d{4}-\d{2}$' THEN
    RETURN v_saida;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('encargos_folha:' || p_filial || ':' || p_competencia));

  FOREACH v_tipo IN ARRAY ARRAY['inss', 'irrf', 'fgts'] LOOP
    SELECT COALESCE(sum(CASE v_tipo WHEN 'inss' THEN f.desconto_inss
                                    WHEN 'irrf' THEN f.desconto_irrf
                                    ELSE f.fgts_deposito END), 0)
      INTO v_total
      FROM public.folha_pagamento f
     WHERE COALESCE(f.ativo, true)
       AND f.filial = p_filial
       AND f.mes_ref = p_competencia
       AND f.status IN ('Processada', 'Paga');

    -- MIGR 689: retenções da rescisão vão na guia da competência do
    -- desligamento. O FGTS dela tem guia própria (fgts_rescisorio).
    -- desconto_inss/desconto_irrf da rescisão já somam a parte do 13º.
    IF v_tipo IN ('inss', 'irrf') THEN
      SELECT COALESCE(sum(CASE v_tipo WHEN 'inss' THEN r.desconto_inss ELSE r.desconto_irrf END), 0)
        INTO v_resc
        FROM public.rescisoes r
       WHERE COALESCE(r.ativo, true)
         AND r.filial = p_filial
         AND to_char(r.data_desligamento, 'YYYY-MM') = p_competencia
         AND r.status IN ('Processada', 'Paga');
      v_total := v_total + v_resc;
    END IF;

    SELECT COALESCE(sum(c.valor), 0) INTO v_fixo
      FROM public.contas_pagar c
     WHERE c.origem = 'encargos_folha' AND c.encargo_tipo = v_tipo
       AND c.filial = p_filial AND c.competencia = p_competencia
       AND COALESCE(c.ativo, true) AND c.status <> 'Cancelado'
       AND (c.status IN ('Pago', 'Parcial') OR COALESCE(c.valor_pago, 0) > 0);

    SELECT c.id INTO v_aberta
      FROM public.contas_pagar c
     WHERE c.origem = 'encargos_folha' AND c.encargo_tipo = v_tipo
       AND c.filial = p_filial AND c.competencia = p_competencia
       AND COALESCE(c.ativo, true) AND c.status NOT IN ('Pago', 'Parcial', 'Cancelado')
       AND COALESCE(c.valor_pago, 0) = 0
     ORDER BY c.created_at
     LIMIT 1
     FOR UPDATE;

    v_alvo := v_total - v_fixo;
    v_rotulo := CASE v_tipo WHEN 'inss' THEN 'INSS retido (GPS)'
                            WHEN 'irrf' THEN 'IRRF retido (DARF)'
                            ELSE 'FGTS (FGTS Digital)' END;

    IF v_alvo > 0.005 THEN
      IF v_aberta IS NOT NULL THEN
        UPDATE public.contas_pagar SET valor = v_alvo WHERE id = v_aberta;
      ELSE
        INSERT INTO public.contas_pagar
          (descricao, valor, vencimento, status, filial, origem, encargo_tipo,
           competencia, natureza, centro_custo_id)
        VALUES (
          v_rotulo || ' — folha ' || to_char(to_date(p_competencia, 'YYYY-MM'), 'MM/YYYY')
            || CASE WHEN v_fixo > 0 THEN ' (complementar)' ELSE '' END,
          v_alvo, public._vencimento_encargo_folha(p_competencia), 'Pendente',
          p_filial, 'encargos_folha', v_tipo, p_competencia, 'despesa',
          public._centro_custo_pessoal());
      END IF;
    ELSIF v_aberta IS NOT NULL THEN
      UPDATE public.contas_pagar SET status = 'Cancelado' WHERE id = v_aberta;
    END IF;

    v_saida := v_saida || jsonb_build_object(v_tipo, v_total);
  END LOOP;

  RETURN v_saida;
END;
$function$;
REVOKE ALL ON FUNCTION public._apurar_encargos_folha(text, text) FROM public, anon, authenticated;

-- ── 3 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._apurar_fgts_rescisorio(p_rescisao_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r       public.rescisoes;
  v_aliq    numeric;
  v_valor   numeric(15,2) := 0;
  v_vale    boolean;
  v_aberta  uuid;
  v_paga    boolean;
  v_nome    text;
BEGIN
  SELECT * INTO v_r FROM public.rescisoes WHERE id = p_rescisao_id;
  IF v_r.id IS NULL THEN RETURN 0; END IF;

  v_vale := COALESCE(v_r.ativo, true) AND v_r.status IN ('Processada', 'Paga')
            AND v_r.data_desligamento IS NOT NULL;

  IF v_vale THEN
    SELECT COALESCE(fgts_aliquota, 0.08) INTO v_aliq
      FROM public.rh_parametros WHERE vigencia_inicio = public.rh_vigencia_em(v_r.data_desligamento);
    v_valor := ROUND((COALESCE(v_r.saldo_salario, 0) + COALESCE(v_r.aviso_previo_valor, 0)
                      + COALESCE(v_r.decimo_terceiro, 0)) * COALESCE(v_aliq, 0.08), 2);
    IF NOT public._rescisao_multa_no_termo(v_r) THEN
      v_valor := v_valor + COALESCE(v_r.multa_fgts, 0);
    END IF;
  END IF;

  -- Guia já paga não se reescreve (o dinheiro saiu); só a em aberto.
  SELECT bool_or(c.status IN ('Pago', 'Parcial') OR COALESCE(c.valor_pago, 0) > 0)
    INTO v_paga
    FROM public.contas_pagar c
   WHERE c.encargo_rescisao_id = p_rescisao_id AND COALESCE(c.ativo, true) AND c.status <> 'Cancelado';
  IF COALESCE(v_paga, false) THEN
    RETURN v_valor;
  END IF;

  SELECT c.id INTO v_aberta
    FROM public.contas_pagar c
   WHERE c.encargo_rescisao_id = p_rescisao_id AND COALESCE(c.ativo, true)
     AND c.status NOT IN ('Pago', 'Parcial', 'Cancelado')
   ORDER BY c.created_at LIMIT 1 FOR UPDATE;

  IF v_valor > 0.005 THEN
    IF v_aberta IS NOT NULL THEN
      UPDATE public.contas_pagar SET valor = v_valor WHERE id = v_aberta;
    ELSE
      SELECT nome INTO v_nome FROM public.funcionarios WHERE id = v_r.funcionario_id;
      INSERT INTO public.contas_pagar
        (descricao, valor, vencimento, status, filial, origem, encargo_tipo,
         encargo_rescisao_id, competencia, natureza, centro_custo_id)
      VALUES (
        'FGTS rescisório (FGTS Digital) — ' || COALESCE(v_nome, 'Funcionário')
          || ' (' || to_char(v_r.data_desligamento, 'DD/MM/YYYY') || ')',
        v_valor, v_r.data_desligamento + 10, 'Pendente', v_r.filial,
        'encargos_folha', 'fgts_rescisorio', p_rescisao_id,
        to_char(v_r.data_desligamento, 'YYYY-MM'), 'despesa', public._centro_custo_pessoal());
    END IF;
  ELSIF v_aberta IS NOT NULL THEN
    UPDATE public.contas_pagar SET status = 'Cancelado' WHERE id = v_aberta;
  END IF;

  RETURN v_valor;
END;
$function$;
REVOKE ALL ON FUNCTION public._apurar_fgts_rescisorio(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_rescisao_reapura_encargos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND COALESCE(OLD.ativo, true) = COALESCE(NEW.ativo, true)
     AND OLD.data_desligamento IS NOT DISTINCT FROM NEW.data_desligamento
     AND OLD.filial IS NOT DISTINCT FROM NEW.filial THEN
    RETURN NEW;
  END IF;
  PERFORM public._apurar_fgts_rescisorio(NEW.id);
  IF NEW.data_desligamento IS NOT NULL THEN
    PERFORM public._apurar_encargos_folha(NEW.filial, to_char(NEW.data_desligamento, 'YYYY-MM'));
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_desligamento IS NOT NULL
     AND (OLD.filial IS DISTINCT FROM NEW.filial
          OR to_char(OLD.data_desligamento, 'YYYY-MM') IS DISTINCT FROM to_char(NEW.data_desligamento, 'YYYY-MM')) THEN
    PERFORM public._apurar_encargos_folha(OLD.filial, to_char(OLD.data_desligamento, 'YYYY-MM'));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rescisao_reapura_encargos ON public.rescisoes;
CREATE TRIGGER trg_rescisao_reapura_encargos
  AFTER INSERT OR UPDATE OF status, ativo, data_desligamento, filial ON public.rescisoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_rescisao_reapura_encargos();

-- A conta de pessoal ganha o centro "Pessoal" também pela guia rescisória
-- (a regra da 684 olha origem 'encargos_folha', que ela já tem).

-- ── 4 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guia_rescisoria_credita_multa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r          public.rescisoes;
  v_profile_id uuid;
  v_conta_id   uuid;
BEGIN
  IF NEW.encargo_tipo IS DISTINCT FROM 'fgts_rescisorio' OR NEW.encargo_rescisao_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_r FROM public.rescisoes WHERE id = NEW.encargo_rescisao_id;
  -- Multa já paga no termo (rescisão antiga) ou inexistente: nada a sacar.
  IF v_r.id IS NULL OR COALESCE(v_r.multa_fgts, 0) <= 0 OR public._rescisao_multa_no_termo(v_r) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT user_profile_id INTO v_profile_id FROM public.funcionarios WHERE id = v_r.funcionario_id;
    IF v_profile_id IS NULL THEN
      RAISE EXCEPTION 'Funcionário sem conta de colaborador — não há carteira para o saque do FGTS.';
    END IF;

    INSERT INTO public.maxbank_contas (colaborador_id)
    VALUES (v_profile_id) ON CONFLICT (colaborador_id) DO NOTHING;
    SELECT id INTO v_conta_id FROM public.maxbank_contas WHERE colaborador_id = v_profile_id;

    BEGIN
      INSERT INTO public.maxbank_transacoes
        (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
      VALUES
        (v_conta_id, 'credito', 'salario', v_r.multa_fgts,
         'Saque do FGTS — multa rescisória', 'rescisao_fgts', v_r.id, auth.uid());
      UPDATE public.maxbank_contas
         SET saldo_salario = saldo_salario + v_r.multa_fgts
       WHERE id = v_conta_id;
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- já creditada
    END;
  EXCEPTION WHEN OTHERS THEN
    -- O pagamento da guia não cai por causa da carteira; o RH fica sabendo.
    RAISE WARNING 'Crédito da multa do FGTS (rescisão %) falhou: %', v_r.id, SQLERRM;
    BEGIN
      PERFORM public.notificar_setor(
        'rh', 'alerta', 'Multa do FGTS sem crédito no MaxBank',
        'A guia rescisória foi paga, mas o saque da multa não caiu na carteira: ' || SQLERRM,
        'rh-desligamento', 'Alta', v_r.id, SQLERRM, NEW.filial);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notificar_setor falhou: %', SQLERRM;
    END;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guia_rescisoria_credita_multa ON public.contas_pagar;
CREATE TRIGGER trg_guia_rescisoria_credita_multa
  AFTER UPDATE OF status ON public.contas_pagar
  FOR EACH ROW WHEN (NEW.status = 'Pago' AND OLD.status IS DISTINCT FROM 'Pago')
  EXECUTE FUNCTION public.fn_guia_rescisoria_credita_multa();
