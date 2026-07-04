-- =================================================================
-- Fix v3: resetar_dados_operacionais — tabelas corretas
--
-- Mudanças vs v2 (20260704_fix_reset_clientes_especiais.sql):
--   REMOVE do TRUNCATE:
--     • maxbank_creditos_folha  — tabela não existe (credito é RPC/coluna)
--     • filiais                 — preservar cadastro de filiais no reset
--   ADICIONA ao TRUNCATE (tabelas criadas em migrations posteriores):
--     • cartao_pendentes        — pagamentos cartão pendentes de confirmação
--     • justificativas_falta    — justificativas de falta do ponto
--     • categorias_produto      — catálogo de categorias (20260630)
--     • subcategorias_produto   — catálogo de subcategorias (20260630b)
--     • itens_campanha          — itens vinculados a campanhas (20260630b)
--     • orcamento_mensal_categoria — orçamento por categoria (20260630b)
--
--   NÃO toca:
--     • frequencia_trabalho     — preservada (não entrou no TRUNCATE)
--     • maxbank_config          — configuração, não operacional
--     • filiais, user_profiles, auth.users, maxbank_contas — preservados
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
    -- Cadastros gerais (filiais preservada)
    produtos, servicos, clientes, fornecedores,
    departamentos, cargos, beneficios,
    centros_custo, projetos, condicoes_pagamento,
    classificacoes_auxiliares, mapeamentos_rateio, formas_pagamento,
    caixa_bancos, configuracoes,
    -- Catálogo de categorias/orçamento
    categorias_produto, subcategorias_produto, orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

  DELETE FROM funcionarios;

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
