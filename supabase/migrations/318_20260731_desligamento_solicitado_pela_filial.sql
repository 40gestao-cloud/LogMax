-- 318 — Desligamento: a filial instrui, a Matriz decide.
--
-- A 307 deixou desligar como ato exclusivo de admin/CEO. A régua de
-- segregação estava certa (quem avalia não executa sozinho), mas o efeito
-- didático foi o oposto do pretendido: o aluno de RH da filial nunca monta um
-- desligamento, nunca escolhe o tipo, nunca lê o demonstrativo. Ele só assiste.
--
-- Aqui o ato vira processo, que é como acontece de verdade: a filial abre a
-- SOLICITAÇÃO — escolhe colaborador, tipo, data, aviso e motivo, e vê o
-- cálculo — e a Matriz APROVA ou RECUSA. Só a aprovação efetiva: antes dela
-- ninguém é marcado Desligado, nenhuma rescisão é gravada e nenhum acesso é
-- cortado. A segregação continua de pé; o que muda é que agora existem duas
-- mãos em vez de uma só.
--
-- admin/CEO seguem podendo desligar direto (`demitir_funcionario`), sem passar
-- pela própria fila.
--
-- IDEMPOTENTE. Depende da 306/307. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Estado do pedido
--
-- DEFAULT 'Aprovado' de propósito: toda linha que já existe nasceu de
-- admin/CEO pela 307, ou seja, já estava decidida. Sem o default, o histórico
-- inteiro apareceria como pendente de aprovação na primeira carga da tela.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.demissoes
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'Aprovado',
  ADD COLUMN IF NOT EXISTS solicitado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS solicitado_por_nome text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demissoes_status_chk'
  ) THEN
    ALTER TABLE public.demissoes
      ADD CONSTRAINT demissoes_status_chk
      CHECK (status IN ('Solicitado', 'Aprovado', 'Recusado'));
  END IF;
END $$;

-- Fila da Matriz: uma solicitação pendente por filial é o acesso mais comum.
CREATE INDEX IF NOT EXISTS idx_demissoes_status_filial
  ON public.demissoes (status, filial) WHERE ativo;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Leitura: gerente da filial entra no escopo
--
-- A 307 abriu `demissoes` só para setor RH. O gerente da filial precisa
-- enxergar o que a própria unidade pediu — senão solicita e não vê o
-- resultado. `auth_pode_filial` continua confinando a unidade.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS demissoes_select ON public.demissoes;
CREATE POLICY demissoes_select ON public.demissoes FOR SELECT TO authenticated
  USING (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  );

DROP POLICY IF EXISTS rescisoes_select ON public.rescisoes;
CREATE POLICY rescisoes_select ON public.rescisoes FOR SELECT TO authenticated
  USING (
    (
      (public.auth_in_setor('rh', 'financeiro') OR public.auth_gerente_da(filial))
      AND public.auth_pode_filial(filial)
    )
    OR user_profile_id = auth.uid()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Solicitar (filial)
--
-- Grava intenção, não fato: nenhum efeito colateral fora da linha em
-- `demissoes`. O cálculo é chamado só para validar (salário zerado, admissão
-- posterior à data, tipo inválido) — o valor definitivo é congelado na
-- aprovação, com as regras vigentes naquele momento.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.solicitar_desligamento(
  p_funcionario_id uuid,
  p_tipo           text,
  p_motivo         text,
  p_data           date DEFAULT NULL,
  p_aviso_previo   text DEFAULT 'Indenizado',
  p_observacao     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome       text;
  v_filial     text;
  v_profile_id uuid;
  v_data       date;
  v_quem       text;
  v_id         uuid;
BEGIN
  PERFORM public._assert_rpc();

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

  -- Quem pode instruir: RH ou gerente, sempre da mesma filial do colaborador.
  -- admin/CEO passam porque `auth_in_setor` já os deixa passar — usar a fila
  -- em vez do desligamento direto é escolha deles.
  IF NOT public.auth_is_service_role()
     AND NOT (
       (public.auth_in_setor('rh') OR public.auth_gerente_da(v_filial))
       AND public.auth_pode_filial(v_filial)
     ) THEN
    RAISE EXCEPTION 'Só o RH ou a gerência desta unidade podem solicitar o desligamento.'
      USING ERRCODE = '42501';
  END IF;

  IF v_profile_id IS NOT NULL AND v_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode solicitar o próprio desligamento.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes
              WHERE funcionario_id = p_funcionario_id AND ativo) THEN
    RAISE EXCEPTION 'Já existe desligamento em aberto para %.', v_nome USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), v_filial);

  -- Só valida. Descarta o resultado de propósito (ver cabeçalho da seção).
  PERFORM public.calcular_rescisao(p_funcionario_id, p_tipo, v_data, p_aviso_previo);

  INSERT INTO public.demissoes
    (funcionario_id, nome_funcionario, filial, tipo, motivo, data_desligamento,
     aviso_previo, observacao, status, solicitado_por, solicitado_por_nome)
  VALUES
    (p_funcionario_id, v_nome, v_filial, p_tipo, btrim(p_motivo), v_data,
     p_aviso_previo, p_observacao, 'Solicitado', auth.uid(), v_quem)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'demissao_id', v_id,
    'funcionario', v_nome,
    'filial', v_filial,
    'status', 'Solicitado'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.solicitar_desligamento(uuid, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_desligamento(uuid, text, text, date, text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Decidir (Matriz)
--
-- Aprovar faz aqui exatamente o que `demitir_funcionario` faz: congela o
-- cálculo, grava a rescisão, marca o funcionário e corta o acesso. Recusar
-- encerra a linha sem tocar em nada — o colaborador nunca soube.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.decidir_desligamento(
  p_demissao_id uuid,
  p_aprovar     boolean,
  p_observacao  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_quem        text;
  v_d           record;
  v_profile_id  uuid;
  v_calc        jsonb;
  v_rescisao_id uuid;
BEGIN
  PERFORM public._assert_rpc();

  v_role := public.auth_user_role();
  IF NOT public.auth_is_service_role() AND COALESCE(v_role, '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Só admin ou CEO decidem um desligamento.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_d FROM public.demissoes
   WHERE id = p_demissao_id AND ativo
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_d.status <> 'Solicitado' THEN
    RAISE EXCEPTION 'Esta solicitação já foi decidida (%).', v_d.status USING ERRCODE = 'P0001';
  END IF;

  v_quem := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Matriz');

  -- ── Recusa ──────────────────────────────────────────────────────────────
  IF NOT COALESCE(p_aprovar, false) THEN
    UPDATE public.demissoes
       SET status = 'Recusado',
           ativo  = false,
           decidido_por = auth.uid(),
           decidido_por_nome = v_quem,
           observacao = COALESCE(observacao || ' · ', '')
                        || 'Recusado pela Matriz em '
                        || to_char((now() AT TIME ZONE 'America/Rio_Branco')::date, 'DD/MM/YYYY')
                        || COALESCE(': ' || btrim(p_observacao), ''),
           updated_at = now()
     WHERE id = p_demissao_id;

    RETURN jsonb_build_object('ok', true, 'status', 'Recusado', 'funcionario', v_d.nome_funcionario);
  END IF;

  -- ── Aprovação ───────────────────────────────────────────────────────────
  SELECT user_profile_id INTO v_profile_id
    FROM public.funcionarios WHERE id = v_d.funcionario_id FOR UPDATE;

  IF v_profile_id IS NOT NULL AND v_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode aprovar o próprio desligamento.' USING ERRCODE = 'P0001';
  END IF;

  -- Recalcula na aprovação: entre a solicitação e agora o salário pode ter
  -- mudado, e o valor que vale é o do momento da decisão.
  v_calc := public.calcular_rescisao(
    v_d.funcionario_id, v_d.tipo, v_d.data_desligamento, v_d.aviso_previo);

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
    v_d.id, v_d.funcionario_id, v_profile_id, v_d.filial,
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

  UPDATE public.demissoes
     SET status = 'Aprovado',
         decidido_por = auth.uid(),
         decidido_por_nome = v_quem,
         observacao = CASE
           WHEN COALESCE(btrim(p_observacao), '') = '' THEN observacao
           ELSE COALESCE(observacao || ' · ', '') || btrim(p_observacao)
         END,
         updated_at = now()
   WHERE id = p_demissao_id;

  UPDATE public.funcionarios
     SET status = 'Desligado', updated_at = now()
   WHERE id = v_d.funcionario_id;

  IF v_profile_id IS NOT NULL THEN
    UPDATE public.user_profiles SET desligado_em = now() WHERE id = v_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'Aprovado',
    'funcionario', v_d.nome_funcionario,
    'rescisao_id', v_rescisao_id,
    'acesso_cortado', v_profile_id IS NOT NULL,
    'rescisao', v_calc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.decidir_desligamento(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_desligamento(uuid, boolean, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Readmitir só readmite quem foi de fato desligado
--
-- Sem este guard, readmitir uma linha 'Solicitado' devolveria acesso que
-- nunca foi cortado e sumiria com a solicitação pela porta errada — recusar
-- é o caminho para isso.
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
   WHERE funcionario_id = p_funcionario_id AND ativo AND status = 'Aprovado'
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
    'rescisao_paga', v_paga
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.readmitir_funcionario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.readmitir_funcionario(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação
--
--   -- Histórico veio todo como Aprovado (nenhuma linha antiga vira fila):
--   SELECT status, count(*) FROM demissoes GROUP BY status;
--
--   -- As duas RPCs novas existem com a assinatura esperada:
--   SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname IN ('solicitar_desligamento', 'decidir_desligamento');
--
--   -- anon não executa nenhuma delas (false, false):
--   SELECT has_function_privilege('anon', 'public.solicitar_desligamento(uuid,text,text,date,text,text)', 'EXECUTE'),
--          has_function_privilege('anon', 'public.decidir_desligamento(uuid,boolean,text)', 'EXECUTE');
-- ────────────────────────────────────────────────────────────────────────────
