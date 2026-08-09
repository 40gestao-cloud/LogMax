-- 395_20260809_reset_leva_a_politica_de_bonus_junto.sql
--
-- A 393 preservou `politicas_remuneracao` no APAGAR TUDO com um argumento que
-- deixou de valer no dia seguinte: "é a régua do bônus, parametrização, mesma
-- família de rh_faixas e alcadas_compra".
--
-- Em 2026-08-09 o módulo Remuneração Variável saiu do produto (backlog #G2,
-- mesma decisão de escopo do #G5/#G8). Sem tela, ela não é régua de nada — é
-- linha órfã que a turma nova herdaria sem ter como ver nem editar. Entra no
-- TRUNCATE, junto de `apuracoes_bonus`, que a 393 já levava.
--
-- Não há ordem a respeitar: `apuracoes_bonus.politica_id` é ON DELETE RESTRICT,
-- mas TRUNCATE das duas na mesma instrução não dispara verificação de FK.
--
-- As tabelas continuam no schema, como `riscos` e `auditoria_revisoes`. Se um
-- dia forem dropadas de vez, é migração à parte — e aí estas três linhas saem
-- da lista junto.
--
-- Resto da função: cópia da versão vigente (394, md5
-- 04eebe4de8897f5b9ad94ba478bbadc6 nos 4 projetos).
--
-- Idempotente.

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

  -- ── Limpezas seletivas ANTES do TRUNCATE ────────────────────────────────
  -- Ordem importa: desenvolvimentos_ia primeiro, porque seu cascade tira de
  -- `avaliacoes` as linhas de TI; depois some o resto que não é placar.

  -- (394) O WHERE é obrigatório: `safeupdate` está pré-carregada no role
  -- `authenticator` e recusa DELETE sem qualificação. `id IS NOT NULL`
  -- sobrevive ao planejador (ao contrário de `WHERE true`) e pega tudo.
  DELETE FROM desenvolvimentos_ia WHERE id IS NOT NULL;

  -- Mantém só o placar da competição das filiais. As filhas
  -- (criterios_avaliacao, feedbacks_avaliacao, pdi_itens) vêm por
  -- ON DELETE CASCADE.
  DELETE FROM avaliacoes WHERE tipo IS DISTINCT FROM 'matriz_filial';

  -- (393) A conta bancária é parametrização e fica; o saldo é dinheiro da
  -- turma anterior e vai embora. Sem isso o capital nasceria herdado, e a
  -- 327 tinha justamente acabado com dinheiro que aparece sem lançamento.
  UPDATE caixa_bancos SET saldo = 0 WHERE saldo IS DISTINCT FROM 0;

  TRUNCATE TABLE
    -- vendas + relacionados
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    -- estoque
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    -- compras
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    -- financeiro
    -- NOTA: caixa_bancos fora do TRUNCATE (377) — parametrização preservada,
    -- saldo zerado pelo UPDATE acima (393).
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
    -- Governança (393) — atos do exercício. As filhas (orcamento_itens,
    -- prestacao_pareceres, apuracao_bonus_itens, risco_revisoes) vêm por
    -- CASCADE. `politicas_remuneracao` entrou na 395: o módulo Remuneração
    -- Variável saiu do produto, então a régua ficou sem tela e sem dono.
    orcamentos_periodo, prestacoes_contas, destinacoes_resultado,
    apuracoes_bonus, politicas_remuneracao, mandatos, riscos,
    auditoria_revisoes,
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
    'contas_bancarias_zeradas', (SELECT count(*) FROM caixa_bancos),
    'executado_em',             now()
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- DEPOIS DO RESET, conferir:
--   SELECT sum(saldo), count(*) FROM caixa_bancos;          -- 0,00 e N contas
--   SELECT * FROM avaliacoes_matriz_placar_filial;          -- placar de pé
--   SELECT tipo, count(*) FROM avaliacoes GROUP BY 1;       -- só 'matriz_filial'
--   SELECT count(*) FROM politicas_remuneracao;             -- 0 (e o resto do bloco)
--
-- REGRA PRA QUEM MEXER NESTA FUNÇÃO NO FUTURO: todo DELETE e todo UPDATE aqui
-- dentro precisa de WHERE, senão o reset morre pelo app e passa no SQL Editor.
