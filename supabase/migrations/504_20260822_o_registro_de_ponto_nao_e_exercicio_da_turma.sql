-- 504_20260822_o_registro_de_ponto_nao_e_exercicio_da_turma.sql
--
-- O APAGAR TUDO levava o Registro de Ponto junto. Não deveria: a frequência
-- lançada é histórico da pessoa, como `frequencia_trabalho` — que a régua já
-- preservava desde a v6 (migr. 178) com exatamente esse argumento.
--
-- A incoerência estava escrita na própria função: ela devolvia
-- 'frequencia_preservada' no relatório de sucesso e, três linhas acima,
-- truncava `ponto_eletronico`. A tela dizia a mesma meia-verdade — "preserva o
-- histórico de frequência" ao lado de "RH: ponto" na lista do que se perde.
--
-- Pior: `calcular_placar_competicao` (migr. 349) lê a frequência do eixo do
-- placar direto de `ponto_eletronico`, ao vivo. Truncar o ponto zera o eixo de
-- frequência de TODA competição preservada, sem apagar uma linha de placar —
-- o número muda sozinho e não há nada na tela que explique.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE SÃO QUATRO TABELAS, E NÃO UMA
-- ────────────────────────────────────────────────────────────────────────────
-- Tirar só `ponto_eletronico` do TRUNCATE não preservaria nada. O grafo de FK:
--
--   ponto_eletronico.afastamento_id -> afastamentos(id) ON DELETE SET NULL
--
-- `afastamentos` está na lista, e TRUNCATE ... CASCADE não olha a regra de
-- DELETE: ele trunca toda tabela que referencia a truncada. O ponto morreria
-- pelo CASCADE, fora da lista, sem aparecer na função. É a armadilha da migr.
-- 339 outra vez.
--
-- Trocar `afastamentos` por DELETE também não serve, e por um motivo pior:
-- `trg_afastamento_reverte_ao_excluir` chama `_reverter_ponto_do_afastamento`,
-- que devolve o dia ao estado anterior — o que estava 'Justificado' volta a
-- 'Falta'. O ponto sobreviveria mentindo, e mentindo contra o aluno.
--
-- Então `afastamentos` fica. E com ele `justificativas_falta`, que é o papel
-- por trás da falta abonada em `frequencia_trabalho` (migr. 114/264) — tabela
-- preservada desde sempre. Preservar a medida e apagar o documento que a
-- justifica é a mesma incoerência de novo, um andar abaixo.
--
-- As quatro não têm filha nenhuma além do próprio ponto, e as mães (
-- `funcionarios`, `auth.users`) já eram preservadas. Nada mais muda de lado.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DOCUMENTOS DA MATRIZ: JÁ SOBREVIVIAM, AGORA POR ESCRITO
-- ────────────────────────────────────────────────────────────────────────────
-- `documentos` e `documentos_leitura` (migr. 476) nunca estiveram em nenhuma
-- das duas réguas, e o grafo confirma que nenhum CASCADE as alcança — a única
-- mãe é `user_profiles`, preservada. Então o comportamento não muda; o que
-- muda é o registro da decisão: comentário na lista e contagem no retorno,
-- mesmo tratamento que a 482 deu a fornecedor e categoria. Estar de fora por
-- decisão e estar de fora por esquecimento são indistinguíveis quando ninguém
-- escreve qual dos dois é — foi assim que 12 tabelas atravessaram o reset sem
-- que ninguém soubesse, entre a 377 e a 392.
--
-- Na régua por unidade não há o que dizer: documento é ato da Matriz, e o
-- reset por unidade recusa a Matriz de saída.
--
-- ────────────────────────────────────────────────────────────────────────────
-- NOTA SOBRE O CORPO
-- ────────────────────────────────────────────────────────────────────────────
-- Corpo copiado do banco (`prosrc`), não do arquivo 486: o que está rodando
-- nos 4 tem os comentários sem acento, sinal de que alguém colou uma versão
-- editada à mão no SQL Editor. md5 idêntico nas 4 antes desta migração —
-- global c850975ac526a7beeb07a55438365a8d, por unidade
-- 9a5552c93701026497b28f8664abde2d. Esta migração re-sincroniza repo e banco.
--
-- Não recupera o que já foi apagado: TRUNCATE não deixa rastro, e a trilha de
-- `historico_operacoes` nunca cobriu `ponto_eletronico` (0 linhas).
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
    contas_receber, contas_pagar, previsoes, duplicatas,
    integracoes_bancarias, controle_caixa, emprestimos_filial,
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam daqui: sao o historico de frequencia, do
    -- mesmo lado de frequencia_trabalho. As duas ultimas ficam porque o
    -- CASCADE e o gatilho de reversao levariam o ponto junto.
    folha_pagamento, ferias,
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
    -- (482) fornecedores saiu daqui: fundo de cadastro, nao exercicio.
    produtos, servicos, clientes,
    projetos,
    -- (486) Rascunho do botao "Gerar" (481). Mesma decisao da 485.
    produtos_codigo_reserva,
    -- (482) categorias_produto/subcategorias_produto sairam daqui: a categoria
    -- carrega o markup-alvo (360). O orcamento POR categoria continua zerando.
    orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

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
-- 2) ZERAR UMA UNIDADE (por filial) — mesma régua, mesmas quatro tabelas
-- ════════════════════════════════════════════════════════════════════════════
-- Aqui o motivo do CASCADE não existe (é DELETE, e com gatilho USER desligado),
-- mas a régua tem de dizer a mesma coisa nos dois lados. Duas listas que
-- decidem a mesma coisa de formas diferentes é o padrão que a 486 já apontou.
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
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam da regua: historico de frequencia fica.
    ['folha_rubricas','folha_id IN (SELECT id FROM public.folha_pagamento WHERE filial = $1)'],
    ['folha_pagamento','filial = $1'],
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
    'executado_em', now());
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
-- LIKE não serve aqui: o nome das tabelas aparece nos comentários (504) dentro
-- do próprio corpo. A âncora tem de ser começo de linha.
--
--   SELECT proname,
--          prosrc ~ E'\n\s*ponto_eletronico,'       AS ponto_no_truncate,
--          prosrc ~ E'\n\s*\[''ponto_eletronico''' AS ponto_na_regua,
--          prosrc ~ E'\n\s*afastamentos,'           AS afast_no_truncate,
--          prosrc ~ E'\n\s*\[''afastamentos'''     AS afast_na_regua
--     FROM pg_proc
--    WHERE proname IN ('resetar_dados_operacionais','resetar_dados_da_filial');
--   -- espera f em tudo
--
-- Ensaio de verdade, sem apagar nada (dry-run é o default):
--
--   SELECT resetar_dados_da_filial('SuperMax') -> 'por_tabela' ? 'ponto_eletronico';
--   -- espera f
--
-- md5 depois desta migração, idêntico nas 4:
--   resetar_dados_operacionais  d1d37c93d600e2e54f2d1a08483f87df
--   resetar_dados_da_filial     9f5b13ec03f5b4ed385561387fafab34
-- ════════════════════════════════════════════════════════════════════════════
