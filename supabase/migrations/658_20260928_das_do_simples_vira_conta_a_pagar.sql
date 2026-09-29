-- 658_20260928_das_do_simples_vira_conta_a_pagar.sql
--
-- A 656 pôs o Simples Nacional no DRE como dedução da receita, mas o imposto
-- nunca virava obrigação: nenhuma conta a pagar, nenhum dinheiro saindo do
-- caixa. O resultado mostrava o imposto e o banco nunca o pagava.
--
-- REGRA (a do Simples):
--   • o imposto se apura por MÊS (competência) sobre a receita do mês, na
--     alíquota efetiva da faixa daquele mês (a mesma conta do DRE);
--   • paga-se num documento só, o DAS, até o dia 20 do mês seguinte. Dia 20
--     em sábado ou domingo vai para a segunda-feira (feriado não é olhado);
--   • só se apura mês FECHADO — o mês corrente ainda tem venda por vir.
--
-- `apurar_das` é o botão do Financeiro: calcula, grava a apuração e cria a
-- conta a pagar (origem 'das'). Apurar de novo um mês ainda não pago refaz o
-- valor (devolução lançada depois, por exemplo); mês pago não se reapura.
--
-- O DRE continua lendo o imposto pela conta dele (dedução da receita). A
-- conta do DAS é o PAGAMENTO desse imposto — se entrasse também como despesa,
-- o imposto contaria duas vezes. Por isso `_dre_calculo` passa a deixar
-- origem 'das' de fora, como já fazia com 'devolucao_pdv' e 'emprestimo'.
--
-- O DAS também passa pelo bloqueio de capital estourado, como empréstimo e
-- rateio: é obrigação constituída, não despesa que a filial escolhe fazer.
--
-- A conta do DAS não muda de valor por fora (só reapurando), e excluí-la
-- desfaz a apuração daquele mês.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

CREATE TABLE IF NOT EXISTS public.das_apuracoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial          text NOT NULL,
  competencia     date NOT NULL CHECK (competencia = date_trunc('month', competencia)::date),
  receita         numeric(15,2) NOT NULL,
  rbt12           numeric(15,2) NOT NULL,
  rbt12_origem    text NOT NULL,
  faixa           integer NOT NULL,
  aliquota_efetiva numeric(8,4) NOT NULL,
  valor           numeric(15,2) NOT NULL,
  vencimento      date NOT NULL,
  -- CASCADE: o reset por filial apaga a conta com DELETE. No app a conta só é
  -- inativada, e aí quem desfaz a apuração é o gatilho da conta.
  conta_pagar_id  uuid REFERENCES public.contas_pagar(id) ON DELETE CASCADE,
  apurado_em      timestamptz NOT NULL DEFAULT now(),
  apurado_por     uuid DEFAULT auth.uid(),
  UNIQUE (filial, competencia)
);

COMMENT ON TABLE public.das_apuracoes IS
  'Apuração mensal do Simples Nacional (migr. 658). Uma por filial e competência; vira conta a pagar (origem das). Escrita só por apurar_das.';

ALTER TABLE public.das_apuracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.das_apuracoes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.das_apuracoes FROM authenticated;
GRANT SELECT ON TABLE public.das_apuracoes TO authenticated;

DROP POLICY IF EXISTS das_apuracoes_select ON public.das_apuracoes;
CREATE POLICY das_apuracoes_select ON public.das_apuracoes
  FOR SELECT TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

-- ── O imposto de um mês ──────────────────────────────────────────────────────
-- A mesma conta que _dre_calculo faz mês a mês (receita × efetiva da faixa).
CREATE OR REPLACE FUNCTION public._simples_do_mes(p_filial text, p_mes date)
RETURNS TABLE (receita numeric, rbt12 numeric, rbt12_origem text, faixa integer, aliquota_efetiva numeric, imposto numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT b.base, r.rbt12, r.origem, a.faixa, a.aliquota_efetiva,
         ROUND(GREATEST(b.base, 0) * a.aliquota_efetiva / 100, 2)
    FROM (SELECT date_trunc('month', p_mes)::date AS m) g
    CROSS JOIN LATERAL (SELECT public._receita_simples(p_filial, g.m,
                          (g.m + interval '1 month' - interval '1 day')::date) AS base) b
    CROSS JOIN LATERAL public._simples_rbt12(p_filial, g.m) r
    CROSS JOIN LATERAL public.simples_anexo_i(r.rbt12) a;
$function$;

REVOKE ALL ON FUNCTION public._simples_do_mes(text, date) FROM public, anon, authenticated;

-- Dia 20 do mês seguinte; sábado/domingo vão para a segunda.
CREATE OR REPLACE FUNCTION public.vencimento_das(p_competencia date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE EXTRACT(ISODOW FROM d)
           WHEN 6 THEN d + 2
           WHEN 7 THEN d + 1
           ELSE d END
    FROM (SELECT (date_trunc('month', p_competencia) + interval '1 month' + interval '19 days')::date AS d) x;
$function$;

REVOKE ALL ON FUNCTION public.vencimento_das(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vencimento_das(date) TO authenticated;

-- ── Apurar ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apurar_das(p_filial text, p_competencia date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp   date := date_trunc('month', p_competencia)::date;
  v_calc   record;
  v_venc   date;
  v_ap     public.das_apuracoes;
  v_conta  public.contas_pagar;
  v_desc   text;
BEGIN
  PERFORM public._assert_rpc('financeiro');
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Apuração de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF p_filial IS NULL OR p_filial = 'Matriz' THEN
    RAISE EXCEPTION 'A Matriz não vende: não há Simples a apurar.' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp IS NULL OR v_comp >= date_trunc('month', public.acre_today())::date THEN
    RAISE EXCEPTION 'Só se apura mês fechado — o mês corrente ainda tem venda por vir.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma apuração por vez para a mesma competência.
  PERFORM pg_advisory_xact_lock(hashtext('das:' || p_filial || ':' || v_comp::text));

  SELECT * INTO v_calc FROM public._simples_do_mes(p_filial, v_comp);
  v_venc := public.vencimento_das(v_comp);
  v_desc := format('DAS Simples Nacional — competência %s', to_char(v_comp, 'MM/YYYY'));

  SELECT * INTO v_ap FROM public.das_apuracoes WHERE filial = p_filial AND competencia = v_comp FOR UPDATE;

  IF v_ap.id IS NOT NULL THEN
    SELECT * INTO v_conta FROM public.contas_pagar WHERE id = v_ap.conta_pagar_id FOR UPDATE;
    IF v_conta.status IN ('Pago', 'Parcial') OR COALESCE(v_conta.valor_pago, 0) > 0 THEN
      RAISE EXCEPTION 'O DAS de % já foi pago (total ou parte) e não se reapura. Diferença depois do pagamento é DAS complementar — fora do exercício.',
        to_char(v_comp, 'MM/YYYY') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF COALESCE(v_calc.imposto, 0) <= 0 THEN
    -- Mês sem receita não gera DAS. Se havia apuração, ela sai.
    IF v_ap.id IS NOT NULL THEN
      PERFORM set_config('app.das', 'true', true);
      UPDATE public.contas_pagar SET ativo = false, status = 'Cancelado' WHERE id = v_ap.conta_pagar_id;
      DELETE FROM public.das_apuracoes WHERE id = v_ap.id;
      PERFORM set_config('app.das', '', true);
    END IF;
    RETURN jsonb_build_object('competencia', v_comp, 'receita', COALESCE(v_calc.receita, 0), 'valor', 0,
                              'mensagem', 'Sem receita na competência: não há DAS a pagar.');
  END IF;

  PERFORM set_config('app.das', 'true', true);
  IF v_ap.id IS NULL THEN
    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, natureza, origem)
    VALUES (v_desc, v_calc.imposto, v_venc, 'Pendente', p_filial, 'despesa', 'das')
    RETURNING * INTO v_conta;

    INSERT INTO public.das_apuracoes
      (filial, competencia, receita, rbt12, rbt12_origem, faixa, aliquota_efetiva, valor, vencimento, conta_pagar_id)
    VALUES (p_filial, v_comp, v_calc.receita, v_calc.rbt12, v_calc.rbt12_origem, v_calc.faixa,
            v_calc.aliquota_efetiva, v_calc.imposto, v_venc, v_conta.id)
    RETURNING * INTO v_ap;
  ELSE
    UPDATE public.contas_pagar
       SET valor = v_calc.imposto, vencimento = v_venc, descricao = v_desc
     WHERE id = v_ap.conta_pagar_id;
    UPDATE public.das_apuracoes
       SET receita = v_calc.receita, rbt12 = v_calc.rbt12, rbt12_origem = v_calc.rbt12_origem,
           faixa = v_calc.faixa, aliquota_efetiva = v_calc.aliquota_efetiva,
           valor = v_calc.imposto, vencimento = v_venc,
           apurado_em = now(), apurado_por = auth.uid()
     WHERE id = v_ap.id
    RETURNING * INTO v_ap;
  END IF;
  PERFORM set_config('app.das', '', true);

  RETURN jsonb_build_object(
    'competencia', v_comp, 'receita', v_ap.receita, 'faixa', v_ap.faixa,
    'aliquota_efetiva', v_ap.aliquota_efetiva, 'valor', v_ap.valor,
    'vencimento', v_ap.vencimento, 'conta_pagar_id', v_ap.conta_pagar_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.apurar_das(text, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apurar_das(text, date) TO authenticated;

-- ── Os últimos 12 meses fechados, para a tela ────────────────────────────────
CREATE OR REPLACE FUNCTION public.das_competencias(p_filial text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'DAS de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial veem a apuração do imposto.'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'competencia',      m.comp,
             'receita',          c.receita,
             'faixa',            c.faixa,
             'aliquota_efetiva', c.aliquota_efetiva,
             'imposto',          c.imposto,
             'vencimento',       public.vencimento_das(m.comp),
             'apurado',          ap.id IS NOT NULL,
             'valor_apurado',    ap.valor,
             'apurado_em',       ap.apurado_em,
             'conta_status',     cp.status,
             'conta_pagar_id',   ap.conta_pagar_id
           ) ORDER BY m.comp DESC)
      FROM (SELECT (date_trunc('month', public.acre_today()) - (n || ' months')::interval)::date AS comp
              FROM generate_series(1, 12) n) m
      CROSS JOIN LATERAL public._simples_do_mes(p_filial, m.comp) c
      LEFT JOIN public.das_apuracoes ap ON ap.filial = p_filial AND ap.competencia = m.comp
      LEFT JOIN public.contas_pagar cp ON cp.id = ap.conta_pagar_id
     WHERE c.receita <> 0 OR ap.id IS NOT NULL
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.das_competencias(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.das_competencias(text) TO authenticated;

-- ── A conta do DAS ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conta_de_das_congela()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.das', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.origem = 'das' THEN
      RAISE EXCEPTION 'O DAS nasce da apuração, em Financeiro › Precificação › Tributação.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.origem IS DISTINCT FROM OLD.origem
     AND 'das' IN (COALESCE(NEW.origem, ''), COALESCE(OLD.origem, '')) THEN
    RAISE EXCEPTION 'A origem da conta do DAS não se muda.' USING ERRCODE = '42501';
  END IF;

  IF OLD.origem = 'das'
     AND (NEW.valor IS DISTINCT FROM OLD.valor
          OR NEW.filial IS DISTINCT FROM OLD.filial
          OR NEW.natureza IS DISTINCT FROM OLD.natureza) THEN
    RAISE EXCEPTION 'O valor do DAS sai da apuração. Para corrigir, apure a competência de novo em Financeiro › Precificação › Tributação.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_conta_de_das_congela() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_de_das_congela ON public.contas_pagar;
CREATE TRIGGER trg_conta_de_das_congela
  BEFORE INSERT OR UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_de_das_congela();

CREATE OR REPLACE FUNCTION public.fn_conta_de_das_inativa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.origem = 'das'
     AND COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)
     AND COALESCE(current_setting('app.das', true), '') <> 'true' THEN
    DELETE FROM public.das_apuracoes WHERE conta_pagar_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_conta_de_das_inativa() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_de_das_inativa ON public.contas_pagar;
CREATE TRIGGER trg_conta_de_das_inativa
  AFTER UPDATE OF ativo ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_de_das_inativa();

-- ── Troca cirúrgica em duas funções vivas ────────────────────────────────────
-- replace() sobre o corpo do banco, com a contagem conferida: se o trecho não
-- estiver lá exatamente uma vez, a migração para em vez de adivinhar.
DO $migra$
DECLARE
  v_def  text;
  v_de   text;
  v_para text;
BEGIN
  -- DRE: a conta do DAS é pagamento do imposto que já está na dedução.
  v_def  := pg_get_functiondef('public._dre_calculo(text,date,date)'::regprocedure);
  v_de   := $$NOT IN ('devolucao_pdv', 'emprestimo')$$;
  v_para := $$NOT IN ('devolucao_pdv', 'emprestimo', 'das')$$;
  IF position(v_para IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
      RAISE EXCEPTION '658: trecho do _dre_calculo não encontrado exatamente uma vez';
    END IF;
    EXECUTE replace(v_def, v_de, v_para);
  END IF;

  -- Capital estourado: o DAS passa como empréstimo e rateio.
  v_def  := pg_get_functiondef('public.bloqueia_conta_pagar_estourado()'::regprocedure);
  v_de   := $$IN ('emprestimo', 'rateio')$$;
  v_para := $$IN ('emprestimo', 'rateio', 'das')$$;
  IF position(v_para IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
      RAISE EXCEPTION '658: trecho do bloqueia_conta_pagar_estourado não encontrado exatamente uma vez';
    END IF;
    EXECUTE replace(v_def, v_de, v_para);
  END IF;
END
$migra$;

NOTIFY pgrst, 'reload schema';
