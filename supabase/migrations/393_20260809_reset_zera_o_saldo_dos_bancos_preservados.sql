-- 393_20260809_reset_zera_o_saldo_dos_bancos_preservados.sql
--
-- Efeito colateral da 377: ao tirar `caixa_bancos` do TRUNCATE para preservar
-- a parametrização (nome, banco, agência, conta, filial, logo no bucket
-- `banco-logos`), o campo `saldo` foi junto — e ele NÃO é parametrização, é
-- dinheiro.
--
-- Hoje, com a régua vigente, um reset deixa a turma nova assim:
--   caixa_bancos.saldo ....... intacto (LogMax-ERP: R$ 2.353.557,80 em 9 contas)
--   capital_filial ........... zerado (TRUNCATE)
--   controle_caixa ........... zerado (TRUNCATE)
--   contas_pagar / receber ... zerado (TRUNCATE)
--   movimentacoes_caixa ...... zerado (cascade)
--
-- Ou seja: o saldo sobrevive sem nenhum lançamento que o explique. Isso
-- desfaz exatamente o que a 327 comprou ("o saldo é CONSEQUÊNCIA, nunca
-- entrada") — antes dela o dinheiro nascia digitado no formulário; depois da
-- 377 ele nasce herdado da turma anterior. A comprovação está na própria 327,
-- que lista `resetar_dados_operacionais` entre as funções que mexem em saldo
-- "que zera tudo no reset de turma": naquele momento zerava mesmo, porque
-- `caixa_bancos` ainda estava no TRUNCATE.
--
-- E a filial não tem como corrigir pela tela: a 327 revogou UPDATE da coluna
-- `saldo` para `authenticated`. Só uma função SECURITY DEFINER pode zerar.
--
-- Correção: um UPDATE junto das outras limpezas seletivas. A conta continua
-- cadastrada, com logo e filial; só o dinheiro volta pra R$ 0,00, que é o
-- DEFAULT da coluna desde a 327. O aporte da Matriz (registrar_aporte_capital)
-- volta a ser o começo real do fluxo de capital.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2) GOVERNANÇA (378-385) ENTRA NO TRUNCATE
-- ────────────────────────────────────────────────────────────────────────────
-- Quinze migrações entraram depois da 377 e nenhuma delas passou pela régua do
-- reset. As tabelas de governança atravessavam o APAGAR TUDO intactas. Hoje
-- estão todas em 0 linhas nos 4 projetos, então isso nunca chegou a morder —
-- morderia na primeira turma que usasse as telas.
--
-- Entram (ato de um exercício específico, morre com a turma):
--   orcamentos_periodo   (378) → orcamento_itens
--   prestacoes_contas    (379) → prestacao_pareceres
--   destinacoes_resultado(381)
--   apuracoes_bonus      (382) → apuracao_bonus_itens
--   mandatos             (383)
--   riscos               (385) → risco_revisoes      ┐ órfãs: perderam a tela
--   auditoria_revisoes   (380)                       ┘ no refactor de governança
--
-- FICA de fora, de propósito: `politicas_remuneracao` (382). É a régua do
-- bônus ("X% do placar"), mesma família de rh_faixas e alcadas_compra —
-- parametrização, não exercício. E `apuracoes_bonus.politica_id` é ON DELETE
-- RESTRICT, ou seja, a apuração é a filha: truncar a apuração não a arrasta.
--
-- As filhas não precisam ser escritas (vêm por CASCADE), mas o fecho foi
-- conferido: a partir dessas 7 caem exatamente 11 tabelas, todas do bloco.
-- Nada de fora, e `politicas_remuneracao` não aparece.
--
-- Resto da função: cópia byte-a-byte da versão vigente (377, md5
-- 551eb1fa2871c9d147adcc01ca372253 nos 4 projetos).
--
-- Idempotente.

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
    -- CASCADE. `politicas_remuneracao` NÃO entra: é a régua do bônus.
    orcamentos_periodo, prestacoes_contas, destinacoes_resultado,
    apuracoes_bonus, mandatos, riscos, auditoria_revisoes,
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
    'politicas_bonus_preservadas', (SELECT count(*) FROM politicas_remuneracao),
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
--   SELECT count(*) FROM politicas_remuneracao;             -- régua do bônus de pé
--   SELECT count(*) FROM mandatos;                          -- 0 (e o resto do bloco)
