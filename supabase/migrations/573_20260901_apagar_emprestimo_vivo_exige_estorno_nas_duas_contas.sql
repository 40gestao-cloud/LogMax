-- 573_20260901_apagar_emprestimo_vivo_exige_estorno_nas_duas_contas.sql
--
-- A 572 deixou o professor apagar empréstimo arquivado, Pendente e Negado, e
-- RECUSOU o aprovado ainda vivo com o argumento certo: apagar a linha não
-- devolveria o dinheiro. Esta migração faz a devolução acontecer, e aí o vivo
-- também sai.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE PRECISA SER DESFEITO (e o que já se desfaz sozinho)
-- ────────────────────────────────────────────────────────────────────────────
-- Um empréstimo vivo mexeu no caixa em dois momentos:
--
--   1. NA APROVAÇÃO (326): conta da Matriz −V, conta da unidade +V.
--   2. A CADA PARCELA PAGA: conta da unidade −parcela (baixa da conta a pagar)
--      e conta da Matriz +parcela (baixa da conta a receber).
--
-- O segundo NÃO precisa de código. `trg_sync_saldo_contas_pagar` e
-- `trg_sync_saldo_contas_receber` disparam em DELETE e devolvem `valor_pago`
-- ao `banco_id` da própria conta — que é exatamente o banco que pagou e o que
-- recebeu. Como a 572 já apaga os títulos do empréstimo, cada pagamento se
-- reverte na conta certa, sozinho, na mesma transação. `contas_pagar_baixas` e
-- `contas_receber_baixas` saem por CASCADE junto.
--
-- Escrever um estorno "por baixa" aqui teria DOBRADO a devolução. Foi por isso
-- que li os gatilhos antes de somar `contas_pagar_baixas`.
--
-- Sobra o primeiro: o PRINCIPAL. Esse é o estorno explícito nas duas contas —
--
--   conta da unidade  −V   (o dinheiro emprestado volta)
--   conta da Matriz   +V   (para o caixa de onde saiu)
--
-- ────────────────────────────────────────────────────────────────────────────
-- DE QUAL CONTA DA MATRIZ SAIU? — COLUNA NOVA
-- ────────────────────────────────────────────────────────────────────────────
-- `aprovar_emprestimo` recebe `p_banco_origem_id` desde a 326 e DEBITA a conta,
-- mas nunca gravou qual foi. `capital_filial` guarda (`banco_origem_id`, 326);
-- `emprestimos_filial` não guardava — a lacuna só aparecia agora, que existe um
-- caminho de volta.
--
-- `emprestimos_filial.banco_origem_id` passa a ser gravado na aprovação. Isso
-- cobre os dois caminhos de uma vez: `conceder_mutuo_capital` (474, a Matriz
-- aplicando sem pedido) delega a `aprovar_emprestimo`.
--
-- Para os empréstimos ANTERIORES a coluna fica NULL, e aí a RPC exige que o
-- professor informe a conta no modal. Chutar a conta seria pior que perguntar:
-- devolver ao caixa errado é dinheiro criado num lugar e sumido noutro.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A TRAVA QUE FICA: SALDO INSUFICIENTE
-- ────────────────────────────────────────────────────────────────────────────
-- Mesma régua de `estornar_aporte_capital` (474), e pelo mesmo motivo. Se a
-- unidade já GASTOU o dinheiro, a conta dela não tem V para devolver, e o
-- estorno a deixaria negativa — dinheiro apagado do sistema. A RPC recusa
-- dizendo quanto falta.
--
-- O saldo é lido DEPOIS de apagar os títulos, de propósito: as parcelas já
-- pagas voltaram para a conta da unidade pelo gatilho, e é o saldo com elas de
-- volta que decide. Ler antes recusaria estorno que cabe.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ASSINATURA NOVA
-- ────────────────────────────────────────────────────────────────────────────
--   apagar_emprestimo(p_emprestimo_id uuid,
--                     p_estornar boolean DEFAULT false,
--                     p_banco_origem_id uuid DEFAULT NULL,
--                     p_motivo text DEFAULT NULL)
--
-- DROP da `apagar_emprestimo(uuid)` da 572 antes do CREATE: com DEFAULT nos
-- parâmetros novos, as duas conviveriam e a chamada de um argumento ficaria
-- ambígua (42725). Assinatura vigente exata, vide
-- [[feedback_drop_function_assinatura_exata]].
--
-- `p_estornar` é obrigatório no caso vivo e serve de trava dupla: a RPC agora
-- MOVE DINHEIRO, e mover dinheiro por engano de clique é o que a 326 passou a
-- evitar. Arquivado, Pendente e Negado seguem sem estorno — não há principal em
-- caixa nenhum para devolver.
--
-- Toda devolução vira linha em `historico_operacoes`, como a do aporte: caixa
-- que muda sem registro é o que a 327 proibiu.
--
-- NOTA SOBRE OS CORPOS: copiados de `prosrc`, não dos arquivos antigos.
--   apagar_emprestimo, md5 nos 4 ANTES desta: 52970a9dd537e01d97e9eefa4dc77f56
--   aprovar_emprestimo: corpo lido do banco nesta sessão; a convergência foi
--   conferida DEPOIS de aplicar, com md5 igual nos 4 (198803a0801ffba3e576…).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) De qual conta da Matriz o empréstimo saiu
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.emprestimos_filial
  ADD COLUMN IF NOT EXISTS banco_origem_id uuid
    REFERENCES public.caixa_bancos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.emprestimos_filial.banco_origem_id IS
  'Migr. 573 — conta da Matriz debitada na aprovação (o par de banco_id, que é a conta da unidade creditada). NULL nos empréstimos anteriores à 573: nesses, apagar_emprestimo() exige a conta como parâmetro.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2) A aprovação passa a gravar a origem
-- ════════════════════════════════════════════════════════════════════════════
-- Corpo da 326/416 inteiro, com uma linha a mais no UPDATE. Nada mais muda.
CREATE OR REPLACE FUNCTION public.aprovar_emprestimo(p_emprestimo_id uuid, p_banco_id uuid, p_banco_nome text, p_taxa_juros numeric, p_num_parcelas integer, p_justificativa_resp text, p_banco_origem_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp        RECORD;
  v_i          numeric;
  v_fator      numeric;
  v_parcela    numeric;
  v_saldo      numeric;
  v_juros      numeric;
  v_amort      numeric;
  v_valor_this numeric;
  i            int;
  v_venc       date;
  v_cp_id      uuid;
  v_cr_id      uuid;
  v_dest_filial text;
  v_dest_ok    boolean;
  v_orig_filial text;
  v_orig_saldo numeric;
  v_orig_nome  text;
  v_desc       text;
BEGIN
  PERFORM public._assert_capital_holding();

  SELECT * INTO v_emp FROM public.emprestimos_filial
   WHERE id = p_emprestimo_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empréstimo não encontrado'; END IF;
  IF v_emp.status <> 'Pendente' THEN RAISE EXCEPTION 'Empréstimo já processado'; END IF;

  PERFORM public._assert_nao_e_o_solicitante(v_emp.solicitado_por);

  IF COALESCE(p_num_parcelas, 0) < 1 THEN
    RAISE EXCEPTION 'O empréstimo precisa de ao menos 1 parcela.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_taxa_juros, 0) < 0 THEN
    RAISE EXCEPTION 'Taxa de juros não pode ser negativa.' USING ERRCODE = 'P0001';
  END IF;

  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de % que recebe o valor.', v_emp.filial USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, true INTO v_dest_filial, v_dest_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT COALESCE(v_dest_ok, false) THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_dest_filial IS NOT NULL AND v_dest_filial <> v_emp.filial THEN
    RAISE EXCEPTION 'A conta de destino é de % e o empréstimo é pra %.', v_dest_filial, v_emp.filial
      USING ERRCODE = 'P0001';
  END IF;

  IF p_banco_origem_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta da Matriz de onde sai o empréstimo.' USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, COALESCE(saldo, 0), COALESCE(banco, conta)
    INTO v_orig_filial, v_orig_saldo, v_orig_nome
    FROM public.caixa_bancos
   WHERE id = p_banco_origem_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_orig_filial, '') <> 'Matriz' THEN
    RAISE EXCEPTION 'O empréstimo sai do caixa da Matriz. A conta escolhida é de %.',
      COALESCE(v_orig_filial, 'uso global') USING ERRCODE = 'P0001';
  END IF;
  IF v_orig_saldo < v_emp.valor THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e o empréstimo é de R$ %.',
      v_orig_nome, public.brl(v_orig_saldo), public.brl(v_emp.valor)
      USING ERRCODE = 'P0001';
  END IF;

  v_i := COALESCE(p_taxa_juros, 0) / 100;

  IF v_i = 0 THEN
    v_parcela := ROUND(v_emp.valor / p_num_parcelas, 2);
  ELSE
    v_fator   := power(1 + v_i, p_num_parcelas::numeric);
    v_parcela := ROUND(v_emp.valor * v_i * v_fator / (v_fator - 1), 2);
  END IF;

  UPDATE public.emprestimos_filial SET
    status                 = 'Aprovado',
    banco_id               = p_banco_id,
    banco_nome             = p_banco_nome,
    -- (573) De onde o dinheiro saiu. Sem isto, desfazer o empréstimo depois
    -- não tem para onde devolver o principal.
    banco_origem_id        = p_banco_origem_id,
    taxa_juros             = p_taxa_juros,
    num_parcelas           = p_num_parcelas,
    aprovado_por           = auth.uid(),
    aprovado_por_nome      = (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
    justificativa_resposta = p_justificativa_resp
  WHERE id = p_emprestimo_id;

  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) - v_emp.valor
   WHERE id = p_banco_origem_id;
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + v_emp.valor
   WHERE id = p_banco_id;

  v_saldo := v_emp.valor;

  FOR i IN 1..p_num_parcelas LOOP
    v_venc  := public.acre_today() + ((i) * interval '1 month');
    v_juros := ROUND(v_saldo * v_i, 2);

    IF i = p_num_parcelas THEN
      v_amort      := ROUND(v_saldo, 2);
      v_valor_this := ROUND(v_amort + v_juros, 2);
    ELSE
      v_amort      := ROUND(v_parcela - v_juros, 2);
      v_valor_this := v_parcela;
    END IF;

    v_saldo := ROUND(v_saldo - v_amort, 2);

    v_desc := 'Parcela ' || i || '/' || p_num_parcelas
           || ' — Empréstimo ' || COALESCE(p_banco_nome, 'Banco')
           || CASE WHEN v_juros > 0
                   THEN ' · juros R$ ' || public.brl(v_juros)
                   ELSE '' END;

    INSERT INTO public.contas_pagar (descricao, valor, vencimento, status, filial, origem)
    VALUES (v_desc, v_valor_this, v_venc, 'Pendente', v_emp.filial, 'emprestimo')
    RETURNING id INTO v_cp_id;

    INSERT INTO public.contas_receber (descricao, valor, vencimento, status, filial, origem)
    VALUES (
      'Parcela ' || i || '/' || p_num_parcelas || ' — Empréstimo a ' || v_emp.filial,
      v_valor_this, v_venc, 'Aberto', 'Matriz', 'emprestimo'
    )
    RETURNING id INTO v_cr_id;

    INSERT INTO public.parcelas_emprestimo
      (emprestimo_id, num_parcela, valor_parcela, data_vencimento,
       contas_pagar_id, contas_receber_id, juros, amortizacao, saldo_devedor)
    VALUES
      (p_emprestimo_id, i, v_valor_this, v_venc,
       v_cp_id, v_cr_id, v_juros, v_amort, v_saldo);
  END LOOP;
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3) A válvula, agora com estorno
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.apagar_emprestimo(uuid);

CREATE OR REPLACE FUNCTION public.apagar_emprestimo(
  p_emprestimo_id   uuid,
  p_estornar        boolean DEFAULT false,
  p_banco_origem_id uuid    DEFAULT NULL,
  p_motivo          text    DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp         RECORD;
  v_vivo        boolean;
  v_cp_ids      uuid[];
  v_cr_ids      uuid[];
  v_parcelas    int;
  v_titulos     int := 0;
  v_n           int;
  v_orig_id     uuid;
  v_orig_filial text;
  v_orig_nome   text;
  v_dest_saldo  numeric;
  v_dest_nome   text;
  v_ator_nome   text;
  v_ator_setor  text;
  v_detalhe     text;
BEGIN
  PERFORM public._assert_rpc();

  -- `role = 'admin'` literal: `auth_is_admin()` inclui ceo, conselheiro e
  -- gerente-conselheiro, que sao ALUNOS (mesma linha da 412 e da 485).
  IF NOT COALESCE(public.auth_user_role() = 'admin', false)
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas o administrador apaga um empréstimo.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_emp FROM public.emprestimos_filial
   WHERE id = p_emprestimo_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empréstimo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Vivo = aprovado e nao arquivado por reset: o principal esta em caixa.
  -- Arquivado, Pendente e Negado nao tem o que devolver.
  v_vivo := (v_emp.status = 'Aprovado' AND v_emp.arquivado_em IS NULL);

  IF v_vivo THEN
    -- (573) Trava dupla: esta RPC move dinheiro. Nao se apaga emprestimo vivo
    -- por descuido de clique.
    IF NOT COALESCE(p_estornar, false) THEN
      RAISE EXCEPTION 'Este empréstimo está vivo: R$ % saíram do caixa da Matriz e entraram no de %. Apagar exige o estorno explícito do principal nas duas contas — confirme a devolução.',
        public.brl(v_emp.valor), v_emp.filial
        USING ERRCODE = 'P0001';
    END IF;

    -- Origem: a coluna (573) ou, para emprestimo antigo, o parametro. Chutar
    -- a conta seria devolver dinheiro no lugar errado.
    v_orig_id := COALESCE(p_banco_origem_id, v_emp.banco_origem_id);
    IF v_orig_id IS NULL THEN
      RAISE EXCEPTION 'Este empréstimo é anterior ao registro da conta de origem (migr. 573), então o sistema não sabe de qual caixa da Matriz o dinheiro saiu. Informe a conta que deve receber a devolução de R$ %.',
        public.brl(v_emp.valor)
        USING ERRCODE = 'P0001';
    END IF;

    SELECT filial, COALESCE(banco, conta) INTO v_orig_filial, v_orig_nome
      FROM public.caixa_bancos
     WHERE id = v_orig_id AND COALESCE(ativo, true)
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A conta da Matriz que deve receber a devolução não existe (ou está inativa). Recrie a conta antes de apagar, senão o dinheiro some do sistema.'
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_orig_filial, '') <> 'Matriz' THEN
      RAISE EXCEPTION 'O empréstimo volta para o caixa da Matriz. A conta escolhida é de %.',
        COALESCE(v_orig_filial, 'uso global') USING ERRCODE = 'P0001';
    END IF;

    IF v_emp.banco_id IS NULL THEN
      RAISE EXCEPTION 'Este empréstimo não registra a conta de % que recebeu o valor, então não há de onde tirar a devolução.',
        v_emp.filial USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- A foto dos titulos ANTES do DELETE do contrato: as parcelas saem por
  -- CASCADE e levariam junto a unica forma de saber quais titulos eram deste
  -- emprestimo (a licao da 485).
  SELECT array_agg(contas_pagar_id)   FILTER (WHERE contas_pagar_id IS NOT NULL),
         array_agg(contas_receber_id) FILTER (WHERE contas_receber_id IS NOT NULL),
         count(*)
    INTO v_cp_ids, v_cr_ids, v_parcelas
    FROM public.parcelas_emprestimo
   WHERE emprestimo_id = p_emprestimo_id;

  DELETE FROM public.emprestimos_filial WHERE id = p_emprestimo_id;

  -- Apagar o titulo PAGO ja devolve o dinheiro sozinho: `trg_sync_saldo_*`
  -- dispara em DELETE e credita `valor_pago` de volta ao `banco_id` da propria
  -- conta -- o que pagou na unidade, o que recebeu na Matriz. As baixas saem
  -- por CASCADE. Por isso aqui nao se soma baixa nenhuma: seria devolver duas
  -- vezes.
  IF v_cp_ids IS NOT NULL THEN
    WITH del AS (DELETE FROM public.contas_pagar WHERE id = ANY(v_cp_ids) RETURNING 1)
    SELECT count(*) INTO v_n FROM del;
    v_titulos := v_titulos + COALESCE(v_n, 0);
  END IF;
  IF v_cr_ids IS NOT NULL THEN
    WITH del AS (DELETE FROM public.contas_receber WHERE id = ANY(v_cr_ids) RETURNING 1)
    SELECT count(*) INTO v_n FROM del;
    v_titulos := v_titulos + COALESCE(v_n, 0);
  END IF;

  IF v_vivo THEN
    -- Saldo lido DEPOIS dos DELETEs: as parcelas pagas ja voltaram para a conta
    -- da unidade pelo gatilho, e e' com elas de volta que se decide se o
    -- principal cabe.
    SELECT COALESCE(saldo, 0), COALESCE(banco, conta)
      INTO v_dest_saldo, v_dest_nome
      FROM public.caixa_bancos
     WHERE id = v_emp.banco_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A conta de % que recebeu este empréstimo não existe mais. Sem ela não dá para saber de onde tirar o dinheiro de volta.',
        v_emp.filial USING ERRCODE = 'P0001';
    END IF;

    -- Mesma recusa de `estornar_aporte_capital` (474): unidade que ja gastou o
    -- dinheiro nao tem como devolver, e forcar deixaria a conta negativa.
    IF v_dest_saldo < v_emp.valor THEN
      RAISE EXCEPTION 'Estorno recusado: a conta % tem R$ % e o empréstimo foi de R$ %. Faltam R$ % — % já usou o dinheiro, e devolver deixaria a conta negativa. Nada foi apagado.',
        v_dest_nome, public.brl(v_dest_saldo), public.brl(v_emp.valor),
        public.brl(v_emp.valor - v_dest_saldo), v_emp.filial
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - v_emp.valor
     WHERE id = v_emp.banco_id;
    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + v_emp.valor
     WHERE id = v_orig_id;
  END IF;

  -- Caixa que muda sem registro e o que a 327 proibiu. Mesma linha da
  -- `estornar_aporte_capital`.
  SELECT nome, setor INTO v_ator_nome, v_ator_setor
    FROM public.user_profiles WHERE id = auth.uid();
  IF v_ator_nome IS NULL THEN
    v_ator_nome := CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE 'Usuário removido' END;
  END IF;

  v_detalhe := 'Empréstimo de R$ ' || public.brl(v_emp.valor) || ' para ' || v_emp.filial
    || ' (' || v_emp.status || COALESCE(', arquivado em ' || v_emp.arquivado_em::date, '') || ')'
    || ' · ' || COALESCE(v_parcelas, 0) || ' parcela(s) e ' || v_titulos || ' título(s) apagados'
    || CASE WHEN v_vivo
            THEN ' · principal devolvido: saiu de ' || v_dest_nome || ' e voltou para ' || v_orig_nome
            ELSE ' · sem estorno (não havia principal em caixa)' END
    || COALESCE(' · motivo: ' || NULLIF(btrim(p_motivo), ''), '');

  INSERT INTO public.historico_operacoes
    (entidade, entidade_id, filial, evento, de, para, detalhe,
     ator_id, ator_nome, ator_setor)
  VALUES
    ('emprestimos_filial', p_emprestimo_id, v_emp.filial, 'Empréstimo apagado',
     public.brl(v_emp.valor), '0,00', v_detalhe,
     auth.uid(), v_ator_nome, v_ator_setor);

  RETURN jsonb_build_object(
    'sucesso',   true,
    'filial',    v_emp.filial,
    'valor',     v_emp.valor,
    'status',    v_emp.status,
    'arquivado', (v_emp.arquivado_em IS NOT NULL),
    'estornado', v_vivo,
    'devolvido_para', CASE WHEN v_vivo THEN v_orig_nome ELSE NULL END,
    'debitado_de',    CASE WHEN v_vivo THEN v_dest_nome ELSE NULL END,
    'parcelas_apagadas', COALESCE(v_parcelas, 0),
    'titulos_apagados',  v_titulos
  );
END;
$function$;

COMMENT ON FUNCTION public.apagar_emprestimo(uuid, boolean, uuid, text) IS
  'Migr. 573 — válvula do professor: apaga qualquer empréstimo, incluindo o aprovado vivo. Nesse caso exige p_estornar e devolve o PRINCIPAL (conta da unidade → conta da Matriz); as parcelas já pagas se revertem sozinhas pelo trg_sync_saldo_* ao apagar os títulos. Recusa se a conta da unidade não tiver saldo. role=admin literal.';

REVOKE ALL ON FUNCTION public.apagar_emprestimo(uuid, boolean, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apagar_emprestimo(uuid, boolean, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.apagar_emprestimo(uuid, boolean, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apagar_emprestimo(uuid, boolean, uuid, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc WHERE proname = 'apagar_emprestimo';
--   -- esperado: UMA linha, 'uuid, boolean, uuid, text'
--
--   SELECT prosrc ~ 'banco_origem_id\s*=\s*p_banco_origem_id' AS grava_origem
--     FROM pg_proc WHERE proname = 'aprovar_emprestimo';
--   -- esperado: true
--
--   -- O gatilho que dispensa somar baixa (ler antes de mexer nisto de novo):
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.contas_pagar'::regclass AND NOT tgisinternal
--      AND tgname = 'trg_sync_saldo_contas_pagar';
--
--   -- Ensaio do estorno sem apagar nada de verdade:
--   --   BEGIN;
--   --     SELECT id, valor, banco_id, banco_origem_id FROM emprestimos_filial
--   --      WHERE status = 'Aprovado' AND arquivado_em IS NULL LIMIT 1;
--   --     SELECT id, saldo FROM caixa_bancos WHERE id IN (<banco_id>, <origem>);
--   --     SELECT apagar_emprestimo('<id>', true);
--   --     SELECT id, saldo FROM caixa_bancos WHERE id IN (<banco_id>, <origem>);
--   --     -- esperado: destino −valor (+ parcelas pagas de volta), origem +valor
--   --   ROLLBACK;
-- ════════════════════════════════════════════════════════════════════════════
