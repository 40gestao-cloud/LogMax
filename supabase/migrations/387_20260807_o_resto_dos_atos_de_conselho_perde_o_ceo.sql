-- =================================================================
-- 387 — O resto dos atos de Conselho perde o CEO.
--
-- A 386 separou os papéis nos três atos do ciclo orçamento → prestação
-- de contas. Sobraram cinco atos que continuavam em `auth_is_admin()`,
-- e o efeito prático era o mesmo buraco: o CEO podia nomear a si mesmo
-- gerente, mandar pagar o próprio bônus, deliberar a destinação do
-- lucro e abrir/encerrar a auditoria que fiscaliza os atos dele.
--
-- Passam a exigir `auth_is_conselho()` (admin, conselheiro puro e
-- gerente-conselheiro — sem CEO):
--   • abrir_revisao_auditoria / encerrar_revisao_auditoria   (#G5)
--   • deliberar_destinacao_resultado                          (#G4)
--   • apurar_bonus / pagar_bonus                              (#G2)
--   • nomear_mandato / encerrar_mandato                       (#G6)
--
-- FICA COMO ESTÁ, de propósito: `responder_revisao_auditoria`. Responder
-- ao questionamento é obrigação do fiscalizado, e o CEO é justamente
-- quem mais tem de responder. Fechar essa porta inverteria a regra.
--
-- Guard novo em `nomear_mandato`: ninguém se nomeia. Vale inclusive para
-- conselheiro — é o mesmo conflito de interesse que a 386 escreveu para
-- orçamento e prestação de contas.
--
-- Bodies copiados do banco; muda só a linha do guard (e, no mandato, o
-- bloco de autonomeação).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Comitê de Auditoria (#G5) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_revisao_auditoria(
  p_operacao_id     uuid,
  p_questionamento  text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_op historico_operacoes;
  v_id uuid;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Comitê de Auditoria abre questionamento.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_questionamento), '') = '' THEN
    RAISE EXCEPTION 'Escreva o questionamento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_op FROM historico_operacoes WHERE id = p_operacao_id;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operação não encontrada na trilha.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM auditoria_revisoes
              WHERE operacao_id = p_operacao_id AND status <> 'encerrada') THEN
    RAISE EXCEPTION 'Já existe uma revisão aberta para esta operação.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO auditoria_revisoes (operacao_id, filial, questionamento, aberta_por)
  VALUES (p_operacao_id, v_op.filial, p_questionamento, auth.uid())
  RETURNING id INTO v_id;

  -- Vai para o setor de quem praticou o ato: é quem sabe explicar.
  -- `ator_setor` pode ser NULL em linha antiga; cai em 'empresa', que todo
  -- mundo enxerga, em vez de a notificação sumir.
  PERFORM notificar_setor(
    p_setor     => COALESCE(NULLIF(v_op.ator_setor, ''), 'empresa'),
    p_tipo      => 'aprovacao_pendente',
    p_titulo    => 'Auditoria questionou uma operação',
    p_mensagem  => format('%s em %s: %s', v_op.evento, v_op.entidade, p_questionamento),
    -- Rota top-level, irmã de 'auditoria': o comitê não é submenu de
    -- Financeiro — fiscaliza a operação inteira, não só o dinheiro.
    p_link_view => 'comite-auditoria',
    p_ref_id    => v_id,
    p_filial    => v_op.filial);

  RETURN jsonb_build_object('sucesso', true, 'revisao_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.abrir_revisao_auditoria(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_revisao_auditoria(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.encerrar_revisao_auditoria(
  p_revisao_id uuid,
  p_conclusao  text,
  p_parecer    text DEFAULT NULL::text,
  p_prazo_acao date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_r       auditoria_revisoes;
  v_op      historico_operacoes;
  v_tarefas int := 0;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Comitê de Auditoria encerra a revisão.' USING ERRCODE = '42501';
  END IF;

  IF p_conclusao NOT IN ('conforme','nao_conforme') THEN
    RAISE EXCEPTION 'Conclusão inválida: %.', p_conclusao USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_r FROM auditoria_revisoes WHERE id = p_revisao_id;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Revisão não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_r.status = 'encerrada' THEN
    RAISE EXCEPTION 'Revisão já encerrada.' USING ERRCODE = 'P0001';
  END IF;

  -- Não conformidade sem prazo é laudo sem efeito.
  IF p_conclusao = 'nao_conforme' AND p_prazo_acao IS NULL THEN
    RAISE EXCEPTION 'Não conformidade exige prazo de correção.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_op FROM historico_operacoes WHERE id = v_r.operacao_id;

  IF p_conclusao = 'nao_conforme' THEN
    INSERT INTO tarefas (modulo, titulo, descricao, prioridade, prazo, filial, origem, criado_por, nome_criador)
    VALUES ('governanca',
            format('Não conformidade — %s em %s', COALESCE(v_op.evento,'operação'), COALESCE(v_op.entidade,'—')),
            COALESCE(p_parecer, v_r.questionamento),
            'Alta',
            p_prazo_acao,
            COALESCE(v_r.filial, 'Matriz'),
            'auditoria',
            auth.uid(),
            'Comitê de Auditoria');
    v_tarefas := 1;
  END IF;

  UPDATE auditoria_revisoes
     SET conclusao = p_conclusao, parecer = p_parecer,
         encerrada_por = auth.uid(), encerrada_em = now(), status = 'encerrada'
   WHERE id = p_revisao_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'conclusao', p_conclusao, 'tarefas_geradas', v_tarefas);
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_revisao_auditoria(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_revisao_auditoria(uuid,text,text,date) TO authenticated;

-- ── 2. Destinação do resultado (#G4) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.deliberar_destinacao_resultado(
  p_filial            text,
  p_inicio            date,
  p_fim               date,
  p_valor_reserva     numeric,
  p_valor_reinvestido numeric,
  p_valor_distribuido numeric,
  p_banco_origem_id   uuid DEFAULT NULL::uuid,
  p_banco_destino_id  uuid DEFAULT NULL::uuid,
  p_justificativa     text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_lucro     numeric;
  v_soma      numeric;
  v_pct_min   numeric;
  v_reserva_min numeric;
  v_saldo     numeric;
  v_orig_fil  text;
  v_orig_nome text;
  v_dest_fil  text;
  v_id        uuid;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Conselho delibera a destinação do resultado.' USING ERRCODE = '42501';
  END IF;

  SELECT lucro INTO v_lucro FROM apurar_resultado_periodo(p_filial, p_inicio, p_fim);

  IF v_lucro <= 0 THEN
    RAISE EXCEPTION 'Resultado do período é R$ % — não há lucro a destinar.', round(v_lucro, 2)
      USING ERRCODE = 'P0001';
  END IF;

  v_soma := COALESCE(p_valor_reserva,0) + COALESCE(p_valor_reinvestido,0) + COALESCE(p_valor_distribuido,0);
  IF abs(v_soma - v_lucro) > 0.01 THEN
    RAISE EXCEPTION 'A destinação soma R$ % e o lucro apurado é R$ % — todo o resultado precisa ter destino.',
      round(v_soma, 2), round(v_lucro, 2) USING ERRCODE = 'P0001';
  END IF;

  -- Piso de reserva: `capital_config.reserva_min_pct` existia desde a 326 e
  -- nunca tinha sido cobrada em lugar nenhum.
  SELECT reserva_min_pct INTO v_pct_min
    FROM capital_config
   WHERE data_inicio <= p_fim AND (data_fim IS NULL OR data_fim >= p_fim)
   ORDER BY data_inicio DESC LIMIT 1;

  v_reserva_min := round(v_lucro * COALESCE(v_pct_min, 0) / 100, 2);
  IF COALESCE(p_valor_reserva, 0) < v_reserva_min - 0.01 THEN
    RAISE EXCEPTION 'Reserva mínima é % %% do lucro (R$ %), e foi destinado R$ %.',
      COALESCE(v_pct_min,0), v_reserva_min, round(COALESCE(p_valor_reserva,0), 2)
      USING ERRCODE = 'P0001';
  END IF;

  -- Só a distribuição move dinheiro. Reserva e reinvestimento ficam no
  -- caixa da unidade — são classificação da decisão, não transferência.
  IF COALESCE(p_valor_distribuido, 0) > 0 THEN
    IF p_banco_origem_id IS NULL OR p_banco_destino_id IS NULL THEN
      RAISE EXCEPTION 'Distribuir exige conta de origem (filial) e destino (Matriz).'
        USING ERRCODE = 'P0001';
    END IF;

    -- `caixa_bancos` não tem coluna `nome`: o rótulo é COALESCE(banco, conta),
    -- mesma expressão que a 326 usa. FOR UPDATE pelo mesmo motivo de lá —
    -- duas distribuições simultâneas leriam o mesmo saldo.
    SELECT filial, COALESCE(banco, conta), COALESCE(saldo, 0)
      INTO v_orig_fil, v_orig_nome, v_saldo
      FROM caixa_bancos
     WHERE id = p_banco_origem_id AND COALESCE(ativo, true)
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_orig_fil, '') <> p_filial THEN
      RAISE EXCEPTION 'A origem tem de ser conta de %. A escolhida é de %.',
        p_filial, COALESCE(v_orig_fil, 'uso global') USING ERRCODE = 'P0001';
    END IF;
    IF v_saldo < p_valor_distribuido THEN
      RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e a distribuição é de R$ %.',
        v_orig_nome, round(v_saldo, 2), round(p_valor_distribuido, 2) USING ERRCODE = 'P0001';
    END IF;

    SELECT filial INTO v_dest_fil
      FROM caixa_bancos
     WHERE id = p_banco_destino_id AND COALESCE(ativo, true)
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_dest_fil, '') <> 'Matriz' THEN
      RAISE EXCEPTION 'A distribuição vai para o caixa da Matriz. A conta escolhida é de %.',
        COALESCE(v_dest_fil, 'uso global') USING ERRCODE = 'P0001';
    END IF;

    UPDATE caixa_bancos SET saldo = COALESCE(saldo,0) - p_valor_distribuido
     WHERE id = p_banco_origem_id;
    UPDATE caixa_bancos SET saldo = COALESCE(saldo,0) + p_valor_distribuido
     WHERE id = p_banco_destino_id;
  END IF;

  INSERT INTO destinacoes_resultado
    (filial, periodo_inicio, periodo_fim, lucro_apurado,
     valor_reserva, valor_reinvestido, valor_distribuido,
     banco_origem_id, banco_destino_id, justificativa,
     deliberado_por, deliberado_por_nome)
  VALUES
    (p_filial, p_inicio, p_fim, v_lucro,
     COALESCE(p_valor_reserva,0), COALESCE(p_valor_reinvestido,0), COALESCE(p_valor_distribuido,0),
     p_banco_origem_id, p_banco_destino_id, p_justificativa,
     auth.uid(), (SELECT nome FROM user_profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'destinacao_id', v_id,
    'lucro', v_lucro, 'distribuido', COALESCE(p_valor_distribuido,0));
END;
$$;

REVOKE ALL ON FUNCTION public.deliberar_destinacao_resultado(text,date,date,numeric,numeric,numeric,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliberar_destinacao_resultado(text,date,date,numeric,numeric,numeric,uuid,uuid,text) TO authenticated;

-- ── 3. Remuneração variável (#G2) ─────────────────────────────────
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
  IF NOT COALESCE(auth_is_conselho(), false) THEN
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
  IF NOT COALESCE(auth_is_conselho(), false) THEN
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

-- A régua do bônus é escrita direto na tabela (não tem RPC), então a policy
-- é o guard. Sem trocá-la, o CEO continuaria aprovando a política que define
-- o próprio bônus — o mesmo furo de apurar e pagar, uma porta ao lado.
DROP POLICY IF EXISTS politica_write ON public.politicas_remuneracao;
CREATE POLICY politica_write ON public.politicas_remuneracao
  FOR ALL TO authenticated
  USING (COALESCE(auth_is_conselho(), false) AND COALESCE(NOT auth_desligado(), false))
  WITH CHECK (COALESCE(auth_is_conselho(), false));

-- ── 4. Mandatos (#G6) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nomear_mandato(
  p_user_profile_id uuid,
  p_cargo           text,
  p_filial          text,
  p_data_inicio     date,
  p_data_fim        date,
  p_ato             text DEFAULT NULL,
  p_aplicar_acesso  boolean DEFAULT false,
  p_origem_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_perfil  user_profiles;
  v_func_id uuid;
  v_id      uuid;
  v_ator    text;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Conselho nomeia.' USING ERRCODE = '42501';
  END IF;

  -- Ninguém se nomeia. Mesmo conflito de interesse que a 386 escreveu para
  -- orçamento e prestação de contas, e vale inclusive para conselheiro.
  IF p_user_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Ninguém se nomeia. Outro conselheiro tem de assinar o ato.'
      USING ERRCODE = '42501';
  END IF;

  IF p_data_fim IS NULL OR p_data_inicio IS NULL OR p_data_fim <= p_data_inicio THEN
    RAISE EXCEPTION 'Mandato precisa de prazo: fim depois do início.' USING ERRCODE = 'P0001';
  END IF;

  IF p_filial NOT IN ('SuperMax','MaxLook','TechMax','Matriz') THEN
    RAISE EXCEPTION 'Unidade inválida.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_perfil FROM user_profiles WHERE id = p_user_profile_id;
  IF v_perfil.id IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_perfil.desligado_em IS NOT NULL OR NOT COALESCE(v_perfil.ativo, true) THEN
    RAISE EXCEPTION 'Não se nomeia quem está desligado.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM mandatos
              WHERE user_profile_id = p_user_profile_id AND status = 'vigente' AND ativo = true) THEN
    RAISE EXCEPTION 'Esta pessoa já tem mandato vigente. Encerre o atual antes.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM mandatos
              WHERE lower(cargo) = lower(p_cargo) AND filial = p_filial
                AND status = 'vigente' AND ativo = true) THEN
    RAISE EXCEPTION 'Já há titular vigente para % em %.', p_cargo, p_filial USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_ator FROM user_profiles WHERE id = auth.uid();
  SELECT id INTO v_func_id FROM funcionarios
   WHERE user_profile_id = p_user_profile_id AND COALESCE(ativo, true) LIMIT 1;

  INSERT INTO mandatos
    (user_profile_id, funcionario_id, nome_snapshot, cargo, filial,
     data_inicio, data_fim, ato, origem_mandato_id, aplicou_acesso,
     nomeado_por, nomeado_por_nome)
  VALUES
    (p_user_profile_id, v_func_id, v_perfil.nome, p_cargo, p_filial,
     p_data_inicio, p_data_fim, NULLIF(btrim(COALESCE(p_ato,'')), ''),
     p_origem_id, COALESCE(p_aplicar_acesso, false), auth.uid(), v_ator)
  RETURNING id INTO v_id;

  -- Acesso: só entre colaborador e gerente. Mandato não promove ninguém a
  -- admin/CEO/conselheiro — esse caminho fica fechado por design (migr. 258).
  IF COALESCE(p_aplicar_acesso, false) AND v_perfil.role IN ('colaborador','gerente') THEN
    UPDATE user_profiles
       SET role = 'gerente', filial = p_filial
     WHERE id = p_user_profile_id;
  END IF;

  INSERT INTO movimentacoes_carreira
    (funcionario_id, nome_funcionario, tipo, cargo_novo, filial_nova, filial,
     role_anterior, role_nova, data_efeito, user_profile_id,
     decidido_por, decidido_por_nome)
  VALUES
    (v_func_id, v_perfil.nome, 'Nomeação', p_cargo, p_filial, p_filial,
     v_perfil.role,
     CASE WHEN COALESCE(p_aplicar_acesso, false) AND v_perfil.role IN ('colaborador','gerente')
          THEN 'gerente' ELSE v_perfil.role END,
     p_data_inicio, p_user_profile_id, auth.uid(), v_ator);

  RETURN jsonb_build_object('sucesso', true, 'mandato_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.nomear_mandato(uuid,text,text,date,date,text,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomear_mandato(uuid,text,text,date,date,text,boolean,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.encerrar_mandato(
  p_mandato_id    uuid,
  p_desfecho      text,
  p_motivo        text DEFAULT NULL,
  p_nova_data_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_m      mandatos;
  v_novo   uuid;
  v_ator   text;
  v_role   text;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Conselho encerra mandato.' USING ERRCODE = '42501';
  END IF;

  IF p_desfecho NOT IN ('reconduzido','substituido','encerrado') THEN
    RAISE EXCEPTION 'Desfecho inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_m FROM mandatos WHERE id = p_mandato_id AND ativo = true;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'Mandato não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_m.status <> 'vigente' THEN
    RAISE EXCEPTION 'Este mandato já foi encerrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Ninguém decide o próprio desfecho — nem para se reconduzir.
  IF v_m.user_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Este mandato é seu — outro conselheiro tem de decidir o desfecho.'
      USING ERRCODE = '42501';
  END IF;

  IF p_desfecho = 'reconduzido' AND (p_nova_data_fim IS NULL OR p_nova_data_fim <= v_m.data_fim) THEN
    RAISE EXCEPTION 'Recondução precisa de novo prazo, posterior ao atual.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_ator FROM user_profiles WHERE id = auth.uid();

  UPDATE mandatos
     SET status = 'encerrado', desfecho = p_desfecho,
         encerrado_por = auth.uid(), encerrado_em = now(),
         encerramento_motivo = NULLIF(btrim(COALESCE(p_motivo,'')), ''),
         updated_at = now()
   WHERE id = p_mandato_id;

  IF p_desfecho = 'reconduzido' THEN
    -- O posto continua com a mesma pessoa: novo ato, novo prazo, mesma
    -- linha do tempo. O acesso já está aplicado, então não se mexe nele.
    INSERT INTO mandatos
      (user_profile_id, funcionario_id, nome_snapshot, cargo, filial,
       data_inicio, data_fim, ato, origem_mandato_id, aplicou_acesso,
       nomeado_por, nomeado_por_nome)
    VALUES
      (v_m.user_profile_id, v_m.funcionario_id, v_m.nome_snapshot, v_m.cargo, v_m.filial,
       v_m.data_fim + 1, p_nova_data_fim,
       NULLIF(btrim(COALESCE(p_motivo,'')), ''), v_m.id, v_m.aplicou_acesso,
       auth.uid(), v_ator)
    RETURNING id INTO v_novo;
  ELSE
    -- Saiu do posto. Se a nomeação tinha dado o acesso, ela o retira —
    -- e só se a pessoa não estiver titular de outro posto.
    IF v_m.aplicou_acesso THEN
      SELECT role INTO v_role FROM user_profiles WHERE id = v_m.user_profile_id;
      IF v_role = 'gerente' AND NOT EXISTS (
            SELECT 1 FROM mandatos
             WHERE user_profile_id = v_m.user_profile_id
               AND status = 'vigente' AND ativo = true) THEN
        UPDATE user_profiles SET role = 'colaborador' WHERE id = v_m.user_profile_id;
      END IF;
    END IF;

    INSERT INTO movimentacoes_carreira
      (funcionario_id, nome_funcionario, tipo, cargo_anterior, filial_anterior, filial,
       data_efeito, user_profile_id, decidido_por, decidido_por_nome)
    VALUES
      (v_m.funcionario_id, v_m.nome_snapshot, 'Fim de mandato', v_m.cargo, v_m.filial, v_m.filial,
       CURRENT_DATE, v_m.user_profile_id, auth.uid(), v_ator);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'desfecho', p_desfecho, 'novo_mandato_id', v_novo);
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_mandato(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_mandato(uuid,text,text,date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Os 7 atos usando o teste novo, e `responder_revisao_auditoria` NÃO:
-- SELECT p.proname,
--        pg_get_functiondef(p.oid) ILIKE '%auth_is_conselho()%' AS usa_conselho,
--        has_function_privilege('anon', p.oid, 'EXECUTE')       AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('abrir_revisao_auditoria','encerrar_revisao_auditoria',
--                      'deliberar_destinacao_resultado','apurar_bonus','pagar_bonus',
--                      'nomear_mandato','encerrar_mandato','responder_revisao_auditoria')
--  ORDER BY 1;
-- Esperado: usa_conselho = true em 7, false em responder_revisao_auditoria.
--           anon_pode = false em todas.
--
-- 2) Nenhum ato de Conselho ficou para trás:
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ILIKE '%auth_is_admin()%'
--    AND p.proname ~ '(deliberar|apurar_bonus|pagar_bonus|nomear|encerrar_revisao|abrir_revisao)';
-- Esperado: zero linhas.
--
-- 3) Autonomeação barrada: logado como conselheiro, chamar nomear_mandato
--    passando o próprio user_profile_id deve devolver 42501.
