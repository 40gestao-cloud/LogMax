-- 323_20260801_matriz_capital_e_rateio_administrativo.sql
--
-- A MATRIZ PASSA A TER VIDA FINANCEIRA PRÓPRIA.
--
-- Até aqui a holding era um ponto cego contábil. Admin, CEO e Conselheiro não
-- recebiam salário porque a folha só existia dentro de uma filial; e a Matriz
-- não tinha capital porque `capital_filial` tinha CHECK nas 3 unidades
-- operacionais. O resultado era uma empresa em que a diretoria trabalha de
-- graça e a holding não paga conta nenhuma — o oposto do que a turma precisa
-- ver.
--
-- Três partes:
--
--  1) CAPITAL DA MATRIZ. O CHECK de `capital_filial` passa a aceitar 'Matriz'.
--     `calcular_saldo_capital('Matriz')` já funcionava sem mudança nenhuma:
--     ela lê `capital_filial`, `contas_pagar` e `contas_receber` por filial, e
--     as duas tabelas de contas já nascem com DEFAULT 'Matriz' desde a 053.
--     Era só a trava de escrita do aporte que faltava.
--
--  2) RATEIO ADMINISTRATIVO (o elo que faltava entre Matriz e filiais).
--     É assim que holding de verdade se sustenta: o custo do centro
--     corporativo — diretoria, jurídico, contabilidade, sistemas — não fica
--     preso na holding. Ele é rateado entre as operações que o consomem, sob
--     contrato de compartilhamento de custos, e vira nota de débito. No Brasil
--     é o arranjo de CSC (Centro de Serviços Compartilhados): a holding não
--     "vende" nada, apenas recupera custo, e o rateio precisa de um critério
--     objetivo e constante — receita, headcount ou percentual fixo.
--
--     Aqui o mesmo desenho, sem o aparato fiscal: fechada a competência, a
--     Matriz apura o que gastou, escolhe o critério e distribui. Cada filial
--     recebe uma CONTA A PAGAR; a Matriz recebe uma CONTA A RECEBER por
--     filial. O par intercompany fecha: o que sai de uma entra na outra.
--
--     REGIME DE COMPETÊNCIA, não de caixa. A base é toda despesa da Matriz
--     LANÇADA no mês, paga ou não — é o custo incorrido que se rateia, e é o
--     que permite fechar o rateio antes de a holding quitar as contas.
--
--  3) A folha da Matriz não precisou de NADA no banco. `processar_folha` (272)
--     já lê a filial da própria folha, e a RLS da 190 libera admin/CEO em
--     qualquer filial via `auth_pode_filial`. O bloqueio era só de UI, e sai
--     no deploy que acompanha esta migração.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — CAPITAL DA MATRIZ
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.capital_filial DROP CONSTRAINT IF EXISTS capital_filial_filial_check;

DO $$
BEGIN
  ALTER TABLE public.capital_filial ADD CONSTRAINT capital_filial_filial_check
    CHECK (filial IN ('SuperMax', 'MaxLook', 'TechMax', 'Matriz'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON TABLE public.capital_filial IS
  'Aportes de capital por unidade. Desde a migr. 323 aceita ''Matriz'': o capital próprio da holding, de onde saem a folha da diretoria e o custo corporativo antes do rateio.';

-- `emprestimos_filial` segue restrito às 3 operacionais DE PROPÓSITO. A Matriz
-- é quem concede — não há a quem ela peça. Se um dia a holding captar no
-- mercado, isso é outra tabela, com banco e contrato, não este fluxo interno.

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — CONTAS A RECEBER GANHA `origem`
-- ════════════════════════════════════════════════════════════════════════════
-- `contas_pagar` já tem a coluna desde a 155 e é ela que separa despesa
-- operacional de financeira na DRE. Do lado da receita nunca houve o par —
-- sem ele, não há como distinguir receita de venda de recuperação de custo.

ALTER TABLE public.contas_receber ADD COLUMN IF NOT EXISTS origem text;

COMMENT ON COLUMN public.contas_receber.origem IS
  'Procedência do lançamento. ''rateio'' = recuperação de custo corporativo da Matriz (migr. 323). NULL = receita comum de venda.';

CREATE INDEX IF NOT EXISTS idx_contas_receber_origem
  ON public.contas_receber (origem) WHERE origem IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_origem
  ON public.contas_pagar (origem) WHERE origem IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — O RATEIO PASSA PELO BLOQUEIO DE CAPITAL
-- ════════════════════════════════════════════════════════════════════════════
-- Mesma razão da parcela de empréstimo: a dívida já existe. A filial consumiu
-- o serviço corporativo durante o mês — recusar o lançamento não desfaz o
-- consumo, só esconde o rombo e trava o fechamento da Matriz num mês em que
-- alguma unidade estourou. O bloqueio segue valendo para despesa nova, que é
-- onde ele muda comportamento.

CREATE OR REPLACE FUNCTION public.bloqueia_conta_pagar_estourado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bloqueado boolean;
BEGIN
  -- Obrigação já constituída passa: parcela de empréstimo contratado e
  -- rateio de custo corporativo já consumido (migr. 323).
  IF NEW.origem IN ('emprestimo', 'rateio') THEN RETURN NEW; END IF;
  -- Sem filial (Matriz global) não passa pelo bloqueio
  IF NEW.filial IS NULL OR NEW.filial = 'Matriz' THEN RETURN NEW; END IF;

  SELECT bloqueado INTO v_bloqueado
    FROM public.calcular_saldo_capital(NEW.filial)
    LIMIT 1;

  IF v_bloqueado THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Capital da filial ' || NEW.filial ||
                ' estourado. Solicite empréstimo à Matriz antes de lançar/pagar despesas.';
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4 — TABELAS DO RATEIO
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rateio_administrativo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia       text NOT NULL CHECK (competencia ~ '^\d{4}-\d{2}$'),
  criterio          text NOT NULL CHECK (criterio IN ('receita', 'headcount', 'igual')),
  -- Critério REALMENTE usado. Divergem quando o direcionador escolhido não
  -- tinha o que medir no mês (nenhuma receita recebida, nenhum funcionário
  -- ativo) e a apuração caiu em partes iguais. Guardar os dois evita que o
  -- histórico minta sobre como aquele mês foi distribuído.
  criterio_efetivo  text NOT NULL CHECK (criterio_efetivo IN ('receita', 'headcount', 'igual')),
  base_total        numeric(15,2) NOT NULL CHECK (base_total > 0),
  observacao        text,
  criado_por        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  criado_por_nome   text,
  ativo             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Parcial em `ativo`: rateio revertido não pode bloquear a reapuração do mesmo
-- mês — o índice cheio faria o segundo fechamento falhar para sempre.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rateio_competencia_ativo
  ON public.rateio_administrativo (competencia) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.rateio_administrativo_itens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rateio_id         uuid NOT NULL REFERENCES public.rateio_administrativo(id) ON DELETE CASCADE,
  filial            text NOT NULL CHECK (filial IN ('SuperMax', 'MaxLook', 'TechMax')),
  -- Valor do direcionador na filial (receita em R$, ou headcount em pessoas).
  -- É a prova do percentual: sem ele o rateio vira número sem origem.
  base_direcionador numeric(15,2) NOT NULL DEFAULT 0,
  percentual        numeric(7,4)  NOT NULL DEFAULT 0,
  valor             numeric(15,2) NOT NULL CHECK (valor >= 0),
  conta_pagar_id    uuid REFERENCES public.contas_pagar(id)   ON DELETE SET NULL,
  conta_receber_id  uuid REFERENCES public.contas_receber(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rateio_id, filial)
);

CREATE INDEX IF NOT EXISTS idx_rateio_itens_rateio ON public.rateio_administrativo_itens (rateio_id);

COMMENT ON TABLE public.rateio_administrativo IS
  'Fechamento mensal do custo corporativo da Matriz distribuído entre as filiais (migr. 323). Um por competência ativa.';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Leitura ampla dentro de quem tem cara de gestão: a filial precisa entender
-- de onde veio a conta a pagar que apareceu no Financeiro dela. Escrita é só
-- por RPC (admin/CEO), então não há policy de INSERT/UPDATE para authenticated.

ALTER TABLE public.rateio_administrativo       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rateio_administrativo_itens ENABLE ROW LEVEL SECURITY;

-- `auth_in_setor('financeiro')` já cobre admin, CEO e conselheiro por dentro
-- (auth_in_setor começa com auth_is_admin). O `OR` do gerente é escrito à mão
-- de propósito: existe um helper `auth_in_setor_ou_gerente` na migr. 185, mas
-- ele NÃO está presente em nenhum dos 4 projetos — a 187 refez as policies com
-- `auth_gerente_da` e o helper nunca chegou a existir em produção. Usá-lo aqui
-- faria esta migração abortar inteira com "function does not exist".
DROP POLICY IF EXISTS rateio_select ON public.rateio_administrativo;
CREATE POLICY rateio_select ON public.rateio_administrativo
  FOR SELECT TO authenticated
  USING (public.auth_in_setor('financeiro') OR public.auth_user_role() = 'gerente');

DROP POLICY IF EXISTS rateio_itens_select ON public.rateio_administrativo_itens;
CREATE POLICY rateio_itens_select ON public.rateio_administrativo_itens
  FOR SELECT TO authenticated
  USING (public.auth_in_setor('financeiro') OR public.auth_user_role() = 'gerente');

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 5 — APURAÇÃO (só lê, não escreve)
-- ════════════════════════════════════════════════════════════════════════════
-- Prévia antes de comprometer. `aplicar_rateio_administrativo` chama esta
-- mesma função, então a tela nunca mostra um número diferente do que vai ser
-- gravado — a duplicação de regra é o jeito clássico de o preview mentir.

CREATE OR REPLACE FUNCTION public.apurar_rateio_administrativo(
  p_competencia text,
  p_criterio    text DEFAULT 'receita'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ini          date;
  v_fim          date;
  v_base         numeric(15,2) := 0;
  v_criterio_ef  text;
  v_total_dir    numeric := 0;
  v_itens        jsonb := '[]'::jsonb;
  v_acumulado    numeric(15,2) := 0;
  v_maior_filial text;
  v_maior_valor  numeric(15,2) := -1;
  v_valor        numeric(15,2);
  v_pct          numeric;
  v_ja_existe    boolean;
  r              RECORD;
  v_dir          jsonb := '{}'::jsonb;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  IF p_competencia !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Competência inválida (esperado AAAA-MM, veio %).', p_competencia
      USING ERRCODE = 'P0001';
  END IF;

  IF p_criterio NOT IN ('receita', 'headcount', 'igual') THEN
    RAISE EXCEPTION 'Critério inválido: %. Use receita, headcount ou igual.', p_criterio
      USING ERRCODE = 'P0001';
  END IF;

  v_ini := to_date(p_competencia || '-01', 'YYYY-MM-DD');
  v_fim := (v_ini + interval '1 month')::date;

  -- Base: TODA despesa da Matriz lançada na competência, paga ou não (regime
  -- de competência). Fora ficam: o próprio rateio — que reentraria na base do
  -- mês seguinte e cresceria sozinho a cada fechamento — e as parcelas de
  -- empréstimo, que são despesa financeira da holding e não serviço prestado
  -- à filial. A data é a do lançamento no fuso do Acre, não UTC: perto da
  -- virada do mês os dois discordam por 5 horas.
  SELECT COALESCE(SUM(cp.valor), 0) INTO v_base
    FROM public.contas_pagar cp
   WHERE cp.filial = 'Matriz'
     AND COALESCE(cp.ativo, true)
     AND COALESCE(cp.origem, '') NOT IN ('rateio', 'emprestimo')
     AND (cp.created_at AT TIME ZONE 'America/Rio_Branco')::date >= v_ini
     AND (cp.created_at AT TIME ZONE 'America/Rio_Branco')::date <  v_fim;

  SELECT EXISTS (
    SELECT 1 FROM public.rateio_administrativo
     WHERE competencia = p_competencia AND ativo
  ) INTO v_ja_existe;

  -- Direcionador por filial. `receita` é o padrão de mercado — quem fatura
  -- mais consome mais estrutura corporativa e absorve mais custo. `headcount`
  -- serve quando o corporativo é majoritariamente RH. `igual` é o fallback
  -- honesto: distribui sem fingir que mediu algo.
  v_criterio_ef := p_criterio;

  IF p_criterio = 'receita' THEN
    FOR r IN
      SELECT f.filial,
             COALESCE((
               SELECT SUM(cr.valor) FROM public.contas_receber cr
                WHERE cr.filial = f.filial
                  AND cr.status IN ('Pago', 'Recebido')
                  AND COALESCE(cr.ativo, true)
                  AND COALESCE(cr.origem, '') <> 'rateio'
                  AND (cr.created_at AT TIME ZONE 'America/Rio_Branco')::date >= v_ini
                  AND (cr.created_at AT TIME ZONE 'America/Rio_Branco')::date <  v_fim
             ), 0) AS dir
        FROM (VALUES ('SuperMax'), ('MaxLook'), ('TechMax')) AS f(filial)
    LOOP
      v_dir := v_dir || jsonb_build_object(r.filial, r.dir);
      v_total_dir := v_total_dir + r.dir;
    END LOOP;

  ELSIF p_criterio = 'headcount' THEN
    FOR r IN
      SELECT f.filial,
             COALESCE((
               SELECT COUNT(*) FROM public.funcionarios fu
                WHERE fu.filial = f.filial
                  AND fu.status = 'Ativo'
                  AND COALESCE(fu.ativo, true)
             ), 0) AS dir
        FROM (VALUES ('SuperMax'), ('MaxLook'), ('TechMax')) AS f(filial)
    LOOP
      v_dir := v_dir || jsonb_build_object(r.filial, r.dir);
      v_total_dir := v_total_dir + r.dir;
    END LOOP;
  END IF;

  -- Direcionador zerado não é motivo para falhar o fechamento: o custo existiu
  -- e precisa ir a algum lugar. Cai em partes iguais e diz que caiu.
  IF p_criterio = 'igual' OR v_total_dir <= 0 THEN
    v_criterio_ef := 'igual';
    v_dir := jsonb_build_object('SuperMax', 1, 'MaxLook', 1, 'TechMax', 1);
    v_total_dir := 3;
  END IF;

  -- Distribuição com resíduo. Arredondar três parcelas independentes quase
  -- nunca fecha no centavo com a base; a sobra vai para a maior cota, que é a
  -- convenção contábil e a que menos distorce o percentual.
  FOR r IN
    SELECT f.filial, (v_dir ->> f.filial)::numeric AS dir
      FROM (VALUES ('SuperMax'), ('MaxLook'), ('TechMax')) AS f(filial)
     ORDER BY f.filial
  LOOP
    v_pct   := ROUND(r.dir / v_total_dir * 100, 4);
    v_valor := ROUND(v_base * r.dir / v_total_dir, 2);
    v_acumulado := v_acumulado + v_valor;
    IF v_valor > v_maior_valor THEN
      v_maior_valor  := v_valor;
      v_maior_filial := r.filial;
    END IF;
    v_itens := v_itens || jsonb_build_object(
      'filial',            r.filial,
      'base_direcionador', r.dir,
      'percentual',        v_pct,
      'valor',             v_valor
    );
  END LOOP;

  IF v_base > 0 AND v_acumulado <> v_base AND v_maior_filial IS NOT NULL THEN
    SELECT jsonb_agg(
             CASE WHEN e.it ->> 'filial' = v_maior_filial
               THEN jsonb_set(e.it, '{valor}',
                      to_jsonb(ROUND((e.it ->> 'valor')::numeric + (v_base - v_acumulado), 2)))
               ELSE e.it END
             ORDER BY e.ord
           )
      INTO v_itens
      FROM jsonb_array_elements(v_itens) WITH ORDINALITY AS e(it, ord);
  END IF;

  RETURN jsonb_build_object(
    'competencia',      p_competencia,
    'criterio',         p_criterio,
    'criterio_efetivo', v_criterio_ef,
    'base_total',       v_base,
    'ja_aplicado',      v_ja_existe,
    'itens',            v_itens
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apurar_rateio_administrativo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apurar_rateio_administrativo(text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 6 — APLICAÇÃO (gera o par intercompany)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.aplicar_rateio_administrativo(
  p_competencia text,
  p_criterio    text DEFAULT 'receita'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apuracao jsonb;
  v_rateio_id uuid;
  v_venc      date;
  v_nome      text;
  v_cp_id     uuid;
  v_cr_id     uuid;
  v_valor     numeric(15,2);
  it          jsonb;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  -- Fechar competência é ato de holding. RH e financeiro da filial leem o
  -- resultado, mas não decidem quanto a própria unidade absorve.
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Só admin, CEO ou conselheiro fecham o rateio administrativo.'
      USING ERRCODE = '42501';
  END IF;

  v_apuracao := public.apurar_rateio_administrativo(p_competencia, p_criterio);

  IF (v_apuracao ->> 'ja_aplicado')::boolean THEN
    RAISE EXCEPTION 'A competência % já tem rateio aplicado. Reverta o anterior antes de refazer.', p_competencia
      USING ERRCODE = 'P0001';
  END IF;

  IF (v_apuracao ->> 'base_total')::numeric <= 0 THEN
    RAISE EXCEPTION 'A Matriz não tem despesa lançada em %. Registre a folha da diretoria e os custos corporativos antes de ratear.', p_competencia
      USING ERRCODE = 'P0001';
  END IF;

  -- Vencimento: dia 10 do mês seguinte. Depois do dia 5 da folha, para a
  -- filial não fechar o mês devendo à Matriz antes de pagar quem trabalha.
  v_venc := (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month' + interval '9 days')::date;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.rateio_administrativo
    (competencia, criterio, criterio_efetivo, base_total, observacao, criado_por, criado_por_nome)
  VALUES (
    p_competencia,
    p_criterio,
    v_apuracao ->> 'criterio_efetivo',
    (v_apuracao ->> 'base_total')::numeric,
    CASE WHEN (v_apuracao ->> 'criterio') <> (v_apuracao ->> 'criterio_efetivo')
      THEN 'Direcionador "' || (v_apuracao ->> 'criterio') || '" sem base no mês — distribuído em partes iguais.'
      ELSE NULL END,
    auth.uid(),
    v_nome
  )
  RETURNING id INTO v_rateio_id;

  FOR it IN SELECT * FROM jsonb_array_elements(v_apuracao -> 'itens')
  LOOP
    v_valor := (it ->> 'valor')::numeric;
    v_cp_id := NULL;
    v_cr_id := NULL;

    -- Cota zero não vira lançamento. Acontece de verdade: no critério de
    -- receita, a unidade que não recebeu nada no mês absorve 0% — e emitir uma
    -- conta a pagar de R$ 0,00 encheria o Financeiro dela de lixo que não dá
    -- para pagar nem baixar. O item do rateio é gravado do mesmo jeito, com o
    -- percentual, para o fechamento continuar explicando as três unidades.
    IF v_valor > 0 THEN
      INSERT INTO public.contas_pagar
        (descricao, valor, vencimento, status, filial, origem)
      VALUES (
        'Rateio administrativo ' || p_competencia || ' — Matriz',
        v_valor, v_venc, 'Pendente', it ->> 'filial', 'rateio'
      )
      RETURNING id INTO v_cp_id;

      INSERT INTO public.contas_receber
        (descricao, valor, vencimento, status, filial, origem)
      VALUES (
        'Rateio administrativo ' || p_competencia || ' — ' || (it ->> 'filial'),
        v_valor, v_venc, 'Aberto', 'Matriz', 'rateio'
      )
      RETURNING id INTO v_cr_id;
    END IF;

    INSERT INTO public.rateio_administrativo_itens
      (rateio_id, filial, base_direcionador, percentual, valor, conta_pagar_id, conta_receber_id)
    VALUES (
      v_rateio_id, it ->> 'filial',
      (it ->> 'base_direcionador')::numeric,
      (it ->> 'percentual')::numeric,
      v_valor, v_cp_id, v_cr_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'rateio_id', v_rateio_id,
    'competencia', p_competencia,
    'criterio_efetivo', v_apuracao ->> 'criterio_efetivo',
    'base_total', (v_apuracao ->> 'base_total')::numeric
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aplicar_rateio_administrativo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_rateio_administrativo(text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 7 — REVERSÃO
-- ════════════════════════════════════════════════════════════════════════════
-- Erro de critério no fechamento é comum e não pode virar dívida eterna entre
-- as unidades. Inativa o par dos dois lados; conta já paga trava a reversão,
-- porque desfazer dinheiro que mudou de caixa é estorno, não correção.

CREATE OR REPLACE FUNCTION public.reverter_rateio_administrativo(p_rateio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competencia text;
  v_pagas       int;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Só admin, CEO ou conselheiro revertem o rateio administrativo.'
      USING ERRCODE = '42501';
  END IF;

  SELECT competencia INTO v_competencia
    FROM public.rateio_administrativo
   WHERE id = p_rateio_id AND ativo
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rateio não encontrado ou já revertido.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO v_pagas
    FROM public.rateio_administrativo_itens i
    LEFT JOIN public.contas_pagar   cp ON cp.id = i.conta_pagar_id
    LEFT JOIN public.contas_receber cr ON cr.id = i.conta_receber_id
   WHERE i.rateio_id = p_rateio_id
     AND (cp.status = 'Pago' OR cr.status IN ('Pago', 'Recebido'));

  IF v_pagas > 0 THEN
    RAISE EXCEPTION 'Há % lançamento(s) já quitado(s) neste rateio. Estorne o pagamento antes de reverter.', v_pagas
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.contas_pagar SET ativo = false
   WHERE id IN (SELECT conta_pagar_id FROM public.rateio_administrativo_itens
                 WHERE rateio_id = p_rateio_id AND conta_pagar_id IS NOT NULL);

  UPDATE public.contas_receber SET ativo = false
   WHERE id IN (SELECT conta_receber_id FROM public.rateio_administrativo_itens
                 WHERE rateio_id = p_rateio_id AND conta_receber_id IS NOT NULL);

  UPDATE public.rateio_administrativo SET ativo = false WHERE id = p_rateio_id;

  RETURN jsonb_build_object('ok', true, 'competencia', v_competencia);
END;
$$;

REVOKE ALL ON FUNCTION public.reverter_rateio_administrativo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverter_rateio_administrativo(uuid) TO authenticated;

COMMIT;

-- Sem isto o PostgREST devolve PGRST202 nas 3 RPCs novas até o próximo reload.
NOTIFY pgrst, 'reload schema';
