-- 485_20260819_o_reset_da_unidade_deixava_a_matriz_cobrando_sozinha.sql
--
-- Três defeitos da 484, achados relendo a função com calma. Os dois primeiros
-- são meus e são graves; o terceiro é a régua de sempre mordendo tabela nova.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. O LADO DA MATRIZ NUNCA ERA APAGADO — a coisa que a 484 existia para fazer
--
-- A entrada que apaga a contrapartida do mútuo é:
--
--   contas_receber : id IN (SELECT p.contas_receber_id FROM parcelas_emprestimo p
--                            JOIN emprestimos_filial e ON e.id = p.emprestimo_id
--                           WHERE e.filial = $1)
--
-- e `parcelas_emprestimo` vem ANTES dela na lista — de propósito, porque a FK
-- é NO ACTION e a parcela precisa sair primeiro. Só que ao sair primeiro ela
-- leva junto a única forma de descobrir QUAIS contas a receber da Matriz eram
-- daquele empréstimo: quando a vez do `contas_receber` chega, a subconsulta já
-- devolve vazio.
--
-- Resultado: a Matriz continuava com as parcelas a receber de uma unidade que
-- não existe mais. Exatamente o cenário que a 484 foi escrita para impedir, e
-- que eu descrevi no cabeçalho dela como resolvido.
--
-- O ensaio mentia junto, e da forma mais convincente possível: em `p_dry_run`
-- nada é apagado, então a subconsulta AINDA acha as parcelas e conta as linhas
-- certas. A tela mostrava um número que a execução real não cumpria.
--
-- Correção: fotografar os ids ANTES do laço, numa tabela temporária, e apagar
-- por foto. A ordem continua a mesma; o que muda é que a informação não depende
-- mais de quem já saiu.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 2. O GUARD DEIXAVA PASSAR ALUNO — e sessão sem perfil
--
-- Estava assim:
--
--   IF auth_user_role() NOT IN ('admin', 'ceo') THEN RAISE ...
--
-- Copiei da `resetar_dados_operacionais`, sem notar que ela não é mais a porta
-- de entrada de nada: a migr. 412 tirou o grant dela para `authenticated` e pôs
-- `resetar_dados_operacionais_admin` na frente, com `role = 'admin'` LITERAL,
-- pelo motivo que está escrito lá:
--
--   "`role = 'admin'` literal, jamais `auth_is_admin()`: esse helper hoje
--    inclui ceo, conselheiro e gerente-conselheiro, que são ALUNOS."
--
-- A 484 nasceu com grant para `authenticated` E com a lista frouxa. Ou seja: o
-- CEO — que é um aluno do curso — podia zerar uma unidade inteira. Apagar tudo
-- foi fechado para o professor em agosto; zerar uma unidade ficou aberto para a
-- turma no dia seguinte.
--
-- E tem o buraco do NULL, que é o [[feedback_assert_rpc_null]] de novo:
-- `auth_user_role()` devolve NULL para sessão sem perfil e para desligado;
-- `NULL NOT IN (...)` é NULL; `IF NULL THEN` não dispara. Quem não tem perfil
-- passava direto pelo guard.
--
-- Correção: a mesma linha da 412, COALESCE incluído.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 3. `produtos_codigo_reserva` não entrou em régua nenhuma
--
-- Criei a tabela na 481 e não a pus nem no reset global nem no da unidade — o
-- erro que a própria memória do projeto descreve como recorrente ("migração que
-- cria tabela nova não passa pela régua do reset").
--
-- No global não faz falta: é rascunho com prazo de 30 minutos, e a régua de lá
-- é sobre dado de exercício. No reset da unidade faz: zerar a MaxLook e ver o
-- primeiro "Gerar" da turma nova devolver 002 porque alguém da turma anterior
-- tinha 001 reservado é confuso sem ter como descobrir o porquê. Entra na lista.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos. Substitui a função da 484 inteira.

BEGIN;

CREATE OR REPLACE FUNCTION public.resetar_dados_da_filial(
  p_filial  text,
  p_dry_run boolean DEFAULT true
)
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
    ['parcelas_emprestimo','emprestimo_id IN (SELECT id FROM public.emprestimos_filial WHERE filial = $1)'],
    -- [485] Por FOTO, não pela junção: a linha acima já apagou as parcelas, e
    -- com elas o caminho até estas contas. Ver o cabeçalho.
    ['contas_receber','id IN (SELECT id FROM _reset_cr_matriz)'],
    ['contas_receber_baixas','filial = $1'],
    ['contas_pagar_baixas','filial = $1'],
    ['rateio_administrativo_itens','filial = $1'],
    ['folha_credito_falhas','filial = $1'],
    ['contas_receber','filial = $1'],
    ['contas_pagar','filial = $1'],
    ['previsoes','filial = $1'],
    ['duplicatas','filial = $1'],
    ['integracoes_bancarias','filial = $1'],
    ['movimentacoes_caixa','filial = $1'],
    ['controle_caixa_reaberturas','filial = $1'],
    ['controle_caixa','filial = $1'],
    ['emprestimos_filial','filial = $1'],
    ['capital_filial','filial = $1'],
    ['ponto_eletronico','filial = $1'],
    ['ponto_qr_registros','user_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['folha_rubricas','folha_id IN (SELECT id FROM public.folha_pagamento WHERE filial = $1)'],
    ['folha_pagamento','filial = $1'],
    ['maxbank_folgas_conquistadas','colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['ferias','filial = $1'],
    ['afastamentos','filial = $1'],
    ['justificativas_falta','funcionario_id IN (SELECT id FROM public.funcionarios WHERE filial = $1)'],
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
    -- [485] Rascunho do botão "Gerar" (481). Sem isto, o primeiro código da
    -- turma nova pularia o número que a anterior tinha reservado.
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
  v_zeradas int := 0; r record;
BEGIN
  -- [485] Mesma linha da migr. 412, e pelo mesmo motivo: `role='admin'` literal
  -- porque CEO e conselheiro são ALUNOS, e COALESCE porque `auth_user_role()`
  -- devolve NULL para sessão sem perfil — e `IF NOT NULL` não barra ninguém.
  IF NOT COALESCE(public.auth_user_role() = 'admin', false)
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas o administrador pode zerar uma unidade.'
      USING ERRCODE = '42501';
  END IF;

  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Reset por unidade é de SuperMax, MaxLook ou TechMax — recebi %. A Matriz é a contraparte de todas; para ela existe o APAGAR TUDO.',
      COALESCE(p_filial,'(vazio)') USING ERRCODE = 'P0001';
  END IF;

  -- [485] A foto do outro lado do mútuo, tirada antes de qualquer DELETE.
  -- O DROP antes do CREATE cobre a chamada que abortou no meio e deixou a
  -- temporária de pé para o resto da transação (o ensaio com ROLLBACK chama
  -- duas vezes seguidas).
  DROP TABLE IF EXISTS _reset_cr_matriz;
  CREATE TEMP TABLE _reset_cr_matriz ON COMMIT DROP AS
    SELECT p.contas_receber_id AS id
      FROM public.parcelas_emprestimo p
      JOIN public.emprestimos_filial e ON e.id = p.emprestimo_id
     WHERE e.filial = p_filial
       AND p.contas_receber_id IS NOT NULL;

  FOR r IN
    SELECT b.id AS banco_id, COALESCE(b.banco, b.conta) AS banco_nome, SUM(x.valor) AS valor
      FROM (SELECT banco_origem_id AS banco, valor FROM public.capital_filial
             WHERE filial = p_filial AND banco_origem_id IS NOT NULL
            UNION ALL
            SELECT banco_id, valor FROM public.emprestimos_filial
             WHERE filial = p_filial AND status = 'Aprovado' AND banco_id IS NOT NULL) x
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
    IF v_restou <> '' THEN
      RAISE EXCEPTION 'Reset abortado: sobraram linhas presas por chave estrangeira em %. Nada foi apagado.',
        rtrim(v_restou, ', ') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT count(*) INTO v_zeradas FROM public.caixa_bancos
   WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  IF NOT p_dry_run THEN
    UPDATE public.caixa_bancos SET saldo = 0
     WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  END IF;

  -- ON COMMIT DROP não vale para chamada em autocommit repetida na mesma
  -- sessão (o ensaio roda duas vezes seguidas com frequência).
  DROP TABLE IF EXISTS _reset_cr_matriz;

  RETURN jsonb_build_object('sucesso', true, 'ensaio', p_dry_run, 'filial', p_filial,
    'linhas', v_total, 'por_tabela', v_contagem, 'contas_zeradas', v_zeradas,
    'estorno_matriz', v_estorno, 'estorno_total', v_devolvido, 'executado_em', now());
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT prosrc LIKE '%_reset_cr_matriz%'          AS foto_do_outro_lado,
--          prosrc LIKE '%auth_user_role() = ''admin''%' AS guard_admin_literal,
--          prosrc LIKE '%produtos_codigo_reserva%'   AS reserva_na_lista
--     FROM pg_proc WHERE proname = 'resetar_dados_da_filial';
--   -- espera t, t, t
--
-- O ensaio de rollback da 484 continua valendo, e agora vale mais: é ele que
-- prova que a contrapartida da Matriz sai de verdade.
--
--   BEGIN;
--   SELECT jsonb_pretty(public.resetar_dados_da_filial('TechMax', false));
--   -- confira contas_receber no `por_tabela`
--   ROLLBACK;
-- ════════════════════════════════════════════════════════════════════════════
