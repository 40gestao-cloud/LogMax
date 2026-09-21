-- 606_20260921_emprestimo_aprovado_por_engano_se_corrige.sql
--
-- A 572 deu ao professor o botão de APAGAR o empréstimo e a 573 fez o apagar
-- devolver o dinheiro. Faltava o meio-termo: o contrato está certo em existir
-- e errado no número — taxa digitada como 23 em vez de 2,3, 12x onde era 6x,
-- valor com um zero a mais, conta de destino trocada. Hoje o caminho é apagar
-- e pedir pra unidade solicitar de novo, o que joga fora a solicitação do
-- aluno, a justificativa e a data.
--
-- `editar_emprestimo` corrige em cima, sem perder a linha.
--
-- ────────────────────────────────────────────────────────────────────────────
-- COMO SE EDITA UM CONTRATO QUE JÁ VIROU DINHEIRO
-- ────────────────────────────────────────────────────────────────────────────
-- Não dá pra "dar UPDATE no valor": o empréstimo aprovado já moveu caixa e já
-- gerou N títulos dos dois lados. Editar é, necessariamente, DESFAZER e REFAZER
-- na mesma transação — exatamente a conta da 573 seguida da conta da 326:
--
--   1. apaga parcelas e títulos (os pagos se revertem sozinhos pelo
--      `trg_sync_saldo_*`, cada um na conta que pagou — a lição da 573: somar
--      baixa aqui DOBRARIA a devolução);
--   2. estorna o principal ANTIGO: conta da unidade −V0, conta da Matriz +V0;
--   3. aplica o principal NOVO: conta da Matriz −V1, conta da unidade +V1;
--   4. refaz a Price com taxa/prazo novos, do zero.
--
-- A ordem importa. O estorno vem antes da aplicação pra que o caixa da Matriz
-- já tenha V0 de volta quando for conferir se cabe V1 — senão trocar 10.000
-- por 10.500 seria recusado por saldo que a própria edição devolve.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE A EDIÇÃO NÃO MUDA
-- ────────────────────────────────────────────────────────────────────────────
-- · A FILIAL. Empréstimo aprovado na unidade errada não é erro de número, é
--   contrato errado: some da unidade que não pediu e aparece na que não
--   solicitou. Esse caso continua sendo apagar (573) e refazer.
-- · `created_at`, `solicitado_por` e a justificativa do aluno. É a mesma
--   solicitação; o que mudou foi a resposta da Matriz.
--
-- E o que ela reinicia, de propósito: os VENCIMENTOS. A Price nova nasce com
-- a primeira parcela a 30 dias de hoje, como em toda aprovação. Reaproveitar
-- as datas velhas criaria parcela vencida no ato da correção.
--
-- ────────────────────────────────────────────────────────────────────────────
-- TRAVAS
-- ────────────────────────────────────────────────────────────────────────────
-- · `role = 'admin'` LITERAL, igual à 572/573: `auth_is_admin()` inclui ceo e
--   conselheiro, que são ALUNOS. Corrigir a própria aprovação não é ato de
--   aluno — vide [[feedback_auth_is_admin_inclui_alunos]].
-- · Só 'Aprovado' e não arquivado. Pendente se resolve no Analisar; Negado não
--   tem contrato; arquivado é histórico fechado (o gatilho da 572 recusaria o
--   UPDATE de qualquer jeito, e é melhor recusar com a frase certa).
-- · Saldo dos dois lados, mesma régua da 573 e da 326: a unidade precisa ter
--   V0 pra devolver (se já gastou, não dá — o caminho é apagar ou deixar
--   pagar), e a Matriz precisa ter V1 pra aplicar.
-- · O teto de parcelas da 604 é cobrado pelo `trg_emprestimo_valida_condicoes`
--   no UPDATE, porque `num_parcelas` muda. Não se repete a regra aqui.
--
-- Tudo vira linha em `historico_operacoes`, dizendo o que era e o que passou a
-- ser: caixa que muda sem registro é o que a 327 proibiu.
--
-- NOTA SOBRE O CORPO: a Price e as travas de conta são as de
-- `aprovar_emprestimo` lida do banco nesta sessão
-- (md5 198803a0801ffba3e576d2fa101c175e nos 4, o mesmo carimbado na 573).
-- Função NOVA — nada de CREATE OR REPLACE por cima de corpo alheio.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.editar_emprestimo(
  p_emprestimo_id      uuid,
  p_valor              numeric,
  p_taxa_juros         numeric,
  p_num_parcelas       integer,
  p_banco_id           uuid    DEFAULT NULL,
  p_banco_origem_id    uuid    DEFAULT NULL,
  p_justificativa_resp text    DEFAULT NULL,
  p_motivo             text    DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp            RECORD;
  v_cp_ids         uuid[];
  v_cr_ids         uuid[];
  v_parcelas_old   int;
  v_pagas          int := 0;
  v_dest_old_id    uuid;
  v_dest_old_nome  text;
  v_dest_old_saldo numeric;
  v_orig_old_id    uuid;
  v_orig_old_nome  text;
  v_dest_id        uuid;
  v_dest_filial    text;
  v_dest_nome      text;
  v_orig_id        uuid;
  v_orig_filial    text;
  v_orig_nome      text;
  v_orig_saldo     numeric;
  v_banco_nome     text;
  v_i              numeric;
  v_fator          numeric;
  v_parcela        numeric;
  v_saldo          numeric;
  v_juros          numeric;
  v_amort          numeric;
  v_valor_this     numeric;
  i                int;
  v_venc           date;
  v_cp_id          uuid;
  v_cr_id          uuid;
  v_desc           text;
  v_ator_nome      text;
  v_ator_setor     text;
  v_mudancas       text[] := '{}';
  v_detalhe        text;
BEGIN
  PERFORM public._assert_rpc();

  -- `role = 'admin'` literal: `auth_is_admin()` inclui ceo, conselheiro e
  -- gerente-conselheiro, que sao ALUNOS (mesma linha da 572/573).
  IF NOT COALESCE(public.auth_user_role() = 'admin', false)
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas o administrador edita um empréstimo já aprovado.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_emp FROM public.emprestimos_filial
   WHERE id = p_emprestimo_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empréstimo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_emp.arquivado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este empréstimo é histórico fechado — foi preservado num reset e virou consulta. Não se reescreve; só se apaga.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_emp.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só empréstimo APROVADO se edita aqui — este está %. Pendente se resolve em Analisar, e negado não tem contrato para corrigir.',
      lower(v_emp.status) USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor do empréstimo.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_num_parcelas, 0) < 1 THEN
    RAISE EXCEPTION 'O empréstimo precisa de ao menos 1 parcela.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_taxa_juros, 0) < 0 THEN
    RAISE EXCEPTION 'Taxa de juros não pode ser negativa.' USING ERRCODE = 'P0001';
  END IF;

  -- ── Contas: as de agora (para desfazer) e as novas (para refazer) ────────
  v_dest_old_id := v_emp.banco_id;
  IF v_dest_old_id IS NULL THEN
    RAISE EXCEPTION 'Este empréstimo não registra a conta de % que recebeu o valor, então não há de onde tirar o principal para recolocá-lo.',
      v_emp.filial USING ERRCODE = 'P0001';
  END IF;

  v_dest_id := COALESCE(p_banco_id, v_emp.banco_id);
  SELECT filial, COALESCE(banco, conta) INTO v_dest_filial, v_dest_nome
    FROM public.caixa_bancos
   WHERE id = v_dest_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de destino não encontrada (ou inativa).' USING ERRCODE = 'P0001';
  END IF;
  IF v_dest_filial IS NOT NULL AND v_dest_filial <> v_emp.filial THEN
    RAISE EXCEPTION 'A conta de destino é de % e o empréstimo é de %. A edição não muda a unidade do contrato — para isso, apague e refaça.',
      v_dest_filial, v_emp.filial USING ERRCODE = 'P0001';
  END IF;

  -- Origem: a coluna (573) ou o parametro. Emprestimo anterior a 573 nao
  -- gravou de onde saiu; chutar seria devolver no caixa errado.
  v_orig_id := COALESCE(p_banco_origem_id, v_emp.banco_origem_id);
  IF v_orig_id IS NULL THEN
    RAISE EXCEPTION 'Este empréstimo é anterior ao registro da conta de origem (migr. 573), então o sistema não sabe de qual caixa da Matriz o dinheiro saiu. Informe a conta.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT filial, COALESCE(banco, conta) INTO v_orig_filial, v_orig_nome
    FROM public.caixa_bancos
   WHERE id = v_orig_id AND COALESCE(ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A conta da Matriz do empréstimo não existe (ou está inativa). Recrie a conta antes de editar, senão o dinheiro some do sistema.'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_orig_filial, '') <> 'Matriz' THEN
    RAISE EXCEPTION 'O empréstimo sai do caixa da Matriz. A conta escolhida é de %.',
      COALESCE(v_orig_filial, 'uso global') USING ERRCODE = 'P0001';
  END IF;

  -- A conta que recebe o estorno do principal ANTIGO: a de origem registrada,
  -- ou — no contrato pré-573 — a que o professor acabou de informar.
  v_orig_old_id := COALESCE(v_emp.banco_origem_id, v_orig_id);
  SELECT COALESCE(banco, conta) INTO v_orig_old_nome
    FROM public.caixa_bancos WHERE id = v_orig_old_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A conta da Matriz de onde este empréstimo saiu não existe mais. Sem ela, o principal antigo não tem para onde voltar.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 1) Apaga o cronograma atual ──────────────────────────────────────────
  -- Foto dos titulos antes do DELETE das parcelas: elas sao a unica ligacao
  -- entre o emprestimo e os titulos dos dois lados (a licao da 485).
  SELECT array_agg(contas_pagar_id)   FILTER (WHERE contas_pagar_id IS NOT NULL),
         array_agg(contas_receber_id) FILTER (WHERE contas_receber_id IS NOT NULL),
         count(*)
    INTO v_cp_ids, v_cr_ids, v_parcelas_old
    FROM public.parcelas_emprestimo
   WHERE emprestimo_id = p_emprestimo_id;

  IF v_cp_ids IS NOT NULL THEN
    SELECT count(*) INTO v_pagas FROM public.contas_pagar
     WHERE id = ANY(v_cp_ids) AND COALESCE(valor_pago, 0) > 0;
  END IF;

  DELETE FROM public.parcelas_emprestimo WHERE emprestimo_id = p_emprestimo_id;

  -- Apagar titulo PAGO ja devolve o dinheiro sozinho (`trg_sync_saldo_*`
  -- dispara em DELETE e credita `valor_pago` de volta ao banco da propria
  -- conta). Por isso aqui nao se soma baixa nenhuma: seria devolver duas
  -- vezes -- a licao da 573.
  IF v_cp_ids IS NOT NULL THEN
    DELETE FROM public.contas_pagar WHERE id = ANY(v_cp_ids);
  END IF;
  IF v_cr_ids IS NOT NULL THEN
    DELETE FROM public.contas_receber WHERE id = ANY(v_cr_ids);
  END IF;

  -- ── 2) Estorna o principal antigo ────────────────────────────────────────
  -- Saldo lido DEPOIS dos DELETEs, como na 573: as parcelas pagas ja voltaram
  -- pra conta da unidade, e e' com elas de volta que se decide se cabe.
  SELECT COALESCE(saldo, 0), COALESCE(banco, conta)
    INTO v_dest_old_saldo, v_dest_old_nome
    FROM public.caixa_bancos
   WHERE id = v_dest_old_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A conta de % que recebeu este empréstimo não existe mais. Sem ela não dá para refazer o contrato.',
      v_emp.filial USING ERRCODE = 'P0001';
  END IF;
  IF v_dest_old_saldo < v_emp.valor THEN
    RAISE EXCEPTION 'Edição recusada: refazer o contrato exige devolver os R$ % originais, e a conta % tem R$ %. Faltam R$ % — % já usou o dinheiro. Nada foi alterado.',
      public.brl(v_emp.valor), v_dest_old_nome, public.brl(v_dest_old_saldo),
      public.brl(v_emp.valor - v_dest_old_saldo), v_emp.filial
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) - v_emp.valor
   WHERE id = v_dest_old_id;
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + v_emp.valor
   WHERE id = v_orig_old_id;

  -- ── 3) Aplica o principal novo ───────────────────────────────────────────
  SELECT COALESCE(saldo, 0) INTO v_orig_saldo
    FROM public.caixa_bancos WHERE id = v_orig_id FOR UPDATE;
  IF v_orig_saldo < p_valor THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e o empréstimo corrigido é de R$ %. Nada foi alterado.',
      v_orig_nome, public.brl(v_orig_saldo), public.brl(p_valor)
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) - p_valor
   WHERE id = v_orig_id;
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + p_valor
   WHERE id = v_dest_id;

  -- ── 4) Contrato e cronograma novos ───────────────────────────────────────
  SELECT COALESCE(banco, '') || ' — ' || COALESCE(conta, '') INTO v_banco_nome
    FROM public.caixa_bancos WHERE id = v_dest_id;

  UPDATE public.emprestimos_filial SET
    valor                  = p_valor,
    taxa_juros             = p_taxa_juros,
    num_parcelas           = p_num_parcelas,
    banco_id               = v_dest_id,
    banco_nome             = v_banco_nome,
    banco_origem_id        = v_orig_id,
    justificativa_resposta = COALESCE(NULLIF(btrim(p_justificativa_resp), ''), justificativa_resposta),
    aprovado_por           = auth.uid(),
    aprovado_por_nome      = (SELECT nome FROM public.user_profiles WHERE id = auth.uid())
  WHERE id = p_emprestimo_id;

  v_i := COALESCE(p_taxa_juros, 0) / 100;

  IF v_i = 0 THEN
    v_parcela := ROUND(p_valor / p_num_parcelas, 2);
  ELSE
    v_fator   := power(1 + v_i, p_num_parcelas::numeric);
    v_parcela := ROUND(p_valor * v_i * v_fator / (v_fator - 1), 2);
  END IF;

  v_saldo := p_valor;

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
           || ' — Empréstimo ' || COALESCE(v_banco_nome, 'Banco')
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

  -- ── Trilha ───────────────────────────────────────────────────────────────
  IF v_emp.valor IS DISTINCT FROM p_valor THEN
    v_mudancas := v_mudancas || ('valor R$ ' || public.brl(v_emp.valor) || ' → R$ ' || public.brl(p_valor));
  END IF;
  IF COALESCE(v_emp.taxa_juros, 0) IS DISTINCT FROM COALESCE(p_taxa_juros, 0) THEN
    v_mudancas := v_mudancas || ('taxa ' || COALESCE(v_emp.taxa_juros, 0) || '% → ' || COALESCE(p_taxa_juros, 0) || '% a.m.');
  END IF;
  IF v_emp.num_parcelas IS DISTINCT FROM p_num_parcelas THEN
    v_mudancas := v_mudancas || (v_emp.num_parcelas || 'x → ' || p_num_parcelas || 'x');
  END IF;
  IF v_dest_old_id IS DISTINCT FROM v_dest_id THEN
    v_mudancas := v_mudancas || ('conta de destino ' || v_dest_old_nome || ' → ' || v_dest_nome);
  END IF;
  IF v_orig_old_id IS DISTINCT FROM v_orig_id THEN
    v_mudancas := v_mudancas || ('conta da Matriz ' || v_orig_old_nome || ' → ' || v_orig_nome);
  END IF;

  SELECT nome, setor INTO v_ator_nome, v_ator_setor
    FROM public.user_profiles WHERE id = auth.uid();
  IF v_ator_nome IS NULL THEN
    v_ator_nome := CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE 'Usuário removido' END;
  END IF;

  v_detalhe := 'Empréstimo de ' || v_emp.filial || ' corrigido: '
    || COALESCE(NULLIF(array_to_string(v_mudancas, ' · '), ''), 'cronograma refeito sem mudança de condições')
    || ' · ' || COALESCE(v_parcelas_old, 0) || ' parcela(s) antiga(s) apagada(s)'
    || CASE WHEN v_pagas > 0
            THEN ' (' || v_pagas || ' já paga(s), devolvida(s) à conta que pagou)'
            ELSE '' END
    || ' e ' || p_num_parcelas || ' nova(s) gerada(s) a partir de hoje'
    || COALESCE(' · motivo: ' || NULLIF(btrim(p_motivo), ''), '');

  INSERT INTO public.historico_operacoes
    (entidade, entidade_id, filial, evento, de, para, detalhe,
     ator_id, ator_nome, ator_setor)
  VALUES
    ('emprestimos_filial', p_emprestimo_id, v_emp.filial, 'Empréstimo editado',
     public.brl(v_emp.valor), public.brl(p_valor), v_detalhe,
     auth.uid(), v_ator_nome, v_ator_setor);

  RETURN jsonb_build_object(
    'sucesso',                   true,
    'filial',                    v_emp.filial,
    'valor_anterior',            v_emp.valor,
    'valor',                     p_valor,
    'num_parcelas',              p_num_parcelas,
    'taxa_juros',                p_taxa_juros,
    'parcelas_apagadas',         COALESCE(v_parcelas_old, 0),
    'parcelas_pagas_revertidas', v_pagas,
    'conta_destino',             v_dest_nome,
    'conta_matriz',              v_orig_nome
  );
END;
$function$;

COMMENT ON FUNCTION public.editar_emprestimo(uuid, numeric, numeric, integer, uuid, uuid, text, text) IS
  'Migr. 606 — o professor corrige um empréstimo APROVADO vivo (valor, taxa, prazo, contas) sem apagar a solicitação. Desfaz e refaz na mesma transação: apaga parcelas/títulos (os pagos se revertem pelo trg_sync_saldo_*), estorna o principal antigo, aplica o novo e regera a Price com vencimentos a partir de hoje. Não muda a filial. role=admin literal.';

REVOKE ALL ON FUNCTION public.editar_emprestimo(uuid, numeric, numeric, integer, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editar_emprestimo(uuid, numeric, numeric, integer, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_emprestimo(uuid, numeric, numeric, integer, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_emprestimo(uuid, numeric, numeric, integer, uuid, uuid, text, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc WHERE proname = 'editar_emprestimo';
--   -- esperado: UMA linha,
--   --   'uuid, numeric, numeric, integer, uuid, uuid, text, text'
--
--   -- Ensaio sem alterar nada de verdade:
--   --   BEGIN;
--   --     SELECT id, valor, taxa_juros, num_parcelas, banco_id, banco_origem_id
--   --       FROM emprestimos_filial
--   --      WHERE status = 'Aprovado' AND arquivado_em IS NULL LIMIT 1;
--   --     SELECT id, saldo FROM caixa_bancos WHERE id IN (<banco_id>, <origem>);
--   --     SELECT editar_emprestimo('<id>', 5000, 2.3, 6);
--   --     SELECT num_parcela, valor_parcela, data_vencimento
--   --       FROM parcelas_emprestimo WHERE emprestimo_id = '<id>'
--   --      ORDER BY num_parcela;
--   --     SELECT id, saldo FROM caixa_bancos WHERE id IN (<banco_id>, <origem>);
--   --     -- esperado: destino −V0+V1, origem +V0−V1, 6 parcelas novas
--   --   ROLLBACK;
-- ════════════════════════════════════════════════════════════════════════════
