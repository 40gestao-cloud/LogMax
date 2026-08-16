-- 432_20260816_o_cartao_do_colega.sql
--
-- Terceiro e último achado da auditoria de agosto. Saiu de uma refação da
-- varredura da 430: o filtro de "função que escreve" daquela passada usava
-- `\M` depois de um espaço, e `\M` é fim de PALAVRA — nunca casa ali. Com o
-- regexp corrigido sobraram quatro funções de escrita sem guard reconhecível.
-- Três são legítimas (`debitar_maxbank_salario`, `debitar_maxbank_beneficios`
-- e `transferir_pix_maxbank` operam sempre sobre a conta do próprio
-- `auth.uid()`, que é guard suficiente). A quarta não é.
--
-- ════════════════════════════════════════════════════════════════════════════
-- `autorizar_cartao_maxbank` DEBITA A CONTA QUE MANDAREM
--
-- A assinatura é (p_id, p_user_id, p_card_last_four) e o corpo usa `p_user_id`
-- direto para achar a conta MaxBank e tirar dinheiro dela:
--
--     SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = p_user_id;
--     ...
--     UPDATE maxbank_contas SET saldo_salario = saldo_salario - v_pendente.valor
--
-- Em lugar nenhum se confere que quem chama É esse usuário. O cliente diz de
-- quem é o cartão, e o banco acredita.
--
-- O app MaxBank manda certo — `PagarComCartao.tsx` passa `sessao.user.id`, o
-- id da própria sessão. Mas isso é a boa vontade do cliente, não uma regra do
-- servidor, e o servidor é o único lugar onde a regra vale. Um aluno abre uma
-- cobrança de um centavo no próprio PDV, pega o id do pendente que ele mesmo
-- criou, e chama a RPC trocando `p_user_id` pelo id de um colega: o débito sai
-- do saldo de salário do colega. Ids de colegas da mesma filial são visíveis
-- em `user_profiles`.
--
-- Agravante: esta função está na allowlist de `anon` da migr. 260 — ela ficou
-- agrupada com as do simulador de pagamento (`confirmar_pix_pendente`,
-- `confirmar_cartao_pendente`, `get_vitrine_publica`). Só que aquelas apenas
-- carimbam status; esta MOVE DINHEIRO. Sem login, com a anon key que está no
-- bundle, era o suficiente.
--
-- Conferido antes de mexer, dos dois lados:
--   • em `logmax/src` não há nenhuma chamada a esta RPC — o simulador de
--     pagamento não a usa;
--   • em `maxbank/src` a única chamada é a de `PagarComCartao.tsx`, e o MaxBank
--     autentica de verdade contra o mesmo projeto Supabase da turma
--     (`lib/auth.ts` usa `signInWithPassword`), então `auth.uid()` existe ali.
--
-- Logo, `p_user_id` sempre foi redundante. Passa a ser ignorado: a conta sai do
-- `auth.uid()`. O parâmetro continua na assinatura para o MaxBank não quebrar
-- (nem precisa de deploy coordenado), mas divergir do chamador vira erro
-- explícito em vez de débito silencioso na conta errada.
--
-- E o `anon` sai. Autorizar pagamento é ato de titular, e titular tem sessão.


BEGIN;

CREATE OR REPLACE FUNCTION public.autorizar_cartao_maxbank(p_id uuid, p_user_id uuid, p_card_last_four text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pendente cartao_pendentes;
  v_conta_id uuid;
  v_saldo_atual numeric;
  v_descricao text;
  v_titular uuid;
BEGIN
  -- Quem autoriza é o titular, e titular tem sessão. `p_user_id` continua na
  -- assinatura só para não quebrar o MaxBank, mas não manda mais em nada.
  v_titular := auth.uid();

  IF v_titular IS NULL THEN
    IF NOT public.auth_is_service_role() THEN
      RETURN jsonb_build_object('status', 'erro',
        'mensagem', 'Entre na sua carteira MaxBank para autorizar o pagamento.');
    END IF;
    -- service_role (rotina de manutenção) segue podendo indicar a conta.
    v_titular := p_user_id;
  ELSIF p_user_id IS NOT NULL AND p_user_id <> v_titular THEN
    RETURN jsonb_build_object('status', 'erro',
      'mensagem', 'Você só autoriza cobrança no seu próprio cartão.');
  END IF;

  -- Busca pendente
  SELECT * INTO v_pendente FROM cartao_pendentes WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobrança não encontrada.');
  END IF;

  IF v_pendente.status = 'autorizado' THEN
    RETURN jsonb_build_object('status', 'ja_autorizado');
  END IF;

  IF v_pendente.status <> 'aguardando' THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobrança cancelada ou inválida.');
  END IF;

  -- Busca conta MaxBank do titular
  SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = v_titular;
  IF v_conta_id IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Conta MaxBank não encontrada.');
  END IF;

  v_descricao := 'Compra cartão ' || v_pendente.metodo
              || CASE WHEN v_pendente.parcelas > 1
                      THEN ' ' || v_pendente.parcelas || 'x'
                      ELSE '' END;

  IF v_pendente.metodo = 'debito' THEN
    -- Verifica saldo
    SELECT saldo_salario INTO v_saldo_atual FROM maxbank_contas WHERE id = v_conta_id;
    IF v_saldo_atual < v_pendente.valor THEN
      RETURN jsonb_build_object(
        'status', 'erro',
        'mensagem', 'Saldo de salário insuficiente.',
        'saldo', v_saldo_atual
      );
    END IF;

    -- Debita saldo_salario
    UPDATE maxbank_contas
       SET saldo_salario = saldo_salario - v_pendente.valor
     WHERE id = v_conta_id;

    INSERT INTO maxbank_transacoes (conta_id, tipo, carteira, valor, descricao, origem)
    VALUES (v_conta_id, 'debito', 'salario', v_pendente.valor, v_descricao, 'cartao_maquininha');
  ELSE
    -- Crédito: registra transação fatura (não muda saldo)
    INSERT INTO maxbank_transacoes (conta_id, tipo, carteira, valor, descricao, origem)
    VALUES (v_conta_id, 'debito', 'fatura', v_pendente.valor, v_descricao, 'cartao_maquininha');
  END IF;

  -- Marca cartão como autorizado
  UPDATE cartao_pendentes
     SET status = 'autorizado',
         user_id = v_titular,
         card_last_four = COALESCE(p_card_last_four, card_last_four)
   WHERE id = p_id;

  RETURN jsonb_build_object('status', 'autorizado', 'valor', v_pendente.valor, 'metodo', v_pendente.metodo);
END;
$function$;

-- Sai da allowlist de anon da migr. 260. As outras três daquela lista
-- (confirmar_pix_pendente, confirmar_cartao_pendente, get_vitrine_publica) só
-- carimbam status ou leem vitrine; esta move dinheiro e agora exige sessão.
REVOKE ALL ON FUNCTION public.autorizar_cartao_maxbank(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.autorizar_cartao_maxbank(uuid, uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
--
--   SELECT proname,
--          has_function_privilege('anon', oid, 'EXECUTE')          AS anon_exec,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
--     FROM pg_proc WHERE pronamespace='public'::regnamespace
--      AND proname='autorizar_cartao_maxbank';   -- espera false / true
--
-- TESTE OBRIGATÓRIO ANTES DE PROPAGAR — este mexe no caminho de pagamento e
-- envolve os DOIS apps. Rodar numa turma só e fazer uma venda de verdade:
--   1. PDV: venda em cartão de débito → abre a maquininha;
--   2. MaxBank, logado como o cliente: autorizar → venda fecha, saldo cai;
--   3. mesma coisa em crédito parcelado → entra na fatura;
--   4. tentar autorizar deslogado no MaxBank → mensagem pedindo login.
--
-- Só depois aplicar nas outras três.
-- ════════════════════════════════════════════════════════════════════════════
