-- 679 — Contas de consumo: tipo de fornecedor, conta recorrente e fatura
--
-- Diagnóstico (2026-10-07): luz, água e internet viviam no Contas a Pagar
-- como conta avulsa digitada todo mês, sem centro de custo (27 de 27 avulsas
-- nas 4 turmas caíam em "Não classificado" no DRE), e a concessionária era
-- cadastrada como fornecedor de mercadoria — categoria em texto livre ("Água",
-- "Àgua", "energia"…), prazo de entrega, e aparecendo nos selects de compra.
--
-- 1. fornecedores.tipo — 'mercadoria' | 'servico' | 'concessionaria'. Default
--    mercadoria: todo cadastro existente continua igual. Concessionária não
--    entra em cotação, pedido, nota de compra nem como fornecedor habitual de
--    produto — a trava é no banco (gatilho), não só no select.
--    Sem backfill aqui: a lista de quem vira concessionária/serviço é aprovada
--    à parte.
--
-- 2. despesas_recorrentes — o "contrato" da conta de consumo (padrão de
--    mercado, Omie/Conta Azul): fornecedor, centro de custo, dia de vencimento
--    e se o valor é FIXO (internet, aluguel) ou VARIÁVEL (energia, água).
--
-- 3. gerar_contas_recorrentes(filial) — gera as competências que faltam, até o
--    mês seguinte ao atual (a fatura aparece antes de vencer). Fixa nasce com o
--    valor do contrato; variável nasce como PREVISÃO (média das últimas 3
--    faturas confirmadas, ou o valor estimado do contrato) com
--    `valor_estimado = true`. Idempotente: índice único (recorrência,
--    competência) + `ultima_competencia` no contrato — um reset que apaga as
--    contas não faz o gerador recriar meses passados.
--
-- 4. Fatura antes de pagar: conta com `valor_estimado` não recebe baixa. Mudar
--    o valor (ou mandar valor_estimado=false) é "informar a fatura" e guarda a
--    previsão em `valor_previsto` para comparar.

BEGIN;

-- ── 1. Tipo de fornecedor ────────────────────────────────────────────────
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'mercadoria';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fornecedores_tipo') THEN
    ALTER TABLE public.fornecedores ADD CONSTRAINT chk_fornecedores_tipo
      CHECK (tipo IN ('mercadoria', 'servico', 'concessionaria'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_fornecedor_nao_e_concessionaria()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_col  text := TG_ARGV[0];
  v_id   uuid;
  v_nome text;
BEGIN
  v_id := (to_jsonb(NEW) ->> v_col)::uuid;
  IF v_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND v_id IS NOT DISTINCT FROM (to_jsonb(OLD) ->> v_col)::uuid THEN
    RETURN NEW;
  END IF;
  SELECT nome INTO v_nome FROM public.fornecedores WHERE id = v_id AND tipo = 'concessionaria';
  IF FOUND THEN
    RAISE EXCEPTION '% é concessionária (energia, água, internet…): a conta dela vai direto em Contas a Pagar, não passa por compra.', v_nome
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_fornecedor_nao_e_concessionaria() FROM public, anon;

DROP TRIGGER IF EXISTS trg_fornecedor_nao_e_concessionaria ON public.cotacoes;
CREATE TRIGGER trg_fornecedor_nao_e_concessionaria BEFORE INSERT OR UPDATE OF fornecedor_id ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_fornecedor_nao_e_concessionaria('fornecedor_id');
DROP TRIGGER IF EXISTS trg_fornecedor_nao_e_concessionaria ON public.pedidos;
CREATE TRIGGER trg_fornecedor_nao_e_concessionaria BEFORE INSERT OR UPDATE OF fornecedor_id ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_fornecedor_nao_e_concessionaria('fornecedor_id');
DROP TRIGGER IF EXISTS trg_fornecedor_nao_e_concessionaria ON public.notas_recebidas;
CREATE TRIGGER trg_fornecedor_nao_e_concessionaria BEFORE INSERT OR UPDATE OF fornecedor_id ON public.notas_recebidas
  FOR EACH ROW EXECUTE FUNCTION public.fn_fornecedor_nao_e_concessionaria('fornecedor_id');
DROP TRIGGER IF EXISTS trg_fornecedor_nao_e_concessionaria ON public.produtos;
CREATE TRIGGER trg_fornecedor_nao_e_concessionaria BEFORE INSERT OR UPDATE OF fornecedor_id ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_fornecedor_nao_e_concessionaria('fornecedor_id');
DROP TRIGGER IF EXISTS trg_fornecedor_nao_e_concessionaria ON public.fretes_compra;
CREATE TRIGGER trg_fornecedor_nao_e_concessionaria BEFORE INSERT OR UPDATE OF transportadora_id ON public.fretes_compra
  FOR EACH ROW EXECUTE FUNCTION public.fn_fornecedor_nao_e_concessionaria('transportadora_id');

-- ── 2. Contrato da conta recorrente ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.despesas_recorrentes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial             text NOT NULL,
  descricao          text NOT NULL CHECK (btrim(descricao) <> ''),
  fornecedor_id      uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  centro_custo_id    uuid REFERENCES public.centros_custo(id) ON DELETE SET NULL,
  tipo_valor         text NOT NULL DEFAULT 'fixo' CHECK (tipo_valor IN ('fixo', 'variavel')),
  valor              numeric(15,2) NOT NULL CHECK (valor > 0),
  dia_vencimento     integer NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  inicio             date NOT NULL,
  fim                date,
  ultima_competencia text,
  ativo              boolean NOT NULL DEFAULT true,
  criado_por         uuid,
  atualizado_por     uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (fim IS NULL OR fim >= inicio)
);
CREATE INDEX IF NOT EXISTS idx_despesas_recorrentes_filial ON public.despesas_recorrentes (filial) WHERE ativo;

ALTER TABLE public.despesas_recorrentes ENABLE ROW LEVEL SECURITY;
-- Espelha contas_pagar: Financeiro ou o gerente da unidade; admin vê todas.
DROP POLICY IF EXISTS desp_rec_select ON public.despesas_recorrentes;
CREATE POLICY desp_rec_select ON public.despesas_recorrentes FOR SELECT TO authenticated
  USING (((SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text])) OR (((SELECT auth_user_role()) = 'gerente'::text) AND ((SELECT auth_user_filial()) = filial)))
         AND ((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = filial)));
DROP POLICY IF EXISTS desp_rec_insert ON public.despesas_recorrentes;
CREATE POLICY desp_rec_insert ON public.despesas_recorrentes FOR INSERT TO authenticated
  WITH CHECK (COALESCE((SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text])) OR (((SELECT auth_user_role()) = 'gerente'::text) AND ((SELECT auth_user_filial()) = filial)), false)
              AND COALESCE((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = filial), false));
DROP POLICY IF EXISTS desp_rec_update ON public.despesas_recorrentes;
CREATE POLICY desp_rec_update ON public.despesas_recorrentes FOR UPDATE TO authenticated
  USING (((SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text])) OR (((SELECT auth_user_role()) = 'gerente'::text) AND ((SELECT auth_user_filial()) = filial)))
         AND ((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = filial)))
  WITH CHECK (COALESCE((SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text])) OR (((SELECT auth_user_role()) = 'gerente'::text) AND ((SELECT auth_user_filial()) = filial)), false)
              AND COALESCE((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = filial), false));
DROP POLICY IF EXISTS desp_rec_delete ON public.despesas_recorrentes;
CREATE POLICY desp_rec_delete ON public.despesas_recorrentes FOR DELETE TO authenticated
  USING (((SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text])) OR (((SELECT auth_user_role()) = 'gerente'::text) AND ((SELECT auth_user_filial()) = filial)))
         AND ((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = filial)));
DROP POLICY IF EXISTS zz_blackout ON public.despesas_recorrentes;
CREATE POLICY zz_blackout ON public.despesas_recorrentes AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (SELECT auth_blackout())) WITH CHECK (NOT (SELECT auth_blackout()));
DROP POLICY IF EXISTS zz_desligado_bloqueia_insert ON public.despesas_recorrentes;
CREATE POLICY zz_desligado_bloqueia_insert ON public.despesas_recorrentes AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (SELECT auth_desligado()));

REVOKE ALL ON public.despesas_recorrentes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.despesas_recorrentes TO authenticated;

DROP TRIGGER IF EXISTS trg_auditoria ON public.despesas_recorrentes;
CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON public.despesas_recorrentes
  FOR EACH ROW EXECUTE FUNCTION public.set_auditoria_campos();
DROP TRIGGER IF EXISTS trg_historico ON public.despesas_recorrentes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.despesas_recorrentes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor', 'dia_vencimento');

-- ── 3/4. Colunas da conta gerada ─────────────────────────────────────────
ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS recorrencia_id uuid REFERENCES public.despesas_recorrentes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS competencia    text,
  ADD COLUMN IF NOT EXISTS valor_estimado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_previsto numeric(15,2);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_pagar_recorrencia_competencia
  ON public.contas_pagar (recorrencia_id, competencia)
  WHERE recorrencia_id IS NOT NULL AND ativo AND status <> 'Cancelado';

CREATE OR REPLACE FUNCTION public.fn_conta_pagar_fatura_antes_de_pagar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Mudou o valor de uma previsão = informou a fatura.
  IF OLD.valor_estimado AND NEW.valor_estimado AND NEW.valor IS DISTINCT FROM OLD.valor THEN
    NEW.valor_estimado := false;
  END IF;
  IF OLD.valor_estimado AND NOT NEW.valor_estimado THEN
    NEW.valor_previsto := COALESCE(OLD.valor_previsto, OLD.valor);
  END IF;
  IF NEW.valor_estimado
     AND NEW.status IN ('Pago', 'Parcial') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'O valor de "%" é uma previsão. Informe o valor da fatura antes de pagar.', NEW.descricao
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_conta_pagar_fatura_antes_de_pagar() FROM public, anon;

DROP TRIGGER IF EXISTS trg_conta_pagar_fatura_antes_de_pagar ON public.contas_pagar;
CREATE TRIGGER trg_conta_pagar_fatura_antes_de_pagar BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_pagar_fatura_antes_de_pagar();

-- ── 3. Gerador ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gerar_contas_recorrentes(p_filial text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec      public.despesas_recorrentes;
  v_limite   date := (date_trunc('month', public.acre_today()) + interval '1 month')::date;
  v_mes      date;
  v_comp     text;
  v_venc     date;
  v_valor    numeric;
  v_media    numeric;
  v_geradas  integer := 0;
  v_avisos   text[] := '{}';
BEGIN
  PERFORM public._assert_rpc();
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false)
     OR NOT COALESCE(public.auth_in_setor('financeiro') OR public.auth_gerente_da(p_filial), false) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da unidade geram as contas recorrentes.'
      USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT * FROM public.despesas_recorrentes
     WHERE filial = p_filial AND ativo
     ORDER BY id
     FOR UPDATE
  LOOP
    v_mes := GREATEST(
      date_trunc('month', v_rec.inicio)::date,
      CASE WHEN v_rec.ultima_competencia IS NULL THEN date_trunc('month', v_rec.inicio)::date
           ELSE (to_date(v_rec.ultima_competencia || '-01', 'YYYY-MM-DD') + interval '1 month')::date END
    );

    WHILE v_mes <= v_limite AND (v_rec.fim IS NULL OR v_mes <= date_trunc('month', v_rec.fim)::date) LOOP
      v_comp := to_char(v_mes, 'YYYY-MM');
      v_venc := make_date(extract(year FROM v_mes)::int, extract(month FROM v_mes)::int,
                          LEAST(v_rec.dia_vencimento,
                                extract(day FROM (v_mes + interval '1 month' - interval '1 day'))::int));

      IF v_rec.tipo_valor = 'variavel' THEN
        SELECT round(avg(valor), 2) INTO v_media FROM (
          SELECT cp.valor FROM public.contas_pagar cp
           WHERE cp.recorrencia_id = v_rec.id AND NOT cp.valor_estimado
             AND COALESCE(cp.ativo, true) AND cp.status <> 'Cancelado'
           ORDER BY cp.competencia DESC LIMIT 3) u;
        v_valor := COALESCE(v_media, v_rec.valor);
      ELSE
        v_valor := v_rec.valor;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.contas_pagar cp
                      WHERE cp.recorrencia_id = v_rec.id AND cp.competencia = v_comp
                        AND COALESCE(cp.ativo, true) AND cp.status <> 'Cancelado') THEN
        BEGIN
          INSERT INTO public.contas_pagar
            (descricao, valor, vencimento, status, filial, origem, fornecedor_id, centro_custo_id,
             natureza, recorrencia_id, competencia, valor_estimado, valor_previsto)
          VALUES (v_rec.descricao || ' — ' || to_char(v_mes, 'MM/YYYY'), v_valor, v_venc, 'Pendente',
                  v_rec.filial, 'recorrente', v_rec.fornecedor_id, v_rec.centro_custo_id, 'despesa',
                  v_rec.id, v_comp, v_rec.tipo_valor = 'variavel', v_valor);
          v_geradas := v_geradas + 1;
        EXCEPTION WHEN raise_exception THEN
          -- Ex.: capital da filial estourado. Para nesta recorrência e avisa;
          -- a competência volta na próxima geração.
          v_avisos := v_avisos || (v_rec.descricao || ' ' || to_char(v_mes, 'MM/YYYY') || ': ' || SQLERRM);
          EXIT;
        END;
      END IF;

      UPDATE public.despesas_recorrentes SET ultima_competencia = v_comp WHERE id = v_rec.id;
      v_mes := (v_mes + interval '1 month')::date;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('geradas', v_geradas, 'avisos', to_jsonb(v_avisos));
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_contas_recorrentes(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gerar_contas_recorrentes(text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
