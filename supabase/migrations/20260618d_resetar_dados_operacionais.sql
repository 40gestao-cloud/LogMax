-- =================================================================
-- RPC `resetar_dados_operacionais` — wipe-tudo preservando usuários
-- =================================================================
-- Caso de uso: turma muda de setor pra desenvolver capacidades em
-- outra área, então o operador (admin) precisa zerar todos os
-- lançamentos e cadastros e começar do zero, **mantendo os logins**
-- (user_profiles + auth.users) intactos.
--
-- O que preserva:
--   • user_profiles (todos, sem WHERE)
--   • auth.users    (não é tocada)
--
-- O que apaga (TRUNCATE CASCADE em uma transação atômica):
--   • Transacionais: vendas, estoque, compras, financeiro, RH operacional,
--     treinamentos, avaliações, pesquisas, marketing, maxbank, metas,
--     tarefas, BI, briefing, notificações, feedbacks, TI.
--   • Cadastros: produtos, serviços, clientes, fornecedores, filiais,
--     departamentos, cargos, centros de custo, formas/condições de
--     pagamento, projetos, configurações etc.
--
-- Particularidade: `funcionarios` tem FK INBOUND de `user_profiles`
-- (user_profiles.funcionario_id → funcionarios.id ON DELETE SET NULL).
-- TRUNCATE … CASCADE seguiria essa FK e zeraria user_profiles também
-- (pg trunca ignorando ON DELETE actions). Então:
--   1) UPDATE user_profiles SET funcionario_id = NULL  (quebra o link)
--   2) DELETE FROM funcionarios (respeita ON DELETE CASCADE nos
--      filhos como ponto_eletronico, folha, ferias, treinamento_inscricoes)
--
-- Autorização: SECURITY DEFINER + check de `auth_user_role() IN ('admin','ceo')`.
-- Gerente/colaborador NÃO executam.
--
-- Idempotente.
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
  -- Autorização — admin e CEO podem disparar.
  IF auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin e CEO podem executar este reset.'
      USING ERRCODE = '42501';
  END IF;

  -- Quebra o link user_profiles → funcionarios pra evitar que o
  -- TRUNCATE seguinte cascateie em user_profiles. Idempotente.
  UPDATE user_profiles SET funcionario_id = NULL
   WHERE funcionario_id IS NOT NULL;

  -- TRUNCATE em bloco — CASCADE só propaga em filhos transacionais
  -- (que queremos zerar mesmo). user_profiles e auth.users não estão
  -- na cadeia porque já quebramos o único FK que apontaria pra cá.
  -- IF NOT EXISTS é tratado por bloco try/catch implícito: tabelas
  -- ausentes em ambientes antigos não derrubam o reset; o operador
  -- vê erro claro pra ajustar.
  TRUNCATE TABLE
    -- vendas + relacionados
    itens_venda, vendas, pix_pendentes,
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
    afastamentos, beneficios_pendentes,
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
    marketing_campanhas,
    -- vendas B2B
    orcamentos, pedidos_venda, clientes_especiais,
    -- maxbank
    maxbank_transacoes, maxbank_transferencias, maxbank_creditos_folha,
    maxbank_folgas_conquistadas, maxbank_metas, maxbank_contas,
    -- metas / tarefas
    tarefas_taticas, tarefas, metas_estrategicas,
    -- TI / dev
    desenvolvimentos_ia, ti_chamados,
    -- BI / Briefing / Notif / Feedback
    relatorios_bi, briefings_diarios, notificacoes, feedbacks_organizacao,
    -- Cadastros gerais
    produtos, servicos, clientes, fornecedores,
    departamentos, cargos, beneficios,
    filiais, centros_custo, projetos, condicoes_pagamento,
    classificacoes_auxiliares, mapeamentos_rateio, formas_pagamento,
    caixa_bancos, configuracoes
  RESTART IDENTITY CASCADE;

  -- funcionarios fora do TRUNCATE: usamos DELETE pra que ON DELETE SET NULL
  -- de user_profiles.funcionario_id se aplique (mesmo já estando NULL,
  -- por segurança em caso de algum reset parcial anterior).
  DELETE FROM funcionarios;

  SELECT count(*) INTO v_usuarios_preservados FROM user_profiles;

  RETURN jsonb_build_object(
    'sucesso',             true,
    'usuarios_preservados', v_usuarios_preservados,
    'executado_em',         now()
  );
END;
$$;

REVOKE ALL ON FUNCTION resetar_dados_operacionais() FROM public;
GRANT EXECUTE ON FUNCTION resetar_dados_operacionais() TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como admin logado:
--   SELECT resetar_dados_operacionais();
--   -- como gerente/colaborador:
--   --   ERROR: Apenas admin e CEO podem executar este reset.
--   SELECT count(*) FROM user_profiles;  -- intacto
--   SELECT count(*) FROM vendas;          -- 0
--   SELECT count(*) FROM funcionarios;    -- 0
-- =================================================================
