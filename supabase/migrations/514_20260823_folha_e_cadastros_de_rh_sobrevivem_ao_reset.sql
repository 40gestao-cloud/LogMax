-- 514_20260823_folha_e_cadastros_de_rh_sobrevivem_ao_reset.sql
--
-- Quatro coisas saem do APAGAR TUDO: Departamentos, Cargos, Centros de Custo e
-- a Folha de Pagamento. Três delas já saíam — só não estava escrito em lugar
-- nenhum, que é exatamente o problema que a 504 nomeou nas 12 tabelas órfãs
-- entre a 377 e a 392: estar de fora por decisão e estar de fora por
-- esquecimento são indistinguíveis quando ninguém diz qual dos dois é.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE JÁ SOBREVIVIA (agora por escrito)
-- ────────────────────────────────────────────────────────────────────────────
-- `departamentos`, `cargos` e `centros_custo` nunca estiveram em nenhuma das
-- duas réguas, e o grafo de FK confirma que nenhum CASCADE as alcança:
--
--   · departamentos e cargos — a única mãe é `auth.users` (criado_por,
--     atualizado_por), preservada. Ninguém as referencia: o vínculo do
--     funcionário com o departamento é por TEXTO, não por FK.
--   · centros_custo — as filhas (contas_pagar, consumos_material,
--     requisicoes_estoque, orcamento_itens, filial_investimentos) são
--     truncadas, e TRUNCATE ... CASCADE desce, não sobe: truncar a filha não
--     toca na mãe.
--
-- Comportamento inalterado, então. O que muda é o registro da decisão e a
-- contagem no retorno, mesmo tratamento que a 482 deu a fornecedor/categoria e
-- a 504 deu aos documentos da Matriz.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE MUDA DE LADO: A FOLHA DE PAGAMENTO
-- ────────────────────────────────────────────────────────────────────────────
-- `folha_pagamento` era truncada nas duas réguas. Passa a ser preservada, pelo
-- mesmo argumento que a 504 usou para o Registro de Ponto: o holerite é
-- histórico da PESSOA — o que ela recebeu, quanto foi descontado, qual o FGTS
-- acumulado. `rh_fgts_acumulado` e `rh_media_variaveis` leem daí, e um FGTS que
-- volta a zero a cada turma não ensina o que FGTS é.
--
-- Junto vêm, por consequência do grafo, duas tabelas que hoje morriam pelo
-- CASCADE e agora ficam — e é isso que se quer:
--
--   folha_rubricas        -> folha_pagamento  ON DELETE CASCADE
--   folha_credito_falhas  -> folha_pagamento  ON DELETE CASCADE
--
-- As rubricas SÃO a folha (migr. 320): os totais de `folha_pagamento` são
-- derivados delas no recálculo. Preservar o total e apagar a memória de cálculo
-- deixaria o holerite sem como se explicar. E o registro de crédito que falhou
-- é o que explica o estado de uma folha preservada.
--
-- `contas_pagar` CONTINUA sendo apagada, e isso é decisão: o lançamento
-- financeiro da folha é exercício da turma (ela lança, aprova, paga). Depois do
-- reset a folha antiga fica sem a conta a pagar que a originou — a FK
-- `contas_pagar.folha_pagamento_id` é da conta para a folha, então apagar a
-- conta não arranha a folha. O holerite sobrevive; o caixa recomeça.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A CONTRAPARTIDA: FOLHA DA TURMA ANTERIOR É HISTÓRICO FECHADO
-- ────────────────────────────────────────────────────────────────────────────
-- Preservar a folha reabre, um andar acima, o furo que a 505 fechou no ponto:
-- `funcionarios` também atravessa o reset, então uma folha preservada fica
-- pendurada num cadastro que a turma nova vai reaproveitar. Sem trava:
--
--   · uma folha 'Pendente' herdada seria processada e paga pela turma nova, e o
--     crédito cairia na carteira MaxBank de quem ocupa o cadastro HOJE;
--   · `recalcular_folha_do_ponto` reescreveria os totais de um mês que não é
--     dela (a 505 já ignora os DIAS anteriores ao corte, mas nada impedia o
--     recálculo de rodar em cima da linha antiga).
--
-- A régua é a mesma da 505, e o carimbo também: `ponto_corte_turma()`, gravado
-- em `configuracoes` pelo próprio APAGAR TUDO. Folha CRIADA antes do corte não
-- aceita mais UPDATE — nem status, nem valor, nem recálculo. Só leitura.
--
-- DELETE continua liberado (a policy é admin), e de propósito: é a válvula do
-- professor. O índice `uq_folha_pagamento_func_mes (funcionario_id, mes_ref)
-- WHERE ativo` recusa uma segunda folha ativa da mesma pessoa no mesmo mês, e
-- uma folha preservada pode ocupar a vaga do mês em que a turma nova começa.
-- Quando isso acontecer, a saída é apagar aquela linha (perdendo o histórico
-- dela, com o professor sabendo) ou lançar o mês seguinte. Inventar um
-- discriminador de turma na chave seria remodelar a folha inteira por causa de
-- uma colisão de borda — não é hora.
--
-- Sem carimbo (projeto que nunca resetou) `ponto_corte_turma()` devolve NULL e
-- nada muda: é o mesmo lado seguro de errar que a 505 escolheu.
--
-- ────────────────────────────────────────────────────────────────────────────
-- NOTA SOBRE OS CORPOS
-- ────────────────────────────────────────────────────────────────────────────
-- Copiados de `prosrc`, não do arquivo 504 — a 507/512 acrescentou
-- `filial_investimentos` às duas listas e o arquivo antigo não sabe disso.
-- md5 idêntico nos 4 projetos ANTES desta migração:
--   resetar_dados_operacionais  55db9d36d94111ea1bef1489fa132306
--   resetar_dados_da_filial     0b895fb3745eee228b159ae91bbda695
--
-- Não recupera folha já apagada: TRUNCATE não deixa rastro.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) APAGAR TUDO (global)
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

  TRUNCATE TABLE
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    contas_receber, contas_pagar, previsoes, duplicatas, filial_investimentos,
    integracoes_bancarias, controle_caixa, emprestimos_filial,
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam daqui: sao o historico de frequencia, do
    -- mesmo lado de frequencia_trabalho. As duas ultimas ficam porque o
    -- CASCADE e o gatilho de reversao levariam o ponto junto.
    -- (514) folha_pagamento saiu daqui, e com ela folha_rubricas e
    -- folha_credito_falhas, que morriam pelo CASCADE: o holerite e historico da
    -- pessoa (e a base do FGTS acumulado), nao exercicio da turma. contas_pagar
    -- continua na lista -- o lancamento financeiro da folha e' que e' exercicio.
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
-- 2) ZERAR UMA UNIDADE (por filial) — mesma régua, mesmas três tabelas de folha
-- ════════════════════════════════════════════════════════════════════════════
-- Duas listas que decidem a mesma coisa de formas diferentes é o padrão que a
-- 486 já apontou. Aqui saem `folha_rubricas`, `folha_pagamento` e
-- `folha_credito_falhas` (esta última estava listada por conta própria, com
-- `filial = $1`, porque o DELETE não tem CASCADE para levá-la).
--
-- O reset por unidade NÃO carimba o corte — o corte é global, e uma unidade
-- zerada não encerra a turma das vizinhas (505). Então a folha preservada de
-- uma unidade zerada continua editável, e está certo: é a mesma turma.
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
    ['parcelas_emprestimo','emprestimo_id IN (SELECT id FROM public.emprestimos_filial WHERE filial = $1)'],
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
    ['emprestimos_filial','filial = $1'],
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
  v_zeradas int := 0; r record;
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
    'executado_em', now());
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3) A folha da turma anterior não se reescreve
-- ════════════════════════════════════════════════════════════════════════════
-- Mesma família de `registrar_ponto_manual` (505): a trava é sobre a LINHA
-- existente, não sobre a data. Lançar folha nova de um mês antigo continua
-- permitido — não destrói nada. O que não se faz é passar por cima do holerite
-- que a turma passada fechou.
--
-- BEFORE UPDATE e não policy de RLS: `processar_folha`, `pagar_folha` e
-- `_folha_creditar_e_avancar` são SECURITY DEFINER e ignorariam a RLS (vide
-- [[feedback_secdef_ignora_rls_nao_trigger]]). Gatilho pega todo mundo.
CREATE OR REPLACE FUNCTION public.folha_historico_fechado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_corte date := public.ponto_corte_turma();
BEGIN
  -- Projeto que nunca resetou: nada muda.
  IF v_corte IS NULL OR OLD.created_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF (OLD.created_at AT TIME ZONE 'America/Rio_Branco')::date >= v_corte THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Esta folha (%) é da turma anterior — foi criada antes de % e virou histórico fechado no APAGAR TUDO. Ela continua visível para consulta, mas não se processa, não se paga e não se recalcula. Lance a folha do mês corrente.',
    COALESCE(OLD.mes_ref, 'sem mês'), v_corte
    USING ERRCODE = 'P0001';
END;
$function$;

COMMENT ON FUNCTION public.folha_historico_fechado() IS
  'Migr. 514 — folha criada antes de ponto_corte_turma() é só leitura: é da turma anterior, preservada pelo reset. DELETE segue liberado (válvula do professor).';

DROP TRIGGER IF EXISTS trg_folha_historico_fechado ON public.folha_pagamento;
CREATE TRIGGER trg_folha_historico_fechado
  BEFORE UPDATE ON public.folha_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.folha_historico_fechado();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
-- LIKE simples não serve: os nomes aparecem nos comentários dentro do corpo.
-- A âncora tem de ser começo de linha (mesmo cuidado da 504).
--
--   SELECT proname,
--          prosrc ~ E'\n\\s*folha_pagamento,'                  AS folha_no_truncate,
--          prosrc ~ E'\n\\s*\\[''folha_pagamento''';           AS folha_no_alvos
--     FROM pg_proc
--    WHERE proname IN ('resetar_dados_operacionais','resetar_dados_da_filial');
--   -- esperado: false nas duas colunas
--
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.folha_pagamento'::regclass AND NOT tgisinternal;
--   -- esperado: trg_folha_historico_fechado presente e 'O'
--
--   -- Ensaio da trava sem resetar nada (rode e desfaça):
--   --   INSERT INTO configuracoes (chave, valor) VALUES ('ponto_corte_turma','2030-01-01')
--   --     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
--   --   UPDATE folha_pagamento SET status = status WHERE id = (SELECT id FROM folha_pagamento LIMIT 1);
--   --   -- esperado: P0001 'é da turma anterior'
--   --   DELETE FROM configuracoes WHERE chave = 'ponto_corte_turma';
-- ════════════════════════════════════════════════════════════════════════════
