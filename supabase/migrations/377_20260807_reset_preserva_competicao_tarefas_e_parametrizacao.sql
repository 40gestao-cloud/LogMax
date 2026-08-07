-- 377_20260807_reset_preserva_competicao_tarefas_e_parametrizacao.sql
--
-- APAGAR TUDO (resetar_dados_operacionais) passava por cima de coisa que não é
-- operação da turma: o histórico inteiro da Competição das Filiais (placar,
-- notas, tarefas) e metade da parametrização da empresa. Cada turma nova
-- obrigava a remontar tudo do zero.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1) COMPETIÇÃO DAS FILIAIS — placar, notas e tarefas
-- ────────────────────────────────────────────────────────────────────────────
-- Só `ciclos_avaliacao` estava escrita no TRUNCATE. Todo o resto do bloco caía
-- por CASCADE, sem aparecer na função:
--
--   ciclos_avaliacao
--     ├── competicoes_matriz
--     │     ├── avaliacoes_matriz          (Conselho julgando 8 tipos)
--     │     ├── competicao_votos
--     │     └── matriz_tarefas
--     │           └── matriz_tarefa_participantes
--     ├── ciclo_tarefas                    (Demandas do ciclo Padrão)
--     │     ├── ciclo_tarefa_participantes
--     │     │     └── ciclo_tarefa_avaliacoes
--     │     └── ciclo_tarefa_avaliadores
--     ├── evidencias_avaliacao
--     └── avaliacoes                       (ver nota abaixo — é o placar)
--
-- Tirar `ciclos_avaliacao` do TRUNCATE é o que segura a árvore inteira.
--
-- O PLACAR MORA EM `avaliacoes`. Isso não é óbvio pelo nome: as notas que
-- alimentam `calcular_placar_competicao` são linhas de `avaliacoes` com
-- tipo='matriz_filial' + suas `criterios_avaliacao` (ver AvaliacaoFilialPanel).
-- A mesma tabela guarda as avaliações de PESSOA (ceo_gerente, ceo_colaborador,
-- feedback_colaborador, admin_ceo, admin_conselheiro, ceo_conselheiro), que
-- são da turma e devem zerar — gente muda a cada turma.
--
-- TRUNCATE é tudo-ou-nada por tabela, então `avaliacoes` sai da lista e ganha
-- um DELETE seletivo. `criterios_avaliacao`, `feedbacks_avaliacao` e
-- `pdi_itens` saem junto: são filhas com ON DELETE CASCADE, o DELETE já leva
-- as linhas certas, e truncá-las apagaria os critérios das notas preservadas.
--
-- `desenvolvimentos_ia` TAMBÉM sai do TRUNCATE, e essa é a armadilha mais
-- escondida da migração: `avaliacoes.desenvolvimento_ia_id` aponta pra ela com
-- ON DELETE CASCADE. Truncar `desenvolvimentos_ia` derrubaria `avaliacoes`
-- inteira por cascade — placar junto — mesmo com ela fora da lista. Vira
-- DELETE, que cascateia só nas avaliações que de fato referenciam TI
-- (as de tipo='matriz_filial' têm desenvolvimento_ia_id NULL).
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2) PARAMETRIZAÇÃO DA EMPRESA
-- ────────────────────────────────────────────────────────────────────────────
-- A régua estava incoerente: a função já preservava rh_faixas, rh_parametros,
-- alcadas_compra, financeiro_config, filial_caixa_config e capital_config, mas
-- apagava a outra metade da mesma família. Agora as duas metades sobrevivem:
--   departamentos, cargos, beneficios (+ funcionario_beneficios por cascade),
--   centros_custo, condicoes_pagamento, classificacoes_auxiliares,
--   mapeamentos_rateio, formas_pagamento, caixa_bancos, configuracoes.
--
-- Bônus: `caixa_bancos` guarda logo no bucket `banco-logos`. Como o reset não
-- toca em storage, apagar a linha deixava a imagem órfã. Agora não deixa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 3) CATÁLOGO DE TREINAMENTOS
-- ────────────────────────────────────────────────────────────────────────────
-- `treinamentos` é conteúdo do curso; `treinamento_inscricoes` é operação da
-- turma. Separados: o catálogo fica, as inscrições zeram.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 4) emprestimos_filial ENTRA no TRUNCATE
-- ────────────────────────────────────────────────────────────────────────────
-- Efeito colateral de preservar `caixa_bancos`: `emprestimos_filial` (e a filha
-- `parcelas_emprestimo`) deixaria de cair por cascade e sobreviveria — empréstimo
-- em aberto com contas_pagar zerada. Como é operação financeira, entra
-- explicitamente na lista pra continuar sendo apagada.
--
-- NÃO preservado (decisão pedagógica): folha_pagamento (e folha_rubricas),
-- catálogo de produtos, clientes e fornecedores continuam sendo apagados.

BEGIN;

CREATE OR REPLACE FUNCTION public.resetar_dados_operacionais()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuarios_preservados int;
BEGIN
  IF auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin e CEO podem executar este reset.'
      USING ERRCODE = '42501';
  END IF;

  -- ── Limpezas seletivas ANTES do TRUNCATE ────────────────────────────────
  -- Ordem importa: desenvolvimentos_ia primeiro, porque seu cascade tira de
  -- `avaliacoes` as linhas de TI; depois some o resto que não é placar.

  DELETE FROM desenvolvimentos_ia;

  -- Mantém só o placar da competição das filiais. As filhas
  -- (criterios_avaliacao, feedbacks_avaliacao, pdi_itens) vêm por
  -- ON DELETE CASCADE.
  DELETE FROM avaliacoes WHERE tipo IS DISTINCT FROM 'matriz_filial';

  TRUNCATE TABLE
    -- vendas + relacionados
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    -- estoque
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    -- compras
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    -- financeiro
    -- NOTA: caixa_bancos fora do TRUNCATE (377) — parametrização preservada.
    -- emprestimos_filial entra explicitamente: sem isso sobreviveria por não
    -- ter mais pai truncado (era arrastada por caixa_bancos).
    contas_receber, contas_pagar, previsoes, duplicatas,
    integracoes_bancarias, controle_caixa, emprestimos_filial,
    -- RH operacional
    -- NOTA: frequencia_trabalho fora do TRUNCATE (v6) — histórico preservado.
    ponto_eletronico, ponto_qr_registros, folha_pagamento, ferias,
    afastamentos, beneficios_pendentes, justificativas_falta,
    -- treinamentos
    -- NOTA: treinamentos fora do TRUNCATE (377) — catálogo preservado,
    -- só as inscrições da turma zeram.
    treinamento_inscricoes,
    -- NOTA (377): ciclos_avaliacao, avaliacoes, criterios_avaliacao,
    -- feedbacks_avaliacao, pdi_itens e desenvolvimentos_ia saíram do TRUNCATE.
    -- São o bloco da Competição das Filiais — tratados pelos DELETEs acima.
    -- pesquisas
    pesquisa_resposta_itens, pesquisa_respostas, pesquisa_perguntas, pesquisas,
    -- marketing
    marketing_arte_feedback, marketing_artes, marketing_tarefas,
    marketing_promocoes, marketing_calendario, marketing_cupons,
    marketing_campanhas, itens_campanha,
    -- vendas B2B
    orcamentos, pedidos_venda,
    -- maxbank — histórico zerado; maxbank_contas NÃO entra (saldo preservado)
    maxbank_transacoes, maxbank_transferencias,
    maxbank_folgas_conquistadas, maxbank_metas,
    -- metas / tarefas (genéricas — as tarefas da Matriz são outra tabela)
    tarefas_taticas, tarefas, metas_estrategicas,
    -- TI
    ti_chamados,
    -- BI / Briefing / Notif / Feedback
    relatorios_bi, briefings_diarios, notificacoes, feedbacks_organizacao,
    -- Votações e votos (votos antes de votações por FK)
    votacoes_votos, votacoes,
    -- Capital e requerimentos
    capital_filial, requerimentos,
    -- Cadastros gerais (filiais e funcionarios preservados)
    -- NOTA (377): departamentos, cargos, beneficios, centros_custo,
    -- condicoes_pagamento, classificacoes_auxiliares, mapeamentos_rateio,
    -- formas_pagamento, caixa_bancos e configuracoes saíram do TRUNCATE —
    -- são parametrização, mesma família de rh_faixas/alcadas_compra.
    produtos, servicos, clientes, fornecedores,
    projetos,
    -- Catálogo de categorias/orçamento
    categorias_produto, subcategorias_produto, orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

  SELECT count(*) INTO v_usuarios_preservados FROM user_profiles;

  RETURN jsonb_build_object(
    'sucesso',                  true,
    'usuarios_preservados',     v_usuarios_preservados,
    'funcionarios_preservados', (SELECT count(*) FROM funcionarios),
    'carteiras_preservadas',    (SELECT count(*) FROM maxbank_contas),
    'filiais_preservadas',      (SELECT count(*) FROM filiais),
    'frequencia_preservada',    (SELECT count(*) FROM frequencia_trabalho),
    'competicoes_preservadas',  (SELECT count(*) FROM competicoes_matriz),
    'notas_placar_preservadas', (SELECT count(*) FROM avaliacoes WHERE tipo = 'matriz_filial'),
    'avaliacoes_matriz_preservadas', (SELECT count(*) FROM avaliacoes_matriz),
    'tarefas_matriz_preservadas',    (SELECT count(*) FROM matriz_tarefas),
    'treinamentos_preservados', (SELECT count(*) FROM treinamentos),
    'executado_em',             now()
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar ANTES de qualquer reset de verdade)
-- ────────────────────────────────────────────────────────────────────────────
-- Recalcula quem cai por CASCADE a partir da lista vigente e confirma que o
-- bloco preservado ficou de fora. Esperado: zero linhas.
--
-- WITH RECURSIVE lista(t) AS (
--   SELECT unnest(ARRAY[
--     'itens_venda','vendas','pix_pendentes','cartao_pendentes',
--     'movimentacoes_estoque','inventarios','recebimentos','notas_recebidas',
--     'expedicao','vencimentos_estoque','requisicoes_estoque','aprovacoes_estoque',
--     'pedidos','cotacoes','aprovacoes_compras','requisicoes',
--     'contas_receber','contas_pagar','previsoes','duplicatas',
--     'integracoes_bancarias','controle_caixa','emprestimos_filial',
--     'ponto_eletronico','ponto_qr_registros','folha_pagamento','ferias',
--     'afastamentos','beneficios_pendentes','justificativas_falta',
--     'treinamento_inscricoes',
--     'pesquisa_resposta_itens','pesquisa_respostas','pesquisa_perguntas','pesquisas',
--     'marketing_arte_feedback','marketing_artes','marketing_tarefas',
--     'marketing_promocoes','marketing_calendario','marketing_cupons',
--     'marketing_campanhas','itens_campanha','orcamentos','pedidos_venda',
--     'maxbank_transacoes','maxbank_transferencias','maxbank_folgas_conquistadas',
--     'maxbank_metas','tarefas_taticas','tarefas','metas_estrategicas',
--     'ti_chamados','relatorios_bi','briefings_diarios',
--     'notificacoes','feedbacks_organizacao','votacoes_votos','votacoes',
--     'capital_filial','requerimentos','produtos','servicos','clientes',
--     'fornecedores','projetos','categorias_produto','subcategorias_produto',
--     'orcamento_mensal_categoria'])),
-- casc AS (
--   SELECT ('public.'||t)::regclass::oid AS oid FROM lista
--   UNION
--   SELECT c.conrelid FROM pg_constraint c JOIN casc ON c.confrelid = casc.oid
--    WHERE c.contype='f')
-- SELECT t.relname AS caiu_mas_deveria_sobreviver
--   FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
--  WHERE n.nspname='public' AND t.relkind='r'
--    AND t.oid IN (SELECT oid FROM casc)
--    AND t.relname IN ('ciclos_avaliacao','competicoes_matriz','avaliacoes_matriz',
--                      'competicao_votos','matriz_tarefas','matriz_tarefa_participantes',
--                      'ciclo_tarefas','ciclo_tarefa_participantes','ciclo_tarefa_avaliadores',
--                      'ciclo_tarefa_avaliacoes','evidencias_avaliacao','avaliacoes',
--                      'criterios_avaliacao','desenvolvimentos_ia','departamentos','cargos',
--                      'beneficios','funcionario_beneficios','centros_custo',
--                      'condicoes_pagamento','classificacoes_auxiliares','mapeamentos_rateio',
--                      'formas_pagamento','caixa_bancos','configuracoes','treinamentos');
--
-- Depois do reset de teste, o placar tem que continuar de pé:
-- SELECT * FROM avaliacoes_matriz_placar_filial;
-- SELECT tipo, count(*) FROM avaliacoes GROUP BY 1;   -- só 'matriz_filial'
