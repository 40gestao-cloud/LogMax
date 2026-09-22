-- 616_20260922_antecipar_parcela_desconta_o_juro_que_nao_correu.sql
--
-- Hoje antecipar parcela não vale nada: a unidade paga o mesmo título, com o
-- mesmo juro, só que mais cedo. Isso ensina o contrário de finanças.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O DESCONTO NÃO É PRÊMIO, É JURO QUE NÃO CORREU
-- ────────────────────────────────────────────────────────────────────────────
-- Um percentual escolhido a dedo ("pagou adiantado, ganha 2%") seria dinheiro
-- de graça, e gameável: pegar emprestado e devolver na semana seguinte daria
-- lucro. A régua aqui é a do mundo real (CDC art. 52 §2º): quem antecipa paga
-- o VALOR PRESENTE da parcela, descontado pela taxa do próprio contrato.
--
--   PV = parcela ÷ (1 + i)^meses
--
-- Na SuperMax (0,625% a.m.): a parcela 2 de R$ 30.056,92, antecipada um mês,
-- custa R$ 29.870,23 — desconto de R$ 186,69, que é exatamente um mês de juros
-- sobre esse valor. O dinheiro voltou antes, então não rendeu. Não há como
-- ganhar dinheiro com isso, e o aluno vê o valor do dinheiro no tempo em três
-- linhas de tela.
--
-- MESES CHEIOS, não dias. `age()` trunca: pagar hoje uma parcela que vence em
-- 59 dias conta como 1 mês, não 1,97. É conservador de propósito — o desconto
-- nunca é maior do que a matemática permite, e "um mês a menos de juros" é uma
-- frase que o aluno explica para o colega.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONDE O DESCONTO ENTRA NA CONTABILIDADE
-- ────────────────────────────────────────────────────────────────────────────
-- Do valor da parcela, a AMORTIZAÇÃO não muda — o principal devido é o mesmo,
-- e o saldo devedor segue a mesma trajetória. Quem encolhe é o JURO:
--
--   juros novo = juros original − desconto
--
-- Isso não é detalhe estético: `gerar_dre` soma `parcelas_emprestimo.juros`
-- para montar "Despesas financeiras". Sem mexer no juro da parcela, a unidade
-- pagaria menos e o DRE continuaria acusando a despesa cheia.
--
-- E a Matriz recebe menos, na mesma medida: o título dela é reduzido junto. O
-- desconto é transferência entre as duas, não dinheiro que aparece — as duas
-- pontas são avaliadas na competição e isso precisa estar visível.
--
-- ────────────────────────────────────────────────────────────────────────────
-- TRAVAS
-- ────────────────────────────────────────────────────────────────────────────
-- · Parcela vencida no contrato trava a antecipação. Sem isto, antecipar a 5
--   enquanto a 3 está vencida seria fuga da multa.
-- · Capital estourado trava. `bloqueia_conta_pagar_estourado` libera origem
--   'emprestimo' de propósito — obrigação já constituída se paga mesmo no
--   vermelho. Antecipar é escolha, não obrigação, e escolha não se faz quebrado.
-- · Contrato sem juros não tem o que descontar.
-- · Parcela com baixa parcial não antecipa: o desconto mudaria o valor de um
--   título que já recebeu dinheiro em cima. Quita-se a parte que falta.
-- · A baixa em si é delegada a `baixar_conta_pagar` — mesma porta, mesmas
--   validações de banco, mesmo registro em `contas_pagar_baixas`. Duplicar a
--   baixa aqui criaria um segundo jeito de quitar conta.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.antecipar_parcela_emprestimo(
  p_parcela_id uuid,
  p_banco_id   uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p          parcelas_emprestimo;
  v_emp        emprestimos_filial;
  v_cp         contas_pagar;
  v_hoje       date := public.acre_today();
  v_meses      int;
  v_i          numeric;
  v_pv         numeric(15,2);
  v_desconto   numeric(15,2);
  v_juros_novo numeric(15,2);
  v_vencidas   int;
  v_baixado    numeric(15,2);
  v_bloqueado  boolean;
  v_sufixo     text;
  v_ator       text;
  v_setor      text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_p FROM public.parcelas_emprestimo WHERE id = p_parcela_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parcela não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.status = 'Paga' THEN
    RAISE EXCEPTION 'Esta parcela já está paga.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_emp FROM public.emprestimos_filial WHERE id = v_p.emprestimo_id FOR UPDATE;
  IF NOT FOUND OR v_emp.status <> 'Aprovado' OR v_emp.arquivado_em IS NOT NULL THEN
    RAISE EXCEPTION 'O contrato desta parcela não está vivo.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (public.auth_in_setor('financeiro') OR public.auth_gerente_da(v_emp.filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da unidade antecipam parcela.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_emp.filial), false) THEN
    RAISE EXCEPTION 'Contrato de outra unidade.' USING ERRCODE = '42501';
  END IF;

  IF v_p.contas_pagar_id IS NULL THEN
    RAISE EXCEPTION 'Esta parcela não tem título a pagar — é histórico de turma anterior.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_cp FROM public.contas_pagar WHERE id = v_p.contas_pagar_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_cp.ativo, true) THEN
    RAISE EXCEPTION 'O título desta parcela não existe mais.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cp.status <> 'Pendente' THEN
    RAISE EXCEPTION 'O título desta parcela está %, e antecipação só vale para título em aberto e sem baixa.',
      lower(v_cp.status) USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(principal), 0) INTO v_baixado
    FROM public.contas_pagar_baixas WHERE conta_id = v_cp.id;
  IF v_baixado > 0 THEN
    RAISE EXCEPTION 'Esta parcela já recebeu pagamento parcial — quite o que falta em Contas a pagar.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Fuga da multa: antecipar a 5 com a 3 vencida seria escolher qual dívida
  -- pagar para não encarar o atraso.
  SELECT COUNT(*) INTO v_vencidas
    FROM public.parcelas_emprestimo pe
    JOIN public.contas_pagar c ON c.id = pe.contas_pagar_id
   WHERE pe.emprestimo_id = v_emp.id
     AND pe.status <> 'Paga'
     AND c.status <> 'Pago'
     AND c.vencimento < v_hoje;
  IF v_vencidas > 0 THEN
    RAISE EXCEPTION 'Há % parcela(s) vencida(s) neste contrato. Coloque o contrato em dia antes de antecipar.',
      v_vencidas USING ERRCODE = 'P0001';
  END IF;

  SELECT bloqueado INTO v_bloqueado
    FROM public.calcular_saldo_capital(v_emp.filial) LIMIT 1;
  IF COALESCE(v_bloqueado, false) THEN
    RAISE EXCEPTION 'O capital da unidade está estourado. Antecipar é escolha, e ela não se faz no vermelho — pague o que vence e recomponha o caixa primeiro.'
      USING ERRCODE = 'P0001';
  END IF;

  v_i := COALESCE(v_emp.taxa_juros, 0) / 100;
  IF v_i <= 0 THEN
    RAISE EXCEPTION 'Contrato sem juros: não há juro futuro para descontar. Pague a parcela normalmente em Contas a pagar.'
      USING ERRCODE = 'P0001';
  END IF;

  v_meses := (EXTRACT(YEAR FROM age(v_cp.vencimento, v_hoje)) * 12
              + EXTRACT(MONTH FROM age(v_cp.vencimento, v_hoje)))::int;
  IF v_meses < 1 THEN
    RAISE EXCEPTION 'Esta parcela vence em menos de um mês — não há mês cheio de juro para descontar. Pague-a normalmente em Contas a pagar.'
      USING ERRCODE = 'P0001';
  END IF;

  v_pv       := ROUND(v_cp.valor / power(1 + v_i, v_meses), 2);
  v_desconto := ROUND(v_cp.valor - v_pv, 2);
  IF v_desconto <= 0 THEN
    RAISE EXCEPTION 'O desconto calculado ficou em zero — nada a antecipar.' USING ERRCODE = 'P0001';
  END IF;

  -- Amortização não muda: o principal devido é o mesmo. Quem encolhe é o juro.
  v_juros_novo := GREATEST(ROUND(COALESCE(v_p.juros, 0) - v_desconto, 2), 0);

  v_sufixo := ' · antecipada ' || v_meses || ' mês(es), desconto ' || public.brl(v_desconto);

  UPDATE public.contas_pagar
     SET valor      = v_pv,
         descricao  = descricao || v_sufixo,
         updated_at = now()
   WHERE id = v_cp.id;

  -- A Matriz recebe menos, na mesma medida. O desconto é transferência.
  IF v_p.contas_receber_id IS NOT NULL THEN
    UPDATE public.contas_receber
       SET valor      = v_pv,
           descricao  = descricao || v_sufixo,
           updated_at = now()
     WHERE id = v_p.contas_receber_id
       -- Domínio da coluna é Aberto/Parcial/Pago/Atrasado/Cancelado: título já
       -- recebido ou cancelado não se mexe.
       AND status NOT IN ('Pago', 'Cancelado');
  END IF;

  UPDATE public.parcelas_emprestimo
     SET valor_parcela = v_pv,
         juros         = v_juros_novo
   WHERE id = v_p.id;

  -- A baixa vai pela porta de sempre: mesmas validações de banco e de filial,
  -- mesmo registro em contas_pagar_baixas, mesmo efeito no saldo do caixa.
  -- O status da parcela vira 'Paga' pelo gatilho da 615.
  PERFORM public.baixar_conta_pagar(v_cp.id, p_banco_id, v_pv);

  SELECT nome, setor INTO v_ator, v_setor FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.historico_operacoes
    (entidade, entidade_id, filial, evento, de, para, detalhe, ator_id, ator_nome, ator_setor)
  VALUES (
    'parcelas_emprestimo', v_p.id, v_emp.filial, 'Antecipada',
    public.brl(v_cp.valor), public.brl(v_pv),
    'Parcela ' || v_p.num_parcela || '/' || v_emp.num_parcelas
      || ' antecipada em ' || v_meses || ' mês(es): desconto de ' || public.brl(v_desconto)
      || ' (juro que deixou de correr, '
      || replace(v_emp.taxa_juros::text, '.', ',') || '% a.m.).'
      || ' Juro da parcela caiu de ' || public.brl(COALESCE(v_p.juros, 0))
      || ' para ' || public.brl(v_juros_novo) || '; a amortização não muda.',
    auth.uid(), v_ator, v_setor
  );

  RETURN jsonb_build_object(
    'parcela',        v_p.num_parcela,
    'valor_original', v_cp.valor,
    'valor_pago',     v_pv,
    'desconto',       v_desconto,
    'meses',          v_meses,
    'juros_antes',    COALESCE(v_p.juros, 0),
    'juros_depois',   v_juros_novo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.antecipar_parcela_emprestimo(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.antecipar_parcela_emprestimo(uuid, uuid) TO authenticated;

COMMIT;
