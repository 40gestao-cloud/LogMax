-- =================================================================
-- Fix v6: resetar_dados_operacionais
--
-- Passa a preservar mais 3 conjuntos de cadastro (além dos usuários,
-- carteiras MaxBank e filiais já preservados no v5):
--   1. funcionarios         — remove DELETE FROM funcionarios; user_profiles.
--                             funcionario_id continua válido, então o UPDATE
--                             que zerava esse FK também sai.
--   2. frequencia_trabalho  — sai do TRUNCATE (histórico preservado).
--
-- Filiais já eram preservadas desde v5 (nunca entraram no TRUNCATE).
--
-- Motivação: ao trocar a turma que opera o LogMax, a operação zera todo
-- histórico transacional, mas o cadastro base de pessoas / vínculo /
-- histórico de frequência deve sobreviver para dar continuidade ao RH
-- e à contagem de tempo dos funcionários.
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
    -- NOTA: frequencia_trabalho fora do TRUNCATE (v6) — histórico preservado.
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
    -- Votações e votos (votos antes de votações por FK)
    votacoes_votos, votacoes,
    -- Capital e requerimentos
    capital_filial, requerimentos,
    -- Cadastros gerais (filiais e funcionarios preservados)
    produtos, servicos, clientes, fornecedores,
    departamentos, cargos, beneficios,
    centros_custo, projetos, condicoes_pagamento,
    classificacoes_auxiliares, mapeamentos_rateio, formas_pagamento,
    caixa_bancos, configuracoes,
    -- Catálogo de categorias/orçamento
    categorias_produto, subcategorias_produto, orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

  SELECT count(*) INTO v_usuarios_preservados FROM user_profiles;

  RETURN jsonb_build_object(
    'sucesso',                 true,
    'usuarios_preservados',    v_usuarios_preservados,
    'funcionarios_preservados',(SELECT count(*) FROM funcionarios),
    'carteiras_preservadas',   (SELECT count(*) FROM maxbank_contas),
    'filiais_preservadas',     (SELECT count(*) FROM filiais),
    'frequencia_preservada',   (SELECT count(*) FROM frequencia_trabalho),
    'executado_em',            now()
  );
END;
$$;

REVOKE ALL ON FUNCTION resetar_dados_operacionais() FROM public;
GRANT EXECUTE ON FUNCTION resetar_dados_operacionais() TO authenticated;

COMMIT;
