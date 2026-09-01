-- 572_20260901_o_emprestimo_e_historico_da_unidade_nao_exercicio_da_turma.sql
--
-- O empréstimo da Matriz para a unidade sai das duas réguas de reset. Mesma
-- decisão que a 504 tomou para o Registro de Ponto e a 514 para a Folha: o
-- contrato é histórico da UNIDADE — quanto ela pediu, a que taxa, em quantas
-- parcelas, quem aprovou e por quê. Refazer isso a cada turma não ensina nada;
-- perder isso apaga a única memória de que a unidade um dia se endividou.
--
-- A partir daqui só some se o professor mandar sumir, um a um, pelo botão novo
-- em Capital da Matriz → Empréstimos.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ATRAVESSA E O QUE CONTINUA SAINDO
-- ────────────────────────────────────────────────────────────────────────────
-- ATRAVESSA:  `emprestimos_filial` e `parcelas_emprestimo` — o contrato e a
--             tabela de amortização (juros, amortização e saldo devedor de
--             cada parcela, migr. 416). As parcelas SÃO o empréstimo, do mesmo
--             jeito que `folha_rubricas` é a folha: preservar o contrato e
--             jogar fora a Price deixaria o número sem como se explicar.
--
-- CONTINUA SAINDO: os TÍTULOS. `contas_pagar` da filial e `contas_receber` da
--             Matriz são o exercício da turma — ela lança, aprova, paga. Saem
--             junto com todo o resto do financeiro, exatamente como a 514
--             decidiu para a conta a pagar da folha.
--
-- Então o empréstimo preservado atravessa QUITADO, não devendo. As duas
-- colunas de ligação da parcela (`contas_pagar_id`, `contas_receber_id`)
-- voltam NULL, que é a verdade: o título não existe mais.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE PRECISA DE SNAPSHOT NO APAGAR TUDO
-- ────────────────────────────────────────────────────────────────────────────
-- Tirar `emprestimos_filial` da lista do TRUNCATE não basta. `parcelas_empres-
-- timo` referencia `contas_pagar` e `contas_receber`, e as duas continuam na
-- lista — e TRUNCATE ... CASCADE trunca TODA tabela que referencia a truncada,
-- sem olhar o ON DELETE. As duas FKs são ON DELETE SET NULL e mesmo assim o
-- CASCADE levaria as parcelas inteiras.
--
-- Saída: fotografar `parcelas_emprestimo` numa temp ANTES do TRUNCATE e
-- reinserir depois com as duas colunas de título em NULL. Nenhuma alternativa
-- era melhor: tirar contas_pagar/contas_receber do TRUNCATE arrastaria as
-- baixas e todo o resto do grafo; derrubar as FKs perderia o rastro que a
-- 326 criou de propósito.
--
-- ────────────────────────────────────────────────────────────────────────────
-- `arquivado_em` — POR QUE UMA COLUNA E NÃO O CARIMBO DA TURMA
-- ────────────────────────────────────────────────────────────────────────────
-- `calcular_saldo_capital` soma os empréstimos APROVADOS como capital da
-- unidade (`v_emprest`) e os desconta do capital próprio da Matriz
-- (`v_emp_out`). Um empréstimo preservado que continuasse contando daria à
-- turma nova capital que ela não tem: o caixa foi zerado, os títulos sumiram,
-- e o número na tela seguiria dizendo que há dinheiro.
--
-- A 514 resolveu o equivalente com `ponto_corte_turma()`. Aqui o carimbo não
-- serve, e o motivo é o reset POR UNIDADE: ele não carimba corte nenhum (o
-- corte é global e zerar a MaxLook não encerra a turma da TechMax, vide 505).
-- Uma unidade zerada no meio da turma precisa que os empréstimos DELA parem de
-- contar, e só dela. Isso é por linha, não por data.
--
-- Daí `emprestimos_filial.arquivado_em`: carimbado pelos dois resets nas linhas
-- que eles preservam. Empréstimo arquivado
--   · não conta capital para ninguém (nem para a unidade, nem contra a Matriz);
--   · não aceita UPDATE — nem aprovar, nem negar, nem reescrever valor;
--   · continua visível nas duas telas, marcado como histórico;
--   · e é o único que o professor pode apagar (a válvula, abaixo).
--
-- BEFORE UPDATE e não policy de RLS: `aprovar_emprestimo` e `negar_emprestimo`
-- são SECURITY DEFINER e passariam por cima da RLS
-- (vide [[feedback_secdef_ignora_rls_nao_trigger]]). Gatilho pega todo mundo.
-- O nome começa com 'a' de propósito: gatilho de mesma tabela dispara em ordem
-- alfabética, e este tem de vir antes de `trg_emprestimo_valida_condicoes`
-- (vide [[feedback_trigger_ordem_alfabetica]]).
--
-- ────────────────────────────────────────────────────────────────────────────
-- A VÁLVULA DO PROFESSOR: `apagar_emprestimo`
-- ────────────────────────────────────────────────────────────────────────────
-- Não existe policy PERMISSIVE de DELETE em `emprestimos_filial` (só a
-- RESTRICTIVE de desligado), então pelo PostgREST ninguém apaga — nem o admin.
-- A válvula tem de ser RPC.
--
-- `role = 'admin'` LITERAL, jamais `auth_is_admin()`: esse helper inclui ceo,
-- conselheiro e gerente-conselheiro, que são ALUNOS
-- (vide [[feedback_auth_is_admin_inclui_alunos]]). Mesma linha da 412 e da 485,
-- COALESCE incluído — `NULL NOT IN (...)` é NULL e o guard sumiria
-- (vide [[feedback_assert_rpc_null]]).
--
-- A RPC RECUSA empréstimo aprovado que ainda esteja VIVO (não arquivado), pelo
-- mesmo motivo que a 326 proibiu deletar aporte que moveu dinheiro: apagar a
-- linha não devolve o saldo à conta de origem da Matriz, e o dinheiro ficaria
-- no caixa da filial vindo do nada. Para desfazer um empréstimo vivo o caminho
-- é o financeiro, não a borracha. Pendente, Negado e qualquer arquivado saem.
--
-- Apagar leva junto, na mesma transação: as parcelas (CASCADE) e os títulos
-- que ainda existirem dos dois lados. Os ids dos títulos são fotografados
-- ANTES do DELETE do empréstimo — é a lição da 485: quem some primeiro leva a
-- informação de quem devia sair depois.
--
-- ────────────────────────────────────────────────────────────────────────────
-- NOTA SOBRE OS CORPOS
-- ────────────────────────────────────────────────────────────────────────────
-- Copiados de `prosrc`, não dos arquivos antigos. md5 idêntico nos 4 projetos
-- ANTES desta migração:
--   resetar_dados_operacionais  26854216d49692c1522b4957cd89591f
--   resetar_dados_da_filial     36cd2315e5d1a7ca8628aebfbcf26546
--   calcular_saldo_capital      1ab988165e19f86c797e15c048619f84
--
-- Não recupera empréstimo já apagado: TRUNCATE não deixa rastro.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) A coluna que separa contrato vivo de contrato encerrado
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.emprestimos_filial
  ADD COLUMN IF NOT EXISTS arquivado_em timestamptz;

COMMENT ON COLUMN public.emprestimos_filial.arquivado_em IS
  'Migr. 572 — carimbado pelos dois resets nos empréstimos que eles preservam. Arquivado = histórico fechado: não conta capital, não aceita UPDATE, e é o único que o professor pode apagar por apagar_emprestimo().';

CREATE INDEX IF NOT EXISTS idx_emprestimos_filial_vivos
  ON public.emprestimos_filial (filial, status)
  WHERE arquivado_em IS NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- 2) Histórico fechado não se reescreve
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.emprestimo_arquivado_e_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.arquivado_em IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Este empréstimo de % (R$ %) é histórico fechado — foi preservado num reset e virou consulta. Não se aprova, não se nega e não se reescreve. Para tirá-lo do sistema, o administrador usa o botão de excluir em Capital da Matriz.',
    OLD.filial, public.brl(OLD.valor)
    USING ERRCODE = 'P0001';
END;
$function$;

COMMENT ON FUNCTION public.emprestimo_arquivado_e_historico() IS
  'Migr. 572 — empréstimo com arquivado_em preenchido é só leitura. DELETE segue por apagar_emprestimo() (válvula do professor).';

DROP TRIGGER IF EXISTS trg_emprestimo_arquivado_historico ON public.emprestimos_filial;
CREATE TRIGGER trg_emprestimo_arquivado_historico
  BEFORE UPDATE ON public.emprestimos_filial
  FOR EACH ROW EXECUTE FUNCTION public.emprestimo_arquivado_e_historico();


-- A parcela de um empréstimo arquivado também não se reescreve. A exceção é o
-- SET NULL que a FK dispara quando o título é apagado: isso É um UPDATE na
-- parcela, vem do próprio reset, e não é a turma mexendo em nada.
CREATE OR REPLACE FUNCTION public.parcela_emprestimo_arquivada_e_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_arquivado timestamptz;
BEGIN
  SELECT arquivado_em INTO v_arquivado
    FROM public.emprestimos_filial WHERE id = OLD.emprestimo_id;

  IF v_arquivado IS NULL THEN
    RETURN NEW;
  END IF;

  -- Só as duas colunas de título mudaram, e para NULL: é a FK cortando o elo.
  IF NEW.emprestimo_id       IS NOT DISTINCT FROM OLD.emprestimo_id
     AND NEW.num_parcela     IS NOT DISTINCT FROM OLD.num_parcela
     AND NEW.valor_parcela   IS NOT DISTINCT FROM OLD.valor_parcela
     AND NEW.data_vencimento IS NOT DISTINCT FROM OLD.data_vencimento
     AND NEW.status          IS NOT DISTINCT FROM OLD.status
     AND NEW.juros           IS NOT DISTINCT FROM OLD.juros
     AND NEW.amortizacao     IS NOT DISTINCT FROM OLD.amortizacao
     AND NEW.saldo_devedor   IS NOT DISTINCT FROM OLD.saldo_devedor
     AND NEW.contas_pagar_id   IS NULL
     AND NEW.contas_receber_id IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Parcela % é de um empréstimo arquivado: histórico fechado, preservado num reset. Não se reescreve.',
    OLD.num_parcela USING ERRCODE = 'P0001';
END;
$function$;

COMMENT ON FUNCTION public.parcela_emprestimo_arquivada_e_historico() IS
  'Migr. 572 — parcela de empréstimo arquivado é só leitura, exceto o SET NULL das colunas de título disparado pela FK quando a conta a pagar/receber é apagada.';

DROP TRIGGER IF EXISTS trg_parcela_emprestimo_arquivada_historico ON public.parcelas_emprestimo;
CREATE TRIGGER trg_parcela_emprestimo_arquivada_historico
  BEFORE UPDATE ON public.parcelas_emprestimo
  FOR EACH ROW EXECUTE FUNCTION public.parcela_emprestimo_arquivada_e_historico();


-- ════════════════════════════════════════════════════════════════════════════
-- 3) Capital: empréstimo arquivado não é capital de ninguém
-- ════════════════════════════════════════════════════════════════════════════
-- Duas linhas mudam, e são as duas pontas do mesmo par: `v_emprest` (o que a
-- unidade recebeu) e `v_emp_out` (o que a holding empurrou). `v_emp_back` e
-- `v_juros_in` leem `contas_receber`, que o reset apaga — nada a fazer lá.
CREATE OR REPLACE FUNCTION public.calcular_saldo_capital(p_filial text)
 RETURNS TABLE(capital_total numeric, despesas_pagas numeric, despesas_operacionais numeric, despesas_financeiras numeric, receitas_pagas numeric, lucro_operacional numeric, lucro_liquido numeric, reserva_valor numeric, reserva_pct numeric, saldo_livre numeric, saldo_real numeric, bloqueado boolean, em_reserva boolean, data_inicio date, data_fim date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg          RECORD;
  v_capital      numeric := 0;
  v_emprest      numeric := 0;
  v_saida_hold   numeric := 0;
  v_aporte_out   numeric := 0;
  v_emp_out      numeric := 0;
  v_emp_back     numeric := 0;
  v_juros_in     numeric := 0;
  v_dividendo_in numeric := 0;
  v_desp_op      numeric := 0;
  v_juros_pago   numeric := 0;
  v_amort_paga   numeric := 0;
  v_distribuido  numeric := 0;
  v_receitas     numeric := 0;
  v_reserva_pct  numeric := 0;
  v_reserva_val  numeric := 0;
  v_saldo_real   numeric := 0;
  v_saldo_livre  numeric := 0;
  v_desp_total   numeric := 0;
  v_lucro_op     numeric := 0;
  v_lucro_liq    numeric := 0;
BEGIN
  PERFORM public._assert_rpc();
  SELECT * INTO v_cfg FROM public.capital_config
   ORDER BY created_at DESC LIMIT 1;

  SELECT COALESCE(SUM(valor), 0) INTO v_capital
    FROM public.capital_filial
   WHERE filial = p_filial
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  -- (572) `arquivado_em IS NULL`: empréstimo preservado por reset é histórico,
  -- não capital. O caixa foi zerado e os títulos apagados junto.
  SELECT COALESCE(SUM(valor), 0) INTO v_emprest
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND status = 'Aprovado'
     AND arquivado_em IS NULL
     AND (v_cfg IS NULL OR created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  IF p_filial = 'Matriz' THEN
    SELECT COALESCE(SUM(cf.valor), 0) INTO v_aporte_out
      FROM public.capital_filial cf
     WHERE cf.filial <> 'Matriz'
       AND (v_cfg IS NULL OR cf.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cf.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    -- (572) A outra ponta do mesmo par: se não conta como capital da unidade,
    -- não pode continuar descontando do capital próprio da holding.
    SELECT COALESCE(SUM(e.valor), 0) INTO v_emp_out
      FROM public.emprestimos_filial e
     WHERE e.status = 'Aprovado'
       AND e.arquivado_em IS NULL
       AND (v_cfg IS NULL OR e.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR e.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    SELECT COALESCE(SUM(COALESCE(pe.amortizacao, cr.valor)), 0),
           COALESCE(SUM(COALESCE(pe.juros, 0)), 0)
      INTO v_emp_back, v_juros_in
      FROM public.contas_receber cr
      LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_receber_id = cr.id
     WHERE cr.filial = 'Matriz' AND cr.origem = 'emprestimo'
       AND cr.status IN ('Pago', 'Recebido')
       AND COALESCE(cr.ativo, true) = true
       AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    SELECT COALESCE(SUM(d.valor), 0) INTO v_dividendo_in
      FROM public.distribuicoes_lucro d
     WHERE d.ativo = true
       AND (v_cfg IS NULL OR d.created_at >= v_cfg.data_inicio::timestamptz)
       AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR d.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

    v_saida_hold := v_aporte_out + v_emp_out - v_emp_back;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN cp.status = 'Pago' THEN cp.valor ELSE COALESCE(cp.valor_pago, 0) END), 0) INTO v_desp_op
    FROM public.contas_pagar cp
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND COALESCE(cp.origem, '') <> 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.juros, 0)
                ELSE ROUND(COALESCE(pe.juros, 0)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0),
         COALESCE(SUM(
           CASE WHEN cp.status = 'Pago' THEN COALESCE(pe.amortizacao, cp.valor)
                ELSE ROUND(COALESCE(pe.amortizacao, cp.valor)
                           * COALESCE(cp.valor_pago, 0) / NULLIF(cp.valor, 0), 2) END), 0)
    INTO v_juros_pago, v_amort_paga
    FROM public.contas_pagar cp
    LEFT JOIN public.parcelas_emprestimo pe ON pe.contas_pagar_id = cp.id
   WHERE cp.filial = p_filial AND cp.status IN ('Pago', 'Parcial')
     AND COALESCE(cp.ativo, true) = true
     AND cp.origem = 'emprestimo'
     AND (v_cfg IS NULL OR cp.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cp.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(d.valor), 0) INTO v_distribuido
    FROM public.distribuicoes_lucro d
   WHERE d.filial = p_filial AND d.ativo = true
     AND (v_cfg IS NULL OR d.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR d.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  SELECT COALESCE(SUM(cr.valor), 0) INTO v_receitas
    FROM public.contas_receber cr
   WHERE cr.filial = p_filial
     AND cr.status IN ('Pago', 'Recebido')
     AND COALESCE(cr.ativo, true) = true
     AND NOT (p_filial = 'Matriz' AND COALESCE(cr.origem, '') = 'emprestimo')
     AND (v_cfg IS NULL OR cr.created_at >= v_cfg.data_inicio::timestamptz)
     AND (v_cfg IS NULL OR v_cfg.data_fim IS NULL OR cr.created_at <= (v_cfg.data_fim + interval '1 day')::timestamptz);

  v_receitas    := v_receitas + v_juros_in + v_dividendo_in;

  v_capital     := v_capital - v_saida_hold;
  v_desp_total  := v_desp_op + v_juros_pago + v_amort_paga;
  v_reserva_pct := COALESCE(v_cfg.reserva_min_pct, 0);
  v_reserva_val := ROUND((v_capital + v_emprest) * v_reserva_pct / 100, 2);
  v_saldo_real  := (v_capital + v_emprest) - v_desp_total - v_distribuido;
  v_saldo_livre := v_saldo_real - v_reserva_val;
  v_lucro_op    := v_receitas - v_desp_op;
  v_lucro_liq   := v_lucro_op - v_juros_pago - v_reserva_val;

  RETURN QUERY SELECT
    (v_capital + v_emprest),
    v_desp_total,
    v_desp_op,
    v_juros_pago,
    v_receitas,
    v_lucro_op,
    v_lucro_liq,
    v_reserva_val,
    v_reserva_pct,
    v_saldo_livre,
    v_saldo_real,
    (v_saldo_real < 0),
    (v_saldo_livre <= 0 AND v_saldo_real >= 0),
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_inicio ELSE public.acre_today() END,
    CASE WHEN v_cfg IS NOT NULL THEN v_cfg.data_fim ELSE NULL END;
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 4) APAGAR TUDO (global) — o contrato fica, os títulos vão
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resetar_dados_operacionais()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_usuarios_preservados int;
  v_corte date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
BEGIN
  IF auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin e CEO podem executar este reset.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM desenvolvimentos_ia WHERE id IS NOT NULL;
  DELETE FROM avaliacoes WHERE tipo IS DISTINCT FROM 'matriz_filial';
  UPDATE caixa_bancos SET saldo = 0 WHERE saldo IS DISTINCT FROM 0;

  -- (572) A foto das parcelas, ANTES do TRUNCATE. `parcelas_emprestimo`
  -- referencia contas_pagar e contas_receber, que continuam na lista, e
  -- TRUNCATE ... CASCADE trunca quem referencia sem olhar o ON DELETE
  -- (as duas FKs sao SET NULL e mesmo assim a tabela inteira iria junto).
  DROP TABLE IF EXISTS _reset_parcelas_emprestimo;
  CREATE TEMP TABLE _reset_parcelas_emprestimo ON COMMIT DROP AS
    SELECT * FROM public.parcelas_emprestimo;

  TRUNCATE TABLE
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    contas_receber, contas_pagar, previsoes, duplicatas, filial_investimentos,
    integracoes_bancarias, controle_caixa,
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam daqui: sao o historico de frequencia, do
    -- mesmo lado de frequencia_trabalho. As duas ultimas ficam porque o
    -- CASCADE e o gatilho de reversao levariam o ponto junto.
    -- (514) folha_pagamento saiu daqui, e com ela folha_rubricas e
    -- folha_credito_falhas, que morriam pelo CASCADE: o holerite e historico da
    -- pessoa (e a base do FGTS acumulado), nao exercicio da turma. contas_pagar
    -- continua na lista -- o lancamento financeiro da folha e' que e' exercicio.
    -- (572) emprestimos_filial saiu daqui, e com ela parcelas_emprestimo (esta
    -- por foto, logo abaixo): o contrato e a tabela de amortizacao sao
    -- historico da UNIDADE. Os TITULOS continuam saindo -- contas_pagar da
    -- filial e contas_receber da Matriz sao o exercicio da turma, mesma regua
    -- da folha. O emprestimo preservado atravessa quitado, nao devendo, e
    -- recebe `arquivado_em` para parar de contar como capital.
    ferias,
    beneficios_pendentes,
    treinamento_inscricoes,
    pesquisa_resposta_itens, pesquisa_respostas, pesquisa_perguntas, pesquisas,
    marketing_arte_feedback, marketing_artes, marketing_tarefas,
    marketing_promocoes, marketing_calendario, marketing_cupons,
    marketing_campanhas, itens_campanha,
    orcamentos, pedidos_venda,
    maxbank_transacoes, maxbank_transferencias,
    maxbank_folgas_conquistadas, maxbank_metas,
    tarefas_taticas, tarefas, metas_estrategicas,
    ti_chamados,
    relatorios_bi, briefings_diarios, notificacoes, feedbacks_organizacao,
    votacoes_votos, votacoes,
    capital_filial, requerimentos,
    orcamentos_periodo, prestacoes_contas, destinacoes_resultado,
    apuracoes_bonus, politicas_remuneracao, mandatos, riscos,
    auditoria_revisoes,
    -- (504) `documentos` e `documentos_leitura` (migr. 476) NUNCA estiveram
    -- nesta lista, e agora isso esta escrito: o material que o professor
    -- publica e dele, nao da turma -- refazer o upload a cada turma seria
    -- trabalho repetido sem nada didatico dentro. Ficam de fora por decisao,
    -- nao por esquecimento, que e o que a licao das 12 tabelas orfas entre a
    -- 377 e a 392 pede. Nada truncado aqui as referencia (as maes sao
    -- `user_profiles`), entao nenhum CASCADE as alcanca.
    -- (514) Mesma nota para `departamentos`, `cargos` e `centros_custo`: nunca
    -- estiveram aqui e nenhum CASCADE as alcanca (quem e' truncada sao as
    -- FILHAS de centros_custo, e TRUNCATE CASCADE desce, nao sobe). Sao a
    -- estrutura da empresa, montada uma vez; a contagem no retorno deixa isso
    -- conferivel.
    -- (482) fornecedores saiu daqui: fundo de cadastro, nao exercicio.
    produtos, servicos, clientes,
    projetos,
    -- (486) Rascunho do botao "Gerar" (481). Mesma decisao da 485.
    produtos_codigo_reserva,
    -- (482) categorias_produto/subcategorias_produto sairam daqui: a categoria
    -- carrega o markup-alvo (360). O orcamento POR categoria continua zerando.
    orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

  -- (572) O contrato sobreviveu ao TRUNCATE; agora vira historico fechado.
  -- Feito ANTES de repor as parcelas de proposito: assim a reinsercao ja
  -- acontece com o emprestimo arquivado, e o gatilho da parcela nao tem de
  -- distinguir nada (ele so olha UPDATE).
  UPDATE public.emprestimos_filial
     SET arquivado_em = now()
   WHERE arquivado_em IS NULL;

  -- Os dois ids de titulo voltam NULL: a conta a pagar da filial e a conta a
  -- receber da Matriz foram apagadas acima, e a parcela nao pode apontar para
  -- o que nao existe mais.
  INSERT INTO public.parcelas_emprestimo
    (id, emprestimo_id, num_parcela, valor_parcela, data_vencimento, status,
     contas_pagar_id, contas_receber_id, created_at, juros, amortizacao, saldo_devedor)
  SELECT id, emprestimo_id, num_parcela, valor_parcela, data_vencimento, status,
         NULL, NULL, created_at, juros, amortizacao, saldo_devedor
    FROM _reset_parcelas_emprestimo;

  DROP TABLE IF EXISTS _reset_parcelas_emprestimo;

  -- (505) A virada de turma. `configuracoes` sobrevive ao reset desde a 377,
  -- entao o carimbo fica de pe para a turma nova. Daqui para tras o ponto e da
  -- turma passada: nao conta na folha e nao se reescreve.
  -- (514) O mesmo carimbo fecha a folha preservada para escrita.
  INSERT INTO public.configuracoes (chave, valor, updated_at)
  VALUES ('ponto_corte_turma', v_corte::text, now())
  ON CONFLICT (chave) DO UPDATE
     SET valor = EXCLUDED.valor, updated_at = now();

  SELECT count(*) INTO v_usuarios_preservados FROM user_profiles;

  RETURN jsonb_build_object(
    'sucesso',                  true,
    'usuarios_preservados',     v_usuarios_preservados,
    'funcionarios_preservados', (SELECT count(*) FROM funcionarios),
    'carteiras_preservadas',    (SELECT count(*) FROM maxbank_contas),
    'filiais_preservadas',      (SELECT count(*) FROM filiais),
    'frequencia_preservada',    (SELECT count(*) FROM frequencia_trabalho),
    -- (504) O relatorio ja dizia 'frequencia_preservada' enquanto truncava o
    -- ponto. Agora o numero do ponto aparece ao lado, e a conferencia e visual.
    'ponto_preservado',         (SELECT count(*) FROM ponto_eletronico),
    'afastamentos_preservados', (SELECT count(*) FROM afastamentos),
    'justificativas_preservadas', (SELECT count(*) FROM justificativas_falta),
    'documentos_preservados',   (SELECT count(*) FROM documentos WHERE COALESCE(ativo, true)),
    -- (514) A folha e os cadastros de estrutura, pelo mesmo motivo: o numero no
    -- retorno e a unica conferencia que o professor tem depois do TRUNCATE.
    'folha_preservada',         (SELECT count(*) FROM folha_pagamento WHERE COALESCE(ativo, true)),
    'rubricas_preservadas',     (SELECT count(*) FROM folha_rubricas),
    'departamentos_preservados',(SELECT count(*) FROM departamentos),
    'cargos_preservados',       (SELECT count(*) FROM cargos),
    'centros_custo_preservados',(SELECT count(*) FROM centros_custo),
    -- (572) Idem emprestimo: o numero preservado ao lado do numero de parcelas
    -- e a unica conferencia depois do TRUNCATE.
    'emprestimos_preservados',  (SELECT count(*) FROM emprestimos_filial),
    'parcelas_emprestimo_preservadas', (SELECT count(*) FROM parcelas_emprestimo),
    'corte_turma',              v_corte,
    'competicoes_preservadas',  (SELECT count(*) FROM competicoes_matriz),
    'notas_placar_preservadas', (SELECT count(*) FROM avaliacoes WHERE tipo = 'matriz_filial'),
    'avaliacoes_matriz_preservadas', (SELECT count(*) FROM avaliacoes_matriz),
    'tarefas_matriz_preservadas',    (SELECT count(*) FROM matriz_tarefas),
    'treinamentos_preservados', (SELECT count(*) FROM treinamentos),
    'fornecedores_preservados', (SELECT count(*) FROM fornecedores WHERE ativo IS DISTINCT FROM false),
    'categorias_preservadas',   (SELECT count(*) FROM categorias_produto WHERE ativo IS DISTINCT FROM false),
    'contas_bancarias_zeradas', (SELECT count(*) FROM caixa_bancos),
    'executado_em',             now()
  );
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 5) ZERAR UMA UNIDADE (por filial) — mesma régua
-- ════════════════════════════════════════════════════════════════════════════
-- `parcelas_emprestimo` e `emprestimos_filial` saem de `v_alvos`. O que entra
-- no lugar é o carimbo de `arquivado_em` nos empréstimos daquela unidade, no
-- fim da execução real.
--
-- `_reset_cr_matriz` continua sendo fotografado antes do laço, e continua
-- fazendo falta: ele é o motivo da 485. As contas a receber da Matriz seguem
-- sendo apagadas — o exercício é da turma, o contrato é da unidade.
--
-- O estorno ganha `arquivado_em IS NULL`: sem isso, zerar a mesma unidade duas
-- vezes devolveria o mesmo dinheiro à Matriz duas vezes, agora que o
-- empréstimo sobrevive à primeira passagem.
CREATE OR REPLACE FUNCTION public.resetar_dados_da_filial(p_filial text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_alvos text[][] := ARRAY[
    ['itens_venda','venda_id IN (SELECT id FROM public.vendas WHERE filial = $1)'],
    ['notas_emitidas','filial = $1'],
    ['devolucoes','filial = $1'],
    ['itens_devolucao','devolucao_id IN (SELECT id FROM public.devolucoes WHERE filial = $1)'],
    ['vendas','filial = $1'],
    ['pix_pendentes','filial = $1'],
    ['cartao_pendentes','filial = $1'],
    ['beneficios_pendentes','filial_pdv = $1'],
    ['pedidos_online_itens','pedido_id IN (SELECT id FROM public.pedidos_online WHERE filial = $1)'],
    ['pedidos_online','filial = $1'],
    ['movimentacoes_estoque','filial = $1'],
    ['produto_unidades','filial = $1'],
    ['vencimentos_estoque','filial = $1'],
    ['inventarios','filial = $1'],
    ['expedicao','filial = $1'],
    ['requisicoes_estoque','filial = $1'],
    ['aprovacoes_estoque','filial = $1'],
    ['consumos_material','filial = $1'],
    ['devolucoes_fornecedor','filial = $1'],
    ['notas_recebidas','filial = $1'],
    ['recebimentos','filial = $1'],
    ['pedidos','filial = $1'],
    ['cotacoes','filial = $1'],
    ['aprovacoes_compras','filial = $1'],
    ['requisicoes','filial = $1'],
    -- (572) parcelas_emprestimo saiu daqui: e' a tabela de amortizacao, parte
    -- do contrato. Sai do reset junto com `emprestimos_filial`, logo abaixo.
    -- A FK ON DELETE SET NULL corta o elo com o titulo quando ele e' apagado.
    ['contas_receber','id IN (SELECT id FROM _reset_cr_matriz)'],
    ['contas_receber_baixas','filial = $1'],
    ['contas_pagar_baixas','filial = $1'],
    ['rateio_administrativo_itens','filial = $1'],
    -- (514) folha_credito_falhas saiu daqui: e' filha de folha_pagamento, que
    -- agora fica. Preservar a folha e apagar o registro do credito que falhou
    -- deixaria a linha preservada sem como explicar o proprio estado.
    ['contas_receber','filial = $1'],
    ['contas_pagar','filial = $1'],
    ['filial_investimentos','filial = $1'],
    ['previsoes','filial = $1'],
    ['duplicatas','filial = $1'],
    ['integracoes_bancarias','filial = $1'],
    ['movimentacoes_caixa','filial = $1'],
    ['controle_caixa_reaberturas','filial = $1'],
    ['controle_caixa','filial = $1'],
    -- (572) emprestimos_filial saiu daqui: o contrato e' historico da unidade,
    -- nao exercicio da turma. No lugar do DELETE vem o carimbo de
    -- `arquivado_em`, no fim da execucao real -- e e' ele que tira o
    -- emprestimo da conta de capital, ja que o reset por unidade nao carimba
    -- corte de turma nenhum (505).
    ['capital_filial','filial = $1'],
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam da regua: historico de frequencia fica.
    -- (514) folha_rubricas e folha_pagamento sairam pelo mesmo motivo: o
    -- holerite e historico da pessoa. A conta a pagar da folha continua saindo
    -- (`contas_pagar`, acima) -- o financeiro e' que e' exercicio da turma.
    ['maxbank_folgas_conquistadas','colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['ferias','filial = $1'],
    ['treinamento_inscricoes','funcionario_id IN (SELECT id FROM public.funcionarios WHERE filial = $1)'],
    ['pesquisa_resposta_itens','resposta_id IN (SELECT r.id FROM public.pesquisa_respostas r JOIN public.pesquisas p ON p.id = r.pesquisa_id WHERE p.filial = $1)'],
    ['pesquisa_respostas','pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisa_perguntas','pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisas','filial = $1'],
    ['marketing_arte_feedback','arte_id IN (SELECT id FROM public.marketing_artes WHERE filial = $1)'],
    ['marketing_artes','filial = $1'],
    ['marketing_tarefas','filial = $1'],
    ['marketing_promocoes','filial = $1'],
    ['marketing_calendario','filial = $1'],
    ['marketing_cupons','filial = $1'],
    ['itens_campanha','campanha_id IN (SELECT id FROM public.marketing_campanhas WHERE filial = $1)'],
    ['marketing_campanhas','filial = $1'],
    ['orcamentos','filial = $1'],
    ['pedidos_venda','filial = $1'],
    ['maxbank_transacoes','conta_id IN (SELECT c.id FROM public.maxbank_contas c JOIN public.user_profiles u ON u.id = c.colaborador_id WHERE u.filial = $1)'],
    ['maxbank_transferencias','de_colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1) OR para_colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['maxbank_metas','filial = $1'],
    ['tarefas_taticas','meta_estrategica_id IN (SELECT m.id FROM public.metas_estrategicas m JOIN public.user_profiles u ON u.id = m.criada_por WHERE u.filial = $1)'],
    ['metas_estrategicas','criada_por IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['tarefas','filial = $1'],
    ['ti_chamados','filial = $1'],
    ['notificacoes','filial = $1'],
    ['requerimentos','filial = $1'],
    ['votacoes_votos','votacao_id IN (SELECT v.id FROM public.votacoes v JOIN public.user_profiles u ON u.id = v.criador_id WHERE u.filial = $1)'],
    ['votacoes','criador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['orcamento_itens','orcamento_id IN (SELECT id FROM public.orcamentos_periodo WHERE filial = $1)'],
    ['orcamentos_periodo','filial = $1'],
    ['prestacao_pareceres','prestacao_id IN (SELECT id FROM public.prestacoes_contas WHERE filial = $1)'],
    ['prestacoes_contas','filial = $1'],
    ['destinacoes_resultado','filial = $1'],
    ['apuracao_bonus_itens','filial = $1'],
    ['mandatos','filial = $1'],
    ['risco_revisoes','risco_id IN (SELECT id FROM public.riscos WHERE filial = $1)'],
    ['riscos','filial = $1'],
    ['auditoria_revisoes','filial = $1'],
    ['orcamento_mensal_categoria','filial = $1'],
    ['avaliacoes','filial = $1 AND tipo IS DISTINCT FROM ''matriz_filial'''],
    ['produtos_codigo_reserva','filial = $1'],
    ['produtos_custo','produto_id IN (SELECT id FROM public.produtos WHERE filial = $1)'],
    ['produtos','filial = $1'],
    ['servicos','filial = $1'],
    ['clientes','filial = $1'],
    ['projetos','filial = $1']];
  v_tab text; v_where text; v_i int; v_passada int;
  v_apagou bigint; v_total bigint := 0; v_progresso boolean;
  v_restou text := ''; v_contagem jsonb := '{}'::jsonb;
  v_estorno jsonb := '[]'::jsonb; v_devolvido numeric := 0;
  v_zeradas int := 0; v_emp_arquivar int := 0; r record;
BEGIN
  IF NOT COALESCE(public.auth_user_role() = 'admin', false)
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas o administrador pode zerar uma unidade.'
      USING ERRCODE = '42501';
  END IF;

  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Reset por unidade é de SuperMax, MaxLook ou TechMax — recebi %. A Matriz é a contraparte de todas; para ela existe o APAGAR TUDO.',
      COALESCE(p_filial,'(vazio)') USING ERRCODE = 'P0001';
  END IF;

  DROP TABLE IF EXISTS _reset_cr_matriz;
  CREATE TEMP TABLE _reset_cr_matriz ON COMMIT DROP AS
    SELECT p.contas_receber_id AS id
      FROM public.parcelas_emprestimo p
      JOIN public.emprestimos_filial e ON e.id = p.emprestimo_id
     WHERE e.filial = p_filial AND p.contas_receber_id IS NOT NULL;

  -- (572) Quantos contratos serao arquivados (e nao apagados). O ensaio mostra
  -- o mesmo numero que a execucao real vai carimbar.
  SELECT count(*) INTO v_emp_arquivar
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND arquivado_em IS NULL;

  FOR r IN
    SELECT b.id AS banco_id, COALESCE(b.banco, b.conta) AS banco_nome, SUM(x.valor) AS valor
      FROM (SELECT banco_origem_id AS banco, valor FROM public.capital_filial
             WHERE filial = p_filial AND banco_origem_id IS NOT NULL
            UNION ALL
            SELECT banco_id, valor FROM public.emprestimos_filial
             WHERE filial = p_filial AND status = 'Aprovado' AND banco_id IS NOT NULL
               -- (572) O emprestimo agora sobrevive ao reset. Sem este filtro,
               -- zerar a mesma unidade duas vezes estornaria o mesmo dinheiro
               -- duas vezes.
               AND arquivado_em IS NULL) x
      JOIN public.caixa_bancos b ON b.id = x.banco
     WHERE b.filial IS DISTINCT FROM p_filial
     GROUP BY b.id, COALESCE(b.banco, b.conta)
  LOOP
    v_estorno := v_estorno || jsonb_build_object('banco', r.banco_nome, 'devolvido', r.valor);
    v_devolvido := v_devolvido + r.valor;
    IF NOT p_dry_run THEN
      UPDATE public.caixa_bancos SET saldo = COALESCE(saldo,0) + r.valor WHERE id = r.banco_id;
    END IF;
  END LOOP;

  IF p_dry_run THEN
    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN
        v_contagem := v_contagem || jsonb_build_object(v_tab,
          COALESCE((v_contagem ->> v_tab)::bigint,0) + v_apagou);
        v_total := v_total + v_apagou;
      END IF;
    END LOOP;
  ELSE
    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_alvos[v_i][1]);
    END LOOP;

    FOR v_passada IN 1 .. 6 LOOP
      v_progresso := false;
      FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
        v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
        BEGIN
          EXECUTE format('WITH del AS (DELETE FROM public.%I WHERE %s RETURNING 1) SELECT count(*) FROM del',
            v_tab, v_where) INTO v_apagou USING p_filial;
          IF v_apagou > 0 THEN
            v_progresso := true;
            v_contagem := v_contagem || jsonb_build_object(v_tab,
              COALESCE((v_contagem ->> v_tab)::bigint,0) + v_apagou);
            v_total := v_total + v_apagou;
          END IF;
        EXCEPTION WHEN foreign_key_violation THEN NULL;
        END;
      END LOOP;
      EXIT WHEN NOT v_progresso;
    END LOOP;

    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN v_restou := v_restou || v_tab || ' (' || v_apagou || '), '; END IF;
    END LOOP;

    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_alvos[v_i][1]);
    END LOOP;

    IF v_restou <> '' THEN
      RAISE EXCEPTION 'Reset abortado: sobraram linhas presas por chave estrangeira em %. Nada foi apagado.',
        rtrim(v_restou, ', ') USING ERRCODE = 'P0001';
    END IF;

    -- (572) Depois do laco, com os titulos ja apagados: o contrato vira
    -- historico fechado. Daqui para frente ele nao conta capital, nao aceita
    -- UPDATE e so sai por `apagar_emprestimo`.
    UPDATE public.emprestimos_filial
       SET arquivado_em = now()
     WHERE filial = p_filial AND arquivado_em IS NULL;
  END IF;

  SELECT count(*) INTO v_zeradas FROM public.caixa_bancos
   WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  IF NOT p_dry_run THEN
    UPDATE public.caixa_bancos SET saldo = 0
     WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  END IF;

  DROP TABLE IF EXISTS _reset_cr_matriz;

  RETURN jsonb_build_object('sucesso', true, 'ensaio', p_dry_run, 'filial', p_filial,
    'linhas', v_total, 'por_tabela', v_contagem, 'contas_zeradas', v_zeradas,
    'estorno_matriz', v_estorno, 'estorno_total', v_devolvido,
    -- (504) O ponto da unidade nao entra mais na conta; o numero aparece pra
    -- quem roda o ensaio conferir que ele sobreviveu.
    'ponto_preservado', (SELECT count(*) FROM public.ponto_eletronico WHERE filial = p_filial),
    -- (514) Idem folha: quem roda o ensaio ve o que NAO vai sair.
    'folha_preservada', (SELECT count(*) FROM public.folha_pagamento
                          WHERE filial = p_filial AND COALESCE(ativo, true)),
    -- (572) Emprestimo nao sai: e' arquivado. O ensaio mostra quantos.
    'emprestimos_arquivados', v_emp_arquivar,
    'emprestimos_preservados', (SELECT count(*) FROM public.emprestimos_filial
                                 WHERE filial = p_filial),
    'executado_em', now());
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 6) A válvula do professor
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.apagar_emprestimo(p_emprestimo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp        RECORD;
  v_cp_ids     uuid[];
  v_cr_ids     uuid[];
  v_parcelas   int;
  v_titulos    int := 0;
  v_n          int;
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

  -- Emprestimo aprovado e VIVO moveu dinheiro (326): debitou a conta da Matriz
  -- e creditou a da filial. Apagar a linha nao devolve nada -- o saldo ficaria
  -- na filial vindo do nada. Mesma proibicao que a 326 pos no aporte.
  IF v_emp.status = 'Aprovado' AND v_emp.arquivado_em IS NULL THEN
    RAISE EXCEPTION 'Este empréstimo está vivo: R$ % já saíram do caixa da Matriz e entraram no de %. Apagar a linha não devolveria o dinheiro. Desfaça pelo financeiro, ou apague depois que um reset o arquivar.',
      public.brl(v_emp.valor), v_emp.filial
      USING ERRCODE = 'P0001';
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

  RETURN jsonb_build_object(
    'sucesso',   true,
    'filial',    v_emp.filial,
    'valor',     v_emp.valor,
    'status',    v_emp.status,
    'arquivado', (v_emp.arquivado_em IS NOT NULL),
    'parcelas_apagadas', COALESCE(v_parcelas, 0),
    'titulos_apagados',  v_titulos
  );
END;
$function$;

COMMENT ON FUNCTION public.apagar_emprestimo(uuid) IS
  'Migr. 572 — válvula do professor: apaga um empréstimo preservado por reset (e as parcelas e títulos que restarem). role=admin literal. Recusa empréstimo Aprovado ainda vivo, porque apagar a linha não devolveria o dinheiro à Matriz.';

REVOKE ALL ON FUNCTION public.apagar_emprestimo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apagar_emprestimo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apagar_emprestimo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apagar_emprestimo(uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
-- LIKE simples não serve: os nomes aparecem nos comentários dentro do corpo.
-- A âncora tem de ser começo de linha (mesmo cuidado da 504/514).
--
--   SELECT proname,
--          prosrc ~ E'\n\\s*emprestimos_filial,'            AS emp_no_truncate,
--          prosrc ~ E'\n\\s*\\[''emprestimos_filial'''       AS emp_no_alvos,
--          prosrc ~ E'\n\\s*\\[''parcelas_emprestimo'''      AS parc_no_alvos
--     FROM pg_proc
--    WHERE proname IN ('resetar_dados_operacionais','resetar_dados_da_filial');
--   -- esperado: false nas três colunas
--
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid IN ('public.emprestimos_filial'::regclass,
--                      'public.parcelas_emprestimo'::regclass)
--      AND NOT tgisinternal ORDER BY 1;
--   -- esperado: trg_emprestimo_arquivado_historico ANTES de
--   --           trg_emprestimo_valida_condicoes (ordem alfabética), ambos 'O'
--
--   SELECT proname, proacl::text FROM pg_proc WHERE proname = 'apagar_emprestimo';
--   -- esperado: authenticated e service_role; anon ausente
--
--   -- Ensaio da trava sem resetar nada (rode e desfaça):
--   --   BEGIN;
--   --     UPDATE emprestimos_filial SET arquivado_em = now()
--   --      WHERE id = (SELECT id FROM emprestimos_filial LIMIT 1);
--   --     UPDATE emprestimos_filial SET status = status
--   --      WHERE id = (SELECT id FROM emprestimos_filial WHERE arquivado_em IS NOT NULL LIMIT 1);
--   --     -- esperado: P0001 'histórico fechado'
--   --   ROLLBACK;
-- ════════════════════════════════════════════════════════════════════════════
