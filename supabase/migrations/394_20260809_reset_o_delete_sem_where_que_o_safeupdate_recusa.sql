-- 394_20260809_reset_o_delete_sem_where_que_o_safeupdate_recusa.sql
--
-- Sintoma: "Erro no reset: DELETE requires a WHERE clause" ao clicar em
-- APAGAR TUDO. O reset não roda — nada é apagado, a transação inteira aborta
-- na primeira instrução.
--
-- Causa: o role `authenticator`, que é por onde o PostgREST conecta, carrega
-- a extensão `safeupdate` via session_preload_libraries:
--
--   authenticator → session_preload_libraries=supautils, safeupdate
--
-- Ela recusa DELETE e UPDATE sem WHERE. Vale para a SESSÃO inteira, então
-- SECURITY DEFINER não escapa: a função roda como o dono, mas na sessão do
-- `authenticator`. Roda liso no SQL Editor (outro role, sem a extensão) e
-- falha pelo app — o que explica a migração 377 ter passado despercebida.
--
-- Quem quebrou: a 377 (2026-08-07) introduziu `DELETE FROM desenvolvimentos_ia;`
-- sem WHERE. Desde então o APAGAR TUDO nunca funcionou pelo app. O segundo
-- DELETE (`WHERE tipo IS DISTINCT FROM 'matriz_filial'`) e o UPDATE de saldo
-- da 393 já têm WHERE e passam.
--
-- Correção: `WHERE id IS NOT NULL`. Não é enfeite — `WHERE true` é eliminado
-- pelo planejador e a extensão continua vendo um DELETE sem qualificação. Um
-- predicado sobre coluna NOT NULL sobrevive ao plano e apaga a tabela inteira.
--
-- Bônus, do mesmo diagnóstico: `authenticator` também traz
-- `statement_timeout=8s`. O TRUNCATE do reset passa por ~80 tabelas com
-- RESTART IDENTITY CASCADE, e 8s é apertado num projeto com movimento. A
-- função passa a declarar o próprio timeout — vale só durante a chamada e
-- volta ao normal ao sair.
--
-- Resto da função: cópia da versão vigente (393, md5
-- 01dbbcdaf37eca92b2cfe6d11498f177 nos 4 projetos).
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
--
-- REGRA PRA QUEM MEXER NESTA FUNÇÃO NO FUTURO: todo DELETE e todo UPDATE aqui
-- dentro precisa de WHERE, senão o reset morre pelo app e passa no SQL Editor.
