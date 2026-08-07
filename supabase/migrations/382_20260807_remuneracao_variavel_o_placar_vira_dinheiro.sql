-- =================================================================
-- 382 — Remuneração variável: o placar vira dinheiro.
--
-- Item #G2 do backlog de governança. O de maior acoplamento: toca placar,
-- metas, folha e MaxBank de uma vez.
--
-- O buraco: o placar da competição é orgulho e nada mais. O aluno é
-- cobrado por uma nota que não muda nada na vida dele. Numa empresa real
-- o Conselho aprova a política de bônus e o pagamento sai do desempenho
-- medido — é isso que faz a nota importar.
--
-- Como o bônus é calculado:
--   fator  = (peso_placar × nota_placar + peso_metas × atingimento) / 10000
--   bônus  = salário_base × percentual_salario% × fator
--
--   • nota_placar vem de `_calcular_placar_competicao_raw` → por_filial →
--     <filial> → media, que já é 0-100 (o julgamento do Conselho ×10
--     combinado com a frequência ×100). Uso a versão _raw, e não a
--     `calcular_placar_competicao`, porque a pública tem guard de papel:
--     chamada de dentro de outra SECURITY DEFINER ela barraria a apuração.
--   • atingimento é o % de tarefas táticas do colaborador concluídas
--     dentro do período da competição. Zero tarefas no período = zero
--     atingimento, não 100%: quem não recebeu meta não é premiado por
--     isso, e quem recebeu e não fez também não.
--   • salário_base vem de `funcionarios.salario` (o cadastro), não da
--     última folha: bônus tem de existir mesmo em mês sem folha rodada.
--
-- Decisões que valem estar escritas:
--   • GATILHO. Abaixo de `nota_minima` no placar, a filial inteira fica
--     sem bônus, por melhor que seja o atingimento individual. Bônus é
--     coletivo — é o que diferencia de comissão.
--   • A política é VERSIONADA por vigência e a apuração guarda qual usou.
--     Mudar a régua depois não reescreve o que já foi pago.
--   • Apurar e PAGAR são atos separados. Apuração é conta; pagamento é
--     dinheiro. O Conselho olha a conta antes de mandar creditar.
--   • O crédito cai em `saldo_bonificacoes`, carteira que já existia no
--     MaxBank e nunca tinha fonte. Idempotente por índice parcial, mesmo
--     padrão de `creditar_folha_maxbank`: repetir o pagamento não duplica.
--   • Desligado não entra (`_funcionario_desligado`), igual ao placar.
--
-- ATENÇÃO — SOBREPOSIÇÃO CONHECIDA: `tarefas_taticas.valor_bonificacao` já
-- é um pagamento por tarefa que existe desde as Metas em 2 níveis. Este
-- módulo NÃO o substitui nem o desliga: são duas fontes de crédito na
-- mesma carteira de bonificações, e uma tarefa aprovada pode pagar duas
-- vezes (uma pelo valor_bonificacao, outra por entrar no atingimento).
-- Se a intenção for uma régua só, o caminho é zerar `valor_bonificacao`
-- nas tarefas do período apurado — decisão pedagógica, não técnica, então
-- deixei explícita em vez de resolvida por mim.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Política de remuneração (versionada) ───────────────────────
CREATE TABLE IF NOT EXISTS public.politicas_remuneracao (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text NOT NULL,
  vigencia_inicio    date NOT NULL,
  vigencia_fim       date,
  peso_placar        numeric(5,2) NOT NULL DEFAULT 70 CHECK (peso_placar  BETWEEN 0 AND 100),
  peso_metas         numeric(5,2) NOT NULL DEFAULT 30 CHECK (peso_metas   BETWEEN 0 AND 100),
  percentual_salario numeric(5,2) NOT NULL DEFAULT 10 CHECK (percentual_salario BETWEEN 0 AND 100),
  nota_minima        numeric(5,2) NOT NULL DEFAULT 60 CHECK (nota_minima  BETWEEN 0 AND 100),
  ativo              boolean NOT NULL DEFAULT true,
  criado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (peso_placar + peso_metas = 100),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

COMMENT ON TABLE public.politicas_remuneracao IS
  'Regua do bonus aprovada pelo Conselho. Versionada por vigencia: mudar a regua nao reescreve o que ja foi pago.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_politica_vigencia
  ON public.politicas_remuneracao (vigencia_inicio) WHERE ativo = true;

-- ── 2. Apuração e seus itens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.apuracoes_bonus (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id  uuid NOT NULL REFERENCES public.competicoes_matriz(id) ON DELETE CASCADE,
  politica_id    uuid NOT NULL REFERENCES public.politicas_remuneracao(id) ON DELETE RESTRICT,
  status         text NOT NULL DEFAULT 'calculada' CHECK (status IN ('calculada','paga')),
  total          numeric(14,2) NOT NULL DEFAULT 0,
  apurado_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  apurado_em     timestamptz NOT NULL DEFAULT now(),
  pago_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pago_em        timestamptz,
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_apuracao_competicao
  ON public.apuracoes_bonus (competicao_id) WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.apuracao_bonus_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apuracao_id    uuid NOT NULL REFERENCES public.apuracoes_bonus(id) ON DELETE CASCADE,
  colaborador_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  filial         text NOT NULL,
  salario_base   numeric(14,2) NOT NULL DEFAULT 0,
  nota_placar    numeric(6,2)  NOT NULL DEFAULT 0,
  atingimento    numeric(6,2)  NOT NULL DEFAULT 0,
  fator          numeric(8,6)  NOT NULL DEFAULT 0,
  valor_bonus    numeric(14,2) NOT NULL DEFAULT 0,
  motivo_zero    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (apuracao_id, colaborador_id)
);

COMMENT ON COLUMN public.apuracao_bonus_itens.motivo_zero IS
  'Por que o bonus saiu zero. Sem isto o aluno ve R$ 0,00 e nao sabe se foi gatilho, meta ou salario.';

ALTER TABLE public.politicas_remuneracao  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apuracoes_bonus        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apuracao_bonus_itens   ENABLE ROW LEVEL SECURITY;

-- A régua é pública: bônus com critério secreto não motiva ninguém.
DROP POLICY IF EXISTS politica_read ON public.politicas_remuneracao;
CREATE POLICY politica_read ON public.politicas_remuneracao
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS politica_write ON public.politicas_remuneracao;
CREATE POLICY politica_write ON public.politicas_remuneracao
  FOR ALL TO authenticated
  USING (COALESCE(auth_is_admin(), false) AND COALESCE(NOT auth_desligado(), false))
  WITH CHECK (COALESCE(auth_is_admin(), false));

DROP POLICY IF EXISTS apuracao_read ON public.apuracoes_bonus;
CREATE POLICY apuracao_read ON public.apuracoes_bonus
  FOR SELECT TO authenticated USING (true);

-- Cada um vê o próprio item; o Conselho vê todos.
DROP POLICY IF EXISTS apuracao_item_read ON public.apuracao_bonus_itens;
CREATE POLICY apuracao_item_read ON public.apuracao_bonus_itens
  FOR SELECT TO authenticated
  USING (colaborador_id = auth.uid() OR COALESCE(auth_is_admin(), false));

-- ── 3. Idempotência do crédito ────────────────────────────────────
-- Mesma forma do índice de 'meta_estrategica': uma apuração credita N
-- pessoas, então a chave inclui a conta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_bonus
  ON public.maxbank_transacoes (origem_id, conta_id, carteira)
  WHERE origem = 'remuneracao_variavel';

-- ── 4. Apurar ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apurar_bonus(
  p_competicao_id uuid,
  p_politica_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_comp    competicoes_matriz;
  v_pol     politicas_remuneracao;
  v_placar  jsonb;
  v_ap_id   uuid;
  v_total   numeric(14,2) := 0;
  v_nota    numeric;
  v_ating   numeric;
  v_fator   numeric;
  v_valor   numeric(14,2);
  v_motivo  text;
  v_tot     int;
  v_ok      int;
  r         record;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho apura remuneração variável.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pol FROM politicas_remuneracao WHERE id = p_politica_id AND ativo = true;
  IF v_pol.id IS NULL THEN
    RAISE EXCEPTION 'Política de remuneração não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM apuracoes_bonus
              WHERE competicao_id = p_competicao_id AND ativo = true) THEN
    RAISE EXCEPTION 'Esta competição já tem apuração. Inative a anterior para refazer.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Versão _raw: a pública tem guard de papel e barraria a chamada aqui.
  v_placar := _calcular_placar_competicao_raw(p_competicao_id);

  INSERT INTO apuracoes_bonus (competicao_id, politica_id, apurado_por)
  VALUES (p_competicao_id, p_politica_id, auth.uid())
  RETURNING id INTO v_ap_id;

  FOR r IN
    SELECT f.id AS funcionario_id, f.user_profile_id, f.filial,
           COALESCE(f.salario, 0) AS salario
      FROM funcionarios f
     WHERE COALESCE(f.ativo, true)
       AND f.user_profile_id IS NOT NULL
       AND f.filial IN ('SuperMax','MaxLook','TechMax')
       AND NOT COALESCE(_funcionario_desligado(f.id), false)
  LOOP
    v_motivo := NULL;

    v_nota := COALESCE((v_placar #>> ARRAY['por_filial', r.filial, 'media'])::numeric, 0);

    -- Atingimento: tarefas táticas concluídas dentro do período.
    -- 'Aprovada', não 'Concluida': tarefa que a pessoa marcou como feita e
    -- ninguém conferiu não paga bônus. (Os valores válidos da coluna são
    -- Pendente / Concluida / Aprovada / Rejeitada — sem acento e sem
    -- 'Concluído', que é o vocabulário da tabela `tarefas`.)
    SELECT count(*), count(*) FILTER (WHERE t.status = 'Aprovada'
                                        AND t.concluida_em::date
                                            BETWEEN v_comp.data_inicio AND v_comp.data_fim)
      INTO v_tot, v_ok
      FROM tarefas_taticas t
     WHERE t.colaborador_id = r.user_profile_id
       AND COALESCE(t.ativo, true);

    v_ating := CASE WHEN COALESCE(v_tot, 0) = 0 THEN 0
                    ELSE round(v_ok::numeric * 100 / v_tot, 2) END;

    IF v_nota < v_pol.nota_minima THEN
      -- Gatilho coletivo: bônus é da unidade, não da pessoa.
      v_fator  := 0;
      v_motivo := format('Placar da filial (%s) abaixo do gatilho de %s.', v_nota, v_pol.nota_minima);
    ELSE
      v_fator := (v_pol.peso_placar * v_nota + v_pol.peso_metas * v_ating) / 10000;
    END IF;

    v_valor := round(r.salario * v_pol.percentual_salario / 100 * v_fator, 2);

    IF v_valor = 0 AND v_motivo IS NULL THEN
      v_motivo := CASE
                    WHEN r.salario = 0 THEN 'Funcionário sem salário cadastrado.'
                    WHEN COALESCE(v_tot,0) = 0 AND v_pol.peso_placar = 0 THEN 'Sem tarefas táticas no período.'
                    ELSE 'Fator resultante zero.'
                  END;
    END IF;

    INSERT INTO apuracao_bonus_itens
      (apuracao_id, colaborador_id, funcionario_id, filial,
       salario_base, nota_placar, atingimento, fator, valor_bonus, motivo_zero)
    VALUES
      (v_ap_id, r.user_profile_id, r.funcionario_id, r.filial,
       r.salario, v_nota, v_ating, v_fator, v_valor, v_motivo);

    v_total := v_total + v_valor;
  END LOOP;

  UPDATE apuracoes_bonus SET total = v_total WHERE id = v_ap_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'apuracao_id', v_ap_id, 'total', v_total,
    'pessoas', (SELECT count(*) FROM apuracao_bonus_itens WHERE apuracao_id = v_ap_id));
END;
$$;

REVOKE ALL ON FUNCTION public.apurar_bonus(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apurar_bonus(uuid,uuid) TO authenticated;

-- ── 5. Pagar (credita a carteira de bonificações) ─────────────────
CREATE OR REPLACE FUNCTION public.pagar_bonus(p_apuracao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ap       apuracoes_bonus;
  v_conta_id uuid;
  v_creditos int := 0;
  r          record;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho manda pagar.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ap FROM apuracoes_bonus WHERE id = p_apuracao_id AND ativo = true;
  IF v_ap.id IS NULL THEN
    RAISE EXCEPTION 'Apuração não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_ap.status = 'paga' THEN
    RAISE EXCEPTION 'Esta apuração já foi paga.' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN
    SELECT colaborador_id, valor_bonus
      FROM apuracao_bonus_itens
     WHERE apuracao_id = p_apuracao_id AND valor_bonus > 0
  LOOP
    INSERT INTO maxbank_contas (colaborador_id) VALUES (r.colaborador_id)
    ON CONFLICT (colaborador_id) DO NOTHING;

    SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = r.colaborador_id;

    -- Idempotente pelo índice parcial: repetir não duplica crédito.
    BEGIN
      INSERT INTO maxbank_transacoes
        (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
      VALUES
        (v_conta_id, 'credito', 'bonificacoes', r.valor_bonus,
         'Remuneração variável — competição', 'remuneracao_variavel', p_apuracao_id, auth.uid());

      UPDATE maxbank_contas
         SET saldo_bonificacoes = COALESCE(saldo_bonificacoes, 0) + r.valor_bonus
       WHERE id = v_conta_id;

      v_creditos := v_creditos + 1;
    EXCEPTION
      WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  UPDATE apuracoes_bonus
     SET status = 'paga', pago_por = auth.uid(), pago_em = now()
   WHERE id = p_apuracao_id;

  RETURN jsonb_build_object('sucesso', true, 'creditos', v_creditos, 'total', v_ap.total);
END;
$$;

REVOKE ALL ON FUNCTION public.pagar_bonus(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_bonus(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) anon fora:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname IN ('apurar_bonus','pagar_bonus');
--
-- 2) Fim a fim: cadastrar política (70/30, 10% do salário, gatilho 60),
--    apurar sobre a competição encerrada, conferir os itens e pagar:
-- SELECT filial, nota_placar, atingimento, salario_base, valor_bonus, motivo_zero
--   FROM apuracao_bonus_itens ORDER BY filial, valor_bonus DESC;
-- SELECT colaborador_id, saldo_bonificacoes FROM maxbank_contas
--  WHERE saldo_bonificacoes > 0;
--
-- 3) Pagar duas vezes NÃO pode duplicar (índice uq_maxbank_transacoes_bonus):
-- SELECT origem_id, conta_id, count(*) FROM maxbank_transacoes
--  WHERE origem='remuneracao_variavel' GROUP BY 1,2 HAVING count(*) > 1;
-- Esperado: zero linhas.
