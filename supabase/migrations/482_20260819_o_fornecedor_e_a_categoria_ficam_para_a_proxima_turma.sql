-- 482_20260819_o_fornecedor_e_a_categoria_ficam_para_a_proxima_turma.sql
--
-- APAGAR TUDO (`resetar_dados_operacionais`) passa a preservar **categorias de
-- produto** (com as subcategorias) e **fornecedores**. Decisão do professor.
--
-- A régua da 377 dividia o banco em duas famílias: exercício da turma (apaga) e
-- parametrização (fica). Fornecedor e categoria estavam do lado de apagar com o
-- argumento "cadastrá-los é exercício". Na prática eles se comportam como
-- parametrização:
--
--   • A categoria carrega o MARKUP-ALVO (migr. 360) — é ela que sugere o preço
--     de venda no cadastro de produto. Turma nova sem categoria abre o
--     formulário num beco: o select vem vazio, a validação exige `categoria_id`
--     e o primeiro produto não entra até alguém montar a árvore inteira de novo.
--   • O fornecedor tem CNPJ, prazo de entrega, condição de pagamento e logo no
--     bucket `cadastro-imagens` (migr. 429) — redigitar os 27 é trabalho de
--     digitação, não de aprendizado, e o bucket ficava com logo órfã a cada
--     reset.
--
-- O que continua sendo exercício e continua apagando: **produtos**, **serviços**
-- e **clientes**. Montar o catálogo é a aula; a carteira de clientes nasce da
-- venda. Só o fundo de cadastro em volta é que sobrevive.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE TIRAR DA LISTA É SEGURO (o grafo de FK, conferido nos 4)
--
-- A armadilha desta função nunca foi o que está na lista, e sim o que sai junto
-- por CASCADE. Duas direções, as duas checadas:
--
--   1. Quem APONTA para as três (viria junto por cascade, e passaria a
--      sobreviver se elas saíssem da lista):
--        fornecedores      ← contas_pagar, cotacoes, notas_recebidas, pedidos
--        categorias_produto← produtos, subcategorias_produto,
--                            orcamento_mensal_categoria
--        subcategorias     ← produtos
--      TODAS já estão nomeadas explicitamente no TRUNCATE. Nenhuma sobrevive
--      por tabela. `orcamento_mensal_categoria` fica na lista de propósito: o
--      orçamento por categoria é valor do exercício, não a categoria.
--
--   2. Para onde as três APONTAM (se apontassem para tabela truncada, elas
--      seriam levadas junto mesmo fora da lista — foi o que quase aconteceu com
--      `emprestimos_filial` na 377):
--        fornecedores → auth.users (criado_por, atualizado_por) — nunca truncada
--        subcategorias_produto → categorias_produto — as duas ficam
--      Nada mais. Sem caminho de cascade que as alcance.
--
-- Subcategoria vem junto com categoria de propósito: preservar a categoria e
-- zerar as subcategorias deixaria a árvore pela metade, e é a mesma tela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O RESTO DA FUNÇÃO NÃO É TOCADO
--
-- É CREATE OR REPLACE com o corpo COPIADO DO BANCO (md5 8343b47436de25232c8f9ff
-- 6612a4d83, idêntico nas 4 turmas), com três nomes fora da lista e dois
-- contadores novos no retorno. Os DELETEs seletivos da 393/394 (o `WHERE id IS
-- NOT NULL` que o `safeupdate` exige, o placar da competição, o saldo dos
-- bancos) seguem exatamente como estavam.
--
-- `resetar_dados_operacionais_admin` (migr. 412) não é tocada: ela é só o guard
-- de `role = 'admin'` na frente desta.
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
    -- NOTA (482): `fornecedores` saiu do TRUNCATE — CNPJ, prazo, condição de
    -- pagamento e logo no bucket são fundo de cadastro, não exercício. Quem
    -- apontava para ele (contas_pagar, cotacoes, notas_recebidas, pedidos)
    -- está nomeado acima e zera do mesmo jeito.
    produtos, servicos, clientes,
    projetos,
    -- Catálogo de categorias/orçamento
    -- NOTA (482): `categorias_produto` e `subcategorias_produto` saíram do
    -- TRUNCATE — a categoria carrega o markup-alvo (migr. 360) que sugere o
    -- preço de venda, e sem ela o cadastro de produto não abre. O orçamento
    -- POR categoria continua zerando: é valor do exercício.
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
    -- (482) Os dois novos. Contam só o que está ativo: o que a turma anterior
    -- mandou para a Lixeira continua lá, mas dizer "27 fornecedores" incluindo
    -- os apagados faria o professor conferir um número que a tela não mostra.
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
--   SELECT prosrc LIKE '%fornecedores,%'        AS ainda_trunca_fornecedor,
--          prosrc LIKE '%categorias_produto,%'  AS ainda_trunca_categoria
--     FROM pg_proc WHERE proname = 'resetar_dados_operacionais';
--   -- espera f, f
--
-- TESTE (turma de treino, NUNCA numa turma em aula):
--   antes:  SELECT count(*) FROM fornecedores;  SELECT count(*) FROM categorias_produto;
--   roda o APAGAR TUDO pela tela (Usuários → admin)
--   depois: os dois counts iguais; produtos, servicos e clientes em 0
--   e o retorno traz fornecedores_preservados / categorias_preservadas
-- ════════════════════════════════════════════════════════════════════════════
