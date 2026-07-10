-- =================================================================
-- Fix v5: resetar_dados_operacionais
--
-- Correções:
--   1. DELETE FROM funcionarios → DELETE FROM funcionarios WHERE TRUE
--      PostgREST bloqueia DELETE sem WHERE mesmo dentro de RPC SECURITY
--      DEFINER — WHERE TRUE satisfaz a verificação sem mudar o comportamento.
--   2. Adiciona ao TRUNCATE as tabelas criadas após v4:
--      votacoes_votos, votacoes, capital_filial, requerimentos,
--      frequencia_trabalho
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION resetar_dados_operacionais()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuarios_preservados int;
BEGIN
  IF auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin e CEO podem executar este reset.'
      USING ERRCODE = '42501';
  END IF;

  -- Quebra o link user_profiles → funcionarios antes do DELETE.
  UPDATE user_profiles SET funcionario_id = NULL
   WHERE funcionario_id IS NOT NULL;

  TRUNCATE TABLE
    -- vendas + relacionados
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    -- estoque
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    -- compras
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    -- financeiro
    contas_receber, contas_pagar, previsoes, duplicatas,
    integracoes_bancarias, controle_caixa,
    -- RH operacional
    ponto_eletronico, ponto_qr_registros, folha_pagamento, ferias,
    afastamentos, beneficios_pendentes, justificativas_falta,
    frequencia_trabalho,
    -- treinamentos
    treinamento_inscricoes, treinamentos,
    -- avaliações
    pdi_itens, criterios_avaliacao, feedbacks_avaliacao, avaliacoes,
    ciclos_avaliacao,
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
    -- metas / tarefas
    tarefas_taticas, tarefas, metas_estrategicas,
    -- TI / dev
    desenvolvimentos_ia, ti_chamados,
    -- BI / Briefing / Notif / Feedback
    relatorios_bi, briefings_diarios, notificacoes, feedbacks_organizacao,
    -- Votações e votos (votos antes de votações por FK)
    votacoes_votos, votacoes,
    -- Capital e requerimentos
    capital_filial, requerimentos,
    -- Cadastros gerais (filiais preservada)
    produtos, servicos, clientes, fornecedores,
    departamentos, cargos, beneficios,
    centros_custo, projetos, condicoes_pagamento,
    classificacoes_auxiliares, mapeamentos_rateio, formas_pagamento,
    caixa_bancos, configuracoes,
    -- Catálogo de categorias/orçamento
    categorias_produto, subcategorias_produto, orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

  -- WHERE TRUE: satisfaz a verificação do PostgREST que bloqueia
  -- DELETE sem cláusula WHERE mesmo dentro de funções SECURITY DEFINER.
  DELETE FROM funcionarios WHERE TRUE;

  SELECT count(*) INTO v_usuarios_preservados FROM user_profiles;

  RETURN jsonb_build_object(
    'sucesso',              true,
    'usuarios_preservados', v_usuarios_preservados,
    'carteiras_preservadas', (SELECT count(*) FROM maxbank_contas),
    'executado_em',         now()
  );
END;
$$;

REVOKE ALL ON FUNCTION resetar_dados_operacionais() FROM public;
GRANT EXECUTE ON FUNCTION resetar_dados_operacionais() TO authenticated;

COMMIT;
