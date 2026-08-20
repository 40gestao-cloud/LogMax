-- 486_20260819_a_reserva_de_codigo_tambem_sai_no_apagar_tudo.sql
--
-- Simetria: `produtos_codigo_reserva` entra também no reset GLOBAL.
--
-- A 485 a colocou na régua do reset por unidade e eu a deixei fora da global,
-- com o argumento de que é rascunho com prazo de 30 minutos. O argumento é o
-- mesmo nos dois lados, e nos dois lados ele é fraco: depois do APAGAR TUDO,
-- `produtos` fica vazia e o `max(codigo_seq)` volta a zero — mas uma reserva
-- viva da turma anterior faz o primeiro "Gerar" da turma nova devolver 002.
-- Número pulado no primeiro cadastro do curso, sem nada na tela que explique.
--
-- O impacto é pequeno e passa sozinho em meia hora. A assimetria é que não se
-- justifica: duas réguas que decidem a mesma coisa de formas diferentes é
-- exatamente o padrão de "régua copiada à mão" que a migr. 453 descreve, e a
-- próxima pessoa a ler as duas listas perderia tempo procurando a razão da
-- diferença — que não existe.
--
-- Nada mais muda. É CREATE OR REPLACE com o corpo copiado do banco (md5
-- f7fb54e5725adf61b848d6a93ec5e635, idêntico nas 4) e UM nome a mais no
-- TRUNCATE.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

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

  -- (394) O WHERE é obrigatório: `safeupdate` recusa DELETE sem qualificação.
  DELETE FROM desenvolvimentos_ia WHERE id IS NOT NULL;

  -- Mantém só o placar da competição das filiais.
  DELETE FROM avaliacoes WHERE tipo IS DISTINCT FROM 'matriz_filial';

  -- (393) Conta bancária é parametrização e fica; o saldo vai embora.
  UPDATE caixa_bancos SET saldo = 0 WHERE saldo IS DISTINCT FROM 0;

  TRUNCATE TABLE
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    contas_receber, contas_pagar, previsoes, duplicatas,
    integracoes_bancarias, controle_caixa, emprestimos_filial,
    ponto_eletronico, ponto_qr_registros, folha_pagamento, ferias,
    afastamentos, beneficios_pendentes, justificativas_falta,
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
    -- (482) `fornecedores` saiu daqui: CNPJ, prazo, condição de pagamento e
    -- logo no bucket são fundo de cadastro, não exercício.
    produtos, servicos, clientes,
    projetos,
    -- (486) Rascunho do botão "Gerar" (481). Sem isto, o primeiro código da
    -- turma nova pularia o número que a anterior tinha reservado e não salvou.
    -- Mesma decisão da 485 para o reset por unidade.
    produtos_codigo_reserva,
    -- (482) `categorias_produto` e `subcategorias_produto` saíram daqui: a
    -- categoria carrega o markup-alvo (migr. 360) que sugere o preço de venda,
    -- e sem ela o cadastro de produto não abre. O orçamento POR categoria
    -- continua zerando — é valor do exercício.
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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT prosrc LIKE '%produtos_codigo_reserva%' AS reserva_na_regua
--     FROM pg_proc WHERE proname = 'resetar_dados_operacionais';
--   -- espera t
--
-- As duas réguas passam a concordar sobre a tabela:
--
--   SELECT proname, prosrc LIKE '%produtos_codigo_reserva%' AS tem
--     FROM pg_proc
--    WHERE proname IN ('resetar_dados_operacionais', 'resetar_dados_da_filial');
--   -- espera t nas duas
-- ════════════════════════════════════════════════════════════════════════════
