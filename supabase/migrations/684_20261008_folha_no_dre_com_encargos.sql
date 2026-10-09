-- 684 — A folha entra no DRE como Pessoal e com os encargos.
--
-- Dois defeitos achados na auditoria de 08/10:
--
--  a) processar_folha e processar_rescisao criam a conta a pagar sem centro de
--     de custo. _dre_calculo agrupa despesa por centros_custo.grupo_dre, então
--     o maior gasto da unidade caía em "Não classificado" (36 de 36 contas de
--     folha/rescisão na Contabilidade).
--  b) A conta da folha é o LÍQUIDO. O INSS e o IRRF descontados do funcionário
--     são dinheiro que a empresa retém e repassa ao governo (GPS/DARF), e o
--     FGTS (8%, fora do líquido) é depósito da empresa — nenhum dos três virava
--     conta a pagar. O DRE via só o líquido e a obrigação sumia. A ficha da
--     filial (FiliaisView) já somava o FGTS no custo da unidade: as duas telas
--     discordavam.
--
-- O que muda:
--  1. Toda conta de folha, rescisão e encargo nasce no centro "Pessoal"
--     (grupo_dre = 'Pessoal'), se ninguém escolheu outro. As que já existem
--     são reclassificadas (só o centro de custo; valor, status e datas ficam).
--  2. `contas_pagar.encargo_tipo` ('inss' | 'irrf' | 'fgts') e a apuração
--     `_apurar_encargos_folha(filial, competência)`: UMA guia por tipo, por
--     unidade e competência — como no mundo real (GPS, DARF, FGTS Digital) —,
--     vencendo dia 20 do mês seguinte (fim de semana antecipa para sexta).
--     Origem 'encargos_folha'. Guia ainda não paga é recalculada; guia já paga
--     não se reescreve — a diferença vira guia complementar.
--  3. Gatilho em folha_pagamento reapura a competência quando uma folha entra
--     em Processada/Paga, sai dela, ou é inativada (ex.: rescisão, migr. 681).
--  4. A guia é obrigação constituída: passa pelo bloqueio de capital estourado
--     como DAS e empréstimo (bloqueia_conta_pagar_estourado).
--
-- Sem retroativo: competência já fechada só ganha guia se alguma folha dela
-- for processada de novo. Gerar guias de meses passados de uma vez seria criar
-- dívida nova no caixa das turmas sem ninguém pedir.
-- Fora de escopo: INSS/IRRF retidos na rescisão e a multa de 40% do FGTS.

-- ── 2 (coluna antes do gatilho do 1, que a lê) ─────────────────────────────
ALTER TABLE public.contas_pagar ADD COLUMN IF NOT EXISTS encargo_tipo text;
ALTER TABLE public.contas_pagar DROP CONSTRAINT IF EXISTS chk_contas_pagar_encargo_tipo;
ALTER TABLE public.contas_pagar ADD CONSTRAINT chk_contas_pagar_encargo_tipo
  CHECK (encargo_tipo IS NULL OR encargo_tipo IN ('inss', 'irrf', 'fgts'));
COMMENT ON COLUMN public.contas_pagar.encargo_tipo IS
  'Migr. 684: guia de encargo da folha (inss/irrf retidos, fgts). Só com origem encargos_folha.';

CREATE INDEX IF NOT EXISTS ix_contas_pagar_encargo
  ON public.contas_pagar (filial, competencia, encargo_tipo)
  WHERE origem = 'encargos_folha';

-- ── 1 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._centro_custo_pessoal()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.centros_custo
   WHERE btrim(COALESCE(grupo_dre, '')) = 'Pessoal'
     AND COALESCE(ativo, true)
     AND COALESCE(status, 'Ativo') <> 'Inativo'
   ORDER BY nome
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._centro_custo_pessoal() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_conta_de_pessoal_centro_custo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_custo_id IS NULL
     AND (NEW.folha_pagamento_id IS NOT NULL
          OR NEW.rescisao_id IS NOT NULL
          OR COALESCE(NEW.origem, '') = 'encargos_folha') THEN
    NEW.centro_custo_id := public._centro_custo_pessoal();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_conta_de_pessoal_centro_custo ON public.contas_pagar;
CREATE TRIGGER trg_conta_de_pessoal_centro_custo
  BEFORE INSERT ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_de_pessoal_centro_custo();

UPDATE public.contas_pagar
   SET centro_custo_id = public._centro_custo_pessoal()
 WHERE centro_custo_id IS NULL
   AND (folha_pagamento_id IS NOT NULL OR rescisao_id IS NOT NULL)
   AND public._centro_custo_pessoal() IS NOT NULL;

-- ── 2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._vencimento_encargo_folha(p_competencia text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  -- Dia 20 do mês seguinte; sábado/domingo antecipa (GPS e FGTS Digital
  -- antecipam; o DARF também é pago antes do fim de semana na prática).
  SELECT d - CASE extract(isodow FROM d)::int WHEN 6 THEN 1 WHEN 7 THEN 2 ELSE 0 END
    FROM (SELECT (to_date(p_competencia || '-20', 'YYYY-MM-DD') + interval '1 month')::date AS d) x;
$$;
REVOKE ALL ON FUNCTION public._vencimento_encargo_folha(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._apurar_encargos_folha(p_filial text, p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo     text;
  v_total    numeric(15,2);
  v_fixo     numeric(15,2);
  v_aberta   uuid;
  v_alvo     numeric(15,2);
  v_rotulo   text;
  v_saida    jsonb := '{}';
BEGIN
  IF p_filial IS NULL OR p_competencia IS NULL OR p_competencia !~ '^\d{4}-\d{2}$' THEN
    RETURN v_saida;
  END IF;

  -- Uma apuração por unidade+competência de cada vez (duas folhas processadas
  -- no mesmo instante criariam duas guias).
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

    -- O que já saiu do caixa não se reescreve.
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
      -- A competência encolheu (folha inativada) até caber no que já foi pago:
      -- a guia em aberto deixa de existir.
      UPDATE public.contas_pagar SET status = 'Cancelado' WHERE id = v_aberta;
    END IF;

    v_saida := v_saida || jsonb_build_object(v_tipo, v_total);
  END LOOP;

  RETURN v_saida;
END;
$function$;
REVOKE ALL ON FUNCTION public._apurar_encargos_folha(text, text) FROM public, anon, authenticated;

-- ── 3 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_folha_reapura_encargos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conta_antes boolean := false;
  v_conta_agora boolean;
BEGIN
  v_conta_agora := COALESCE(NEW.ativo, true) AND NEW.status IN ('Processada', 'Paga');
  IF TG_OP = 'UPDATE' THEN
    v_conta_antes := COALESCE(OLD.ativo, true) AND OLD.status IN ('Processada', 'Paga');
  END IF;
  IF NOT v_conta_antes AND NOT v_conta_agora THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND v_conta_antes AND v_conta_agora
     AND OLD.filial IS NOT DISTINCT FROM NEW.filial
     AND OLD.mes_ref IS NOT DISTINCT FROM NEW.mes_ref
     AND OLD.desconto_inss IS NOT DISTINCT FROM NEW.desconto_inss
     AND OLD.desconto_irrf IS NOT DISTINCT FROM NEW.desconto_irrf
     AND OLD.fgts_deposito IS NOT DISTINCT FROM NEW.fgts_deposito THEN
    RETURN NEW;  -- Processada → Paga não muda o que se deve ao governo.
  END IF;

  PERFORM public._apurar_encargos_folha(NEW.filial, NEW.mes_ref);
  IF TG_OP = 'UPDATE' AND (OLD.filial IS DISTINCT FROM NEW.filial OR OLD.mes_ref IS DISTINCT FROM NEW.mes_ref) THEN
    PERFORM public._apurar_encargos_folha(OLD.filial, OLD.mes_ref);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_folha_reapura_encargos ON public.folha_pagamento;
CREATE TRIGGER trg_folha_reapura_encargos
  AFTER INSERT OR UPDATE OF status, ativo, filial, mes_ref, desconto_inss, desconto_irrf, fgts_deposito
  ON public.folha_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_folha_reapura_encargos();

-- ── 4 ──────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_old text := $o$IF NEW.origem IN ('emprestimo', 'rateio', 'das') THEN RETURN NEW; END IF;$o$;
  v_new text := $n$IF NEW.origem IN ('emprestimo', 'rateio', 'das', 'encargos_folha') THEN RETURN NEW; END IF;  -- MIGR 684: guia da folha$n$;
BEGIN
  v_def := replace(pg_get_functiondef('public.bloqueia_conta_pagar_estourado()'::regprocedure), E'\r', '');
  IF position('MIGR 684' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'bloqueia_conta_pagar_estourado: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;
