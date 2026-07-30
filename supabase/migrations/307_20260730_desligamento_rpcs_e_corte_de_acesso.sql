-- 307 — Desligamento: quem decide, quem paga, e o que o desligado ainda pode.
--
-- Segunda metade da 306. Aqui entram as quatro RPCs do ciclo e o corte de
-- acesso propriamente dito.
--
-- QUEM DECIDE. Só admin/CEO — a mesma régua da 292 (afastamento) e da 282
-- (segregação de funções). Gerente lança gente, gerente não desliga gente:
-- quem sofre a consequência da avaliação não pode ser quem a executa sozinho.
-- Ninguém desliga a si mesmo, tampouco.
--
-- O DINHEIRO segue o caminho da folha, de propósito: `processar_rescisao`
-- (RH) gera a Conta a Pagar, `pagar_rescisao` (Financeiro) credita a carteira
-- MaxBank e fecha. Duas mãos, como a 282 deixou a folha. O trigger que já
-- avança folha quando a conta é quitada aprende a fazer o mesmo pela rescisão.
--
-- O CORTE DE ACESSO é uma linha em cada uma das quatro funções de RBAC:
-- `AND desligado_em IS NULL`. Depois disso o desligado tem role NULL, filial
-- NULL, setores NULL e is_admin false — e as ~170 policies escopadas por esses
-- três colapsam sozinhas, em leitura e escrita. Não há policy reescrita neste
-- arquivo, e é esse o ponto: uma régua nova em quatro funções vale mais que
-- 170 policies editadas à mão, que é onde a auditoria da 180 achou 45 furos.
--
-- O QUE O DESLIGADO AINDA PODE: entrar, ver o próprio perfil e receber o
-- modal. As policies escopadas por `auth.uid()` continuam de pé porque a tela
-- precisa carregar para conseguir dizer a ele que acabou.
--
-- IDEMPOTENTE. Depende da 306. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. RLS das tabelas novas
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.demissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rescisoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demissoes_select ON public.demissoes;
CREATE POLICY demissoes_select ON public.demissoes FOR SELECT TO authenticated
  USING (public.auth_in_setor('rh') AND public.auth_pode_filial(filial));

-- Escrita só pelas RPCs (SECURITY DEFINER). Sem policy de INSERT/UPDATE/DELETE
-- a tabela fica fechada para PostgREST — que é o objetivo: desligar alguém não
-- pode ser um POST solto do DevTools.
DROP POLICY IF EXISTS rescisoes_select ON public.rescisoes;
CREATE POLICY rescisoes_select ON public.rescisoes FOR SELECT TO authenticated
  USING (
    (public.auth_in_setor('rh', 'financeiro') AND public.auth_pode_filial(filial))
    -- A pessoa vê a própria rescisão. É o extrato dela — e o desligado precisa
    -- conseguir abrir isso, que é metade do sentido de manter o login em pé.
    --
    -- Comparação direta com a coluna snapshot, sem JOIN em `funcionarios`: um
    -- EXISTS ali dependeria da RLS daquela tabela, cuja policy `func_self` usa
    -- `user_profiles.funcionario_id` — o lado furado do vínculo.
    OR user_profile_id = auth.uid()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Corte de acesso — as quatro funções de RBAC
--
-- Uma linha em cada. `auth_is_service_role` continua passando por cima: jobs
-- internos, migrations e o SQL Editor não têm auth.uid() e não são afetados.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role FROM public.user_profiles
   WHERE id = auth.uid() AND desligado_em IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.auth_user_filial()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT filial FROM public.user_profiles
   WHERE id = auth.uid() AND desligado_em IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.auth_user_setores()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    FROM public.user_profiles
   WHERE id = auth.uid() AND desligado_em IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth_user_role() IN ('admin', 'ceo', 'conselheiro')
      OR EXISTS (
        SELECT 1 FROM public.user_profiles
         WHERE id = auth.uid()
           AND role = 'gerente'
           AND is_conselheiro = true
           AND desligado_em IS NULL
      );
$function$;

-- Conveniência para a UI perguntar o próprio estado sem depender de policy.
CREATE OR REPLACE FUNCTION public.auth_desligado()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id = auth.uid() AND desligado_em IS NOT NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.auth_desligado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_desligado() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Desligar
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.demitir_funcionario(
  p_funcionario_id  uuid,
  p_tipo            text,
  p_motivo          text,
  p_data            date DEFAULT NULL,
  p_aviso_previo    text DEFAULT 'Indenizado',
  p_observacao      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_nome        text;
  v_filial      text;
  v_profile_id  uuid;
  v_data        date;
  v_calc        jsonb;
  v_demissao_id uuid;
  v_rescisao_id uuid;
  v_quem        text;
BEGIN
  PERFORM public._assert_rpc();

  -- auth_is_admin() não serve: inclui conselheiro. Desligar é admin ou CEO.
  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO podem desligar um colaborador.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Escreva o motivo do desligamento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome, COALESCE(filial, 'Matriz'), user_profile_id
    INTO v_nome, v_filial, v_profile_id
    FROM public.funcionarios
   WHERE id = p_funcionario_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Desligar a si mesmo derrubaria o próprio acesso no mesmo commit.
  IF v_profile_id IS NOT NULL AND v_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode desligar a si mesmo.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes
              WHERE funcionario_id = p_funcionario_id AND ativo) THEN
    RAISE EXCEPTION '% já está desligado. Readmita antes de registrar novo desligamento.', v_nome
      USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');

  -- Calcula ANTES de marcar o funcionário: a RPC lê salário e admissão da
  -- linha viva, e é ela que valida tipo, datas e salário zerado.
  v_calc := public.calcular_rescisao(p_funcionario_id, p_tipo, v_data, p_aviso_previo);

  INSERT INTO public.demissoes
    (funcionario_id, nome_funcionario, filial, tipo, motivo, data_desligamento,
     aviso_previo, observacao, decidido_por, decidido_por_nome)
  VALUES
    (p_funcionario_id, v_nome, v_filial, p_tipo, btrim(p_motivo), v_data,
     p_aviso_previo, p_observacao, auth.uid(), v_quem)
  RETURNING id INTO v_demissao_id;

  INSERT INTO public.rescisoes (
    demissao_id, funcionario_id, user_profile_id, filial,
    salario_base, data_admissao, data_desligamento, meses_trabalhados, dias_aviso,
    saldo_salario, aviso_previo_valor, decimo_terceiro,
    ferias_vencidas, ferias_proporcionais, terco_ferias,
    multa_fgts, fgts_depositado,
    desconto_inss, desconto_irrf, desconto_aviso,
    total_bruto, total_descontos, total_liquido
  )
  VALUES (
    v_demissao_id, p_funcionario_id, v_profile_id, v_filial,
    (v_calc->>'salario_base')::numeric,
    (v_calc->>'data_admissao')::date,
    (v_calc->>'data_desligamento')::date,
    (v_calc->>'meses_trabalhados')::int,
    (v_calc->>'dias_aviso')::int,
    (v_calc->>'saldo_salario')::numeric,
    (v_calc->>'aviso_previo_valor')::numeric,
    (v_calc->>'decimo_terceiro')::numeric,
    (v_calc->>'ferias_vencidas')::numeric,
    (v_calc->>'ferias_proporcionais')::numeric,
    (v_calc->>'terco_ferias')::numeric,
    (v_calc->>'multa_fgts')::numeric,
    (v_calc->>'fgts_depositado')::numeric,
    (v_calc->>'desconto_inss')::numeric,
    (v_calc->>'desconto_irrf')::numeric,
    (v_calc->>'desconto_aviso')::numeric,
    (v_calc->>'total_bruto')::numeric,
    (v_calc->>'total_descontos')::numeric,
    (v_calc->>'total_liquido')::numeric
  )
  RETURNING id INTO v_rescisao_id;

  UPDATE public.funcionarios
     SET status = 'Desligado', updated_at = now()
   WHERE id = p_funcionario_id;

  -- O corte de acesso. Sem user_profile o desligamento vale só no RH — é o
  -- caso do funcionário que nunca teve login.
  IF v_profile_id IS NOT NULL THEN
    UPDATE public.user_profiles
       SET desligado_em = now()
     WHERE id = v_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'demissao_id', v_demissao_id,
    'rescisao_id', v_rescisao_id,
    'funcionario', v_nome,
    'acesso_cortado', v_profile_id IS NOT NULL,
    'rescisao', v_calc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.demitir_funcionario(uuid, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demitir_funcionario(uuid, text, text, date, text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Readmitir
--
-- Existe porque um clique errado não pode ser definitivo. Devolve o acesso e
-- inativa a rescisão — mas NÃO estorna dinheiro já creditado: para isso o
-- caminho é o estorno do MaxBank, como na folha.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.readmitir_funcionario(
  p_funcionario_id uuid,
  p_motivo         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role       text;
  v_nome       text;
  v_profile_id uuid;
  v_demissao   record;
  v_paga       boolean;
BEGIN
  PERFORM public._assert_rpc();

  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO podem readmitir.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, user_profile_id INTO v_nome, v_profile_id
    FROM public.funcionarios WHERE id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_demissao
    FROM public.demissoes
   WHERE funcionario_id = p_funcionario_id AND ativo
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '% não está desligado.', v_nome USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rescisoes
     WHERE demissao_id = v_demissao.id AND ativo AND status = 'Paga'
  ) INTO v_paga;

  UPDATE public.demissoes
     SET ativo = false,
         observacao = COALESCE(observacao || ' · ', '')
                      || 'Readmitido em '
                      || to_char((now() AT TIME ZONE 'America/Rio_Branco')::date, 'DD/MM/YYYY')
                      || COALESCE(': ' || btrim(p_motivo), ''),
         updated_at = now()
   WHERE id = v_demissao.id;

  UPDATE public.rescisoes
     SET ativo = false, updated_at = now()
   WHERE demissao_id = v_demissao.id AND ativo;

  UPDATE public.funcionarios
     SET status = 'Ativo', updated_at = now()
   WHERE id = p_funcionario_id;

  IF v_profile_id IS NOT NULL THEN
    UPDATE public.user_profiles SET desligado_em = NULL WHERE id = v_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'funcionario', v_nome,
    'acesso_devolvido', v_profile_id IS NOT NULL,
    -- Avisa em vez de bloquear: quem readmite precisa saber que há dinheiro
    -- creditado a resolver, mas travar a readmissão por causa disso seria pior.
    'rescisao_ja_paga', v_paga
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.readmitir_funcionario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.readmitir_funcionario(uuid, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Processar — RH gera a despesa
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.processar_rescisao(p_rescisao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r          record;
  v_nome       text;
  v_conta_id   uuid;
BEGIN
  PERFORM public._assert_rpc('rh');

  SELECT * INTO v_r FROM public.rescisoes
   WHERE id = p_rescisao_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rescisão não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_pode_filial(v_r.filial) THEN
    RAISE EXCEPTION 'Rescisão de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF v_r.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Só uma rescisão Pendente pode ser processada (esta está %).', v_r.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_r.total_liquido <= 0 THEN
    RAISE EXCEPTION 'Rescisão com líquido zerado não gera despesa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.funcionarios WHERE id = v_r.funcionario_id;

  SELECT id INTO v_conta_id FROM public.contas_pagar
   WHERE rescisao_id = p_rescisao_id AND COALESCE(ativo, true);

  IF v_conta_id IS NULL THEN
    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, rescisao_id)
    VALUES (
      'Rescisão — ' || COALESCE(v_nome, 'Funcionário')
        || ' (' || to_char(v_r.data_desligamento, 'DD/MM/YYYY') || ')',
      v_r.total_liquido,
      -- Prazo legal: 10 dias corridos do desligamento.
      v_r.data_desligamento + 10,
      'Pendente',
      v_r.filial,
      p_rescisao_id
    )
    RETURNING id INTO v_conta_id;
  END IF;

  UPDATE public.rescisoes
     SET status = 'Processada', conta_pagar_id = v_conta_id, updated_at = now()
   WHERE id = p_rescisao_id;

  RETURN jsonb_build_object(
    'ok', true, 'status', 'Processada',
    'conta_pagar_id', v_conta_id, 'valor', v_r.total_liquido, 'filial', v_r.filial
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.processar_rescisao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.processar_rescisao(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Creditar e pagar
--
-- Mesma ordem da 269: credita PRIMEIRO, avança depois. Folha 'Paga' com
-- funcionário sem receber foi o defeito que aquela migração corrigiu, e não
-- vale a pena repeti-lo aqui.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.creditar_rescisao_maxbank(p_rescisao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r          record;
  v_profile_id uuid;
  v_conta_id   uuid;
  v_tx_id      uuid;
BEGIN
  SELECT * INTO v_r FROM public.rescisoes
   WHERE id = p_rescisao_id AND COALESCE(ativo, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rescisão não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_r.total_liquido <= 0 THEN
    RAISE EXCEPTION 'Líquido inválido para crédito: %.', v_r.total_liquido;
  END IF;

  SELECT user_profile_id INTO v_profile_id
    FROM public.funcionarios WHERE id = v_r.funcionario_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Funcionário sem conta de colaborador — não há carteira para creditar.';
  END IF;

  INSERT INTO public.maxbank_contas (colaborador_id)
  VALUES (v_profile_id) ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_conta_id FROM public.maxbank_contas WHERE colaborador_id = v_profile_id;

  -- Idempotente pelo UNIQUE parcial criado abaixo.
  BEGIN
    INSERT INTO public.maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'credito', 'salario', v_r.total_liquido,
       'Rescisão — verbas rescisórias líquidas', 'rescisao', p_rescisao_id, auth.uid())
    RETURNING id INTO v_tx_id;

    UPDATE public.maxbank_contas
       SET saldo_salario = saldo_salario + v_r.total_liquido
     WHERE id = v_conta_id;
  EXCEPTION WHEN unique_violation THEN
    v_tx_id := NULL;
  END;

  RETURN jsonb_build_object('transacao_id', v_tx_id, 'valor', v_r.total_liquido);
END;
$function$;

-- Função que credita dinheiro NÃO pode nascer com o EXECUTE default do
-- PostgreSQL, que é PUBLIC — foi exatamente o buraco que a 260 varreu. Só
-- `pagar_rescisao` e o trigger (ambos SECURITY DEFINER) a alcançam.
REVOKE ALL ON FUNCTION public.creditar_rescisao_maxbank(uuid) FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_rescisao
  ON public.maxbank_transacoes (origem_id, carteira) WHERE origem = 'rescisao';

CREATE OR REPLACE FUNCTION public.pagar_rescisao(p_rescisao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial  text;
  v_status  text;
  v_credito jsonb;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  SELECT filial, status INTO v_filial, v_status
    FROM public.rescisoes WHERE id = p_rescisao_id AND COALESCE(ativo, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rescisão não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Rescisão de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'Pendente' THEN
    RAISE EXCEPTION 'Processe a rescisão antes de pagar.' USING ERRCODE = 'P0001';
  END IF;

  v_credito := public.creditar_rescisao_maxbank(p_rescisao_id);

  UPDATE public.rescisoes
     SET status = 'Paga', updated_at = now()
   WHERE id = p_rescisao_id AND status = 'Processada';

  RETURN COALESCE(v_credito, '{}'::jsonb) || jsonb_build_object('ok', true, 'status', 'Paga');
END;
$function$;

REVOKE ALL ON FUNCTION public.pagar_rescisao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_rescisao(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Quitar a conta no Financeiro também fecha a rescisão
--
-- O trigger da 269 já fazia isso para a folha. Aqui ele aprende o outro
-- vínculo, para o Financeiro não precisar lembrar de uma segunda tela.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conta_pagar_avancar_rescisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rescisao_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.creditar_rescisao_maxbank(NEW.rescisao_id);

    UPDATE public.rescisoes
       SET status = 'Paga', updated_at = now()
     WHERE id = NEW.rescisao_id AND status = 'Processada';
  EXCEPTION WHEN OTHERS THEN
    -- Não derruba a quitação da conta: o Financeiro pagou de verdade. A
    -- rescisão fica em 'Processada', que é a verdade enquanto o crédito não
    -- passou, e o aviso vai para o RH resolver.
    RAISE WARNING 'Crédito de rescisão % falhou: %', NEW.rescisao_id, SQLERRM;

    BEGIN
      PERFORM public.notificar_setor(
        'rh', 'alerta', 'Rescisão sem crédito no MaxBank',
        'A conta foi quitada, mas o crédito da rescisão falhou: ' || SQLERRM,
        'rh-desligamento', 'Alta', NEW.rescisao_id, SQLERRM, NEW.filial
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notificar_setor falhou para rescisão %: %', NEW.rescisao_id, SQLERRM;
    END;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_contas_pagar_avancar_rescisao ON public.contas_pagar;
CREATE TRIGGER trg_contas_pagar_avancar_rescisao
  AFTER UPDATE OF status ON public.contas_pagar
  FOR EACH ROW
  WHEN (NEW.status = 'Pago' AND OLD.status <> 'Pago')
  EXECUTE FUNCTION public.conta_pagar_avancar_rescisao();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- 1. Preview do cálculo, sem gravar nada:
--   SELECT jsonb_pretty(calcular_rescisao('<func_id>', 'Sem justa causa'));
--
--   -- 2. Os 4 tipos lado a lado (é a aula inteira numa consulta):
--   SELECT t AS tipo,
--          (calcular_rescisao('<func_id>', t)->>'total_liquido')::numeric AS liquido
--     FROM unnest(ARRAY['Sem justa causa','Acordo','Pedido de demissão','Com justa causa']) t;
--
--   -- 3. Depois de desligar alguém, conferir que o acesso caiu:
--   SELECT id, nome, desligado_em FROM user_profiles WHERE desligado_em IS NOT NULL;
--
--   -- 4. Nenhum perfil ativo pode ter sido afetado por engano:
--   SELECT count(*) FROM user_profiles WHERE desligado_em IS NOT NULL;
--   -- Deve ser exatamente o número de desligamentos ativos com login:
--   SELECT count(*) FROM demissoes d
--     JOIN funcionarios f ON f.id = d.funcionario_id
--    WHERE d.ativo AND f.user_profile_id IS NOT NULL;
-- ────────────────────────────────────────────────────────────────────────────
