-- 681 — A rescisão encerra a folha do mês do desligamento.
--
-- A rescisão paga o saldo de salário do mês do desligamento (calcular_rescisao:
-- dias trabalhados × salário/30). A folha desse mesmo mês continuava Pendente
-- com o salário CHEIO, e processar_folha não olhava se a pessoa ainda estava
-- na empresa: o mês saía pago duas vezes. Achado na auditoria de 08/10 — na
-- Contabilidade, 8 folhas nessa situação (3 já Processadas, com conta a pagar
-- pronta para sair do caixa).
--
-- Régua: rescisão ativa com desligamento em M cobre as folhas de competência
-- >= M. A folha de M-1 continua devida (a rescisão não paga mês anterior).
--
--  1. `_rescisao_cobre_folha(funcionario, mes_ref)` — devolve a data do
--     desligamento quando a competência está coberta.
--  2. Trava em folha_pagamento: não nasce e não avança (Pendente/Processada)
--     folha coberta. Folha Paga passa — o dinheiro já saiu, e travar a linha
--     impediria até o estorno do MaxBank.
--  3. `_encerrar_folhas_da_rescisao(rescisao)`: inativa as folhas cobertas
--     ainda não pagas e cancela a conta a pagar delas; folha já Paga só avisa
--     o RH (desconto na rescisão é decisão de gente, não do banco).
--  4. Gatilho em rescisoes chama o item 3 quando a rescisão nasce ativa.
--
-- O acerto das folhas que já existem fica numa migração à parte (685), depois
-- da lista aprovada.

-- ── 1 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rescisao_cobre_folha(p_funcionario_id uuid, p_mes_ref text)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT min(r.data_desligamento)
    FROM public.rescisoes r
   WHERE r.funcionario_id = p_funcionario_id
     AND COALESCE(r.ativo, true)
     AND r.data_desligamento IS NOT NULL
     AND p_mes_ref ~ '^\d{4}-\d{2}$'
     AND p_mes_ref >= to_char(r.data_desligamento, 'YYYY-MM');
$$;

REVOKE ALL ON FUNCTION public._rescisao_cobre_folha(uuid, text) FROM public, anon, authenticated;

-- ── 2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_folha_coberta_pela_rescisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_desl date;
BEGIN
  IF COALESCE(NEW.ativo, true) IS NOT TRUE
     OR COALESCE(NEW.status, 'Pendente') NOT IN ('Pendente', 'Processada') THEN
    RETURN NEW;
  END IF;
  -- UPDATE que não mexe em nada que importe (ex.: carimbo de auditoria numa
  -- folha antiga) não é barrado; só nascer, reativar, trocar de competência
  -- ou avançar de status.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.ativo, true) = COALESCE(NEW.ativo, true)
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.mes_ref IS NOT DISTINCT FROM NEW.mes_ref
     AND OLD.funcionario_id IS NOT DISTINCT FROM NEW.funcionario_id
     AND OLD.salario_liquido IS NOT DISTINCT FROM NEW.salario_liquido THEN
    RETURN NEW;
  END IF;

  v_desl := public._rescisao_cobre_folha(NEW.funcionario_id, NEW.mes_ref);
  IF v_desl IS NOT NULL THEN
    RAISE EXCEPTION 'Esta pessoa foi desligada em % e a rescisão já paga o saldo de salário desse mês. A folha de % em diante não existe mais para ela — o que é devido sai pela rescisão (RH › Desligamentos).',
      to_char(v_desl, 'DD/MM/YYYY'), to_char(v_desl, 'MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_folha_coberta_pela_rescisao ON public.folha_pagamento;
CREATE TRIGGER trg_folha_coberta_pela_rescisao
  BEFORE INSERT OR UPDATE ON public.folha_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_folha_coberta_pela_rescisao();

-- ── 3 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._encerrar_folhas_da_rescisao(p_rescisao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r        public.rescisoes;
  v_corte    date := public.ponto_corte_turma();
  v_f        record;
  v_nome     text;
  v_folhas   integer := 0;
  v_contas   integer := 0;
  v_n        integer;
  v_pagas    text[] := '{}';
BEGIN
  SELECT * INTO v_r FROM public.rescisoes WHERE id = p_rescisao_id;
  IF v_r.id IS NULL OR COALESCE(v_r.ativo, true) IS NOT TRUE OR v_r.data_desligamento IS NULL THEN
    RETURN jsonb_build_object('folhas', 0, 'contas', 0);
  END IF;

  SELECT nome INTO v_nome FROM public.funcionarios WHERE id = v_r.funcionario_id;

  FOR v_f IN
    SELECT f.id, f.mes_ref, f.status
      FROM public.folha_pagamento f
     WHERE f.funcionario_id = v_r.funcionario_id
       AND COALESCE(f.ativo, true)
       AND f.mes_ref ~ '^\d{4}-\d{2}$'
       AND f.mes_ref >= to_char(v_r.data_desligamento, 'YYYY-MM')
       -- Folha da turma anterior é histórico fechado (folha_historico_fechado
       -- recusaria o UPDATE e derrubaria a gravação da rescisão).
       AND (v_corte IS NULL OR f.created_at IS NULL
            OR (f.created_at AT TIME ZONE 'America/Rio_Branco')::date >= v_corte)
     ORDER BY f.mes_ref
     FOR UPDATE
  LOOP
    IF v_f.status = 'Paga' THEN
      v_pagas := v_pagas || v_f.mes_ref;
      CONTINUE;
    END IF;

    UPDATE public.contas_pagar
       SET status = 'Cancelado'
     WHERE folha_pagamento_id = v_f.id
       AND COALESCE(ativo, true)
       AND status NOT IN ('Pago', 'Parcial', 'Cancelado')
       AND COALESCE(valor_pago, 0) = 0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_contas := v_contas + v_n;

    UPDATE public.folha_pagamento SET ativo = false WHERE id = v_f.id;
    v_folhas := v_folhas + 1;
  END LOOP;

  IF array_length(v_pagas, 1) > 0 THEN
    BEGIN
      PERFORM public.notificar_setor(
        'rh', 'alerta',
        'Folha já paga coberta pela rescisão',
        format('%s foi desligado(a) em %s e a folha de %s já foi paga. A rescisão também paga o saldo de salário desse mês — confira se é preciso descontar.',
               COALESCE(v_nome, 'Funcionário'), to_char(v_r.data_desligamento, 'DD/MM/YYYY'),
               array_to_string(v_pagas, ', ')),
        'folha-pagamento', 'Alta', p_rescisao_id, NULL, v_r.filial);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notificar_setor falhou para rescisão %: %', p_rescisao_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('folhas', v_folhas, 'contas', v_contas, 'ja_pagas', to_jsonb(v_pagas));
END;
$function$;

REVOKE ALL ON FUNCTION public._encerrar_folhas_da_rescisao(uuid) FROM public, anon, authenticated;

-- ── 4 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_rescisao_encerra_folhas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.ativo, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.ativo, true) = COALESCE(NEW.ativo, true)
     AND OLD.data_desligamento IS NOT DISTINCT FROM NEW.data_desligamento THEN
    RETURN NEW;
  END IF;
  PERFORM public._encerrar_folhas_da_rescisao(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rescisao_encerra_folhas ON public.rescisoes;
CREATE TRIGGER trg_rescisao_encerra_folhas
  AFTER INSERT OR UPDATE OF ativo, data_desligamento ON public.rescisoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_rescisao_encerra_folhas();
