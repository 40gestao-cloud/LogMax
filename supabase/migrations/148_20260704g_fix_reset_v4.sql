-- =================================================================
-- Fix v4: resetar_dados_operacionais — corrige v3 quebrado
--
-- Problemas do v3 (20260704f_fix_reset_v3.sql) que esta migration resolve:
--   1. Erro de sintaxe: faltava vírgula entre `orcamento_mensal_categoria`
--      e `funcionarios` no TRUNCATE. O comentário não conta como separador
--      e o parser cospe syntax error — a v3 nunca chegou a aplicar.
--   2. Erro semântico: mesmo com a vírgula, `TRUNCATE funcionarios CASCADE`
--      apagaria user_profiles junto porque existe FK
--      `user_profiles.funcionario_id → funcionarios.id`. O UPDATE que zera
--      funcionario_id não desativa a constraint — TRUNCATE CASCADE percorre
--      a definição de FK, não os valores. Voltamos ao padrão da v2:
--      DELETE FROM funcionarios (que respeita ON DELETE SET NULL).
--
-- O que preserva: user_profiles, auth.users, maxbank_contas, filiais.
-- O que apaga: todo o transacional + cadastros operacionais + funcionarios.
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

  -- Quebra o link user_profiles → funcionarios antes do DELETE, garantindo
  -- que ON DELETE SET NULL não precise atuar em massa.
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

  -- funcionarios fora do TRUNCATE: DELETE respeita ON DELETE SET NULL
  -- do FK user_profiles.funcionario_id, preservando os usuários.
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
