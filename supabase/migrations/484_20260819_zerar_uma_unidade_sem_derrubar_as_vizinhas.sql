-- 484_20260819_zerar_uma_unidade_sem_derrubar_as_vizinhas.sql
--
-- `resetar_dados_da_filial(filial, dry_run)` — o APAGAR TUDO de UMA unidade.
-- Mesma régua da global (`resetar_dados_operacionais`, migr. 482): tudo que ela
-- apaga, esta apaga; tudo que ela preserva, esta preserva. A única diferença é
-- o `WHERE`.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUE NÃO É SÓ "A GLOBAL COM UM WHERE"
--
-- A global usa `TRUNCATE ... CASCADE`, e o CASCADE esconde metade do trabalho:
-- ela nomeia 74 tabelas e derruba **95**. As outras 21 vêm de carona e nunca
-- foram escritas em lugar nenhum:
--
--   apuracao_bonus_itens, consumos_material, contas_pagar_baixas,
--   contas_receber_baixas, controle_caixa_reaberturas, devolucoes,
--   devolucoes_fornecedor, folha_credito_falhas, folha_rubricas,
--   itens_devolucao, movimentacoes_caixa, notas_emitidas, orcamento_itens,
--   parcelas_emprestimo, pedidos_online, pedidos_online_itens,
--   prestacao_pareceres, produto_unidades, produtos_custo,
--   rateio_administrativo_itens, risco_revisoes
--
-- DELETE não tem esse luxo: o que a FK não apaga em cascata, ele esbarra. A
-- lista abaixo é o fecho transitivo calculado no banco, não uma lista de
-- memória.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A ORDEM: RESOLVIDA POR REPETIÇÃO, NÃO POR ACERTO
--
-- Ordenar 95 DELETEs à mão é onde este tipo de função morre — basta uma FK
-- `NO ACTION` fora de ordem (e há várias: parcelas_emprestimo → contas_pagar,
-- notas_emitidas → vendas, itens_venda → produtos) para a coisa estourar em
-- produção, ou pior, para alguém "consertar" removendo a tabela da lista.
--
-- Então não se tenta acertar a ordem. Passa-se pela lista várias vezes,
-- engolindo violação de FK, até uma passada não conseguir apagar mais nada. No
-- fim, CONFERE: se sobrou uma linha que devia ter saído, levanta exceção e a
-- transação inteira volta atrás. O resultado é all-or-nothing e não depende de
-- eu ter adivinhado a topologia certa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O DINHEIRO QUE ATRAVESSA A FRONTEIRA
--
-- Duas coisas ligam a unidade à Matriz, e as duas são tratadas:
--
--   1. **A contrapartida do mútuo.** `aprovar_emprestimo` cria a parcela como
--      DOIS documentos: contas_pagar da filial e contas_receber da MATRIZ,
--      amarrados em `parcelas_emprestimo`. Apagar só o lado da filial deixaria
--      a Matriz cobrando um empréstimo que não existe. A função apaga o lado de
--      lá pelo elo, não por descrição.
--
--   2. **O saldo do banco financiador.** Aporte (`capital_filial`) e mútuo saem
--      de uma conta da Matriz. Zerar a filial sem devolver deixaria a Matriz
--      pobre por causa de um lançamento apagado — o oposto do que a migr. 327
--      manda ("saldo é consequência, nunca entrada"). O valor volta para o
--      `banco_origem_id` / `banco_id`, que é o mesmo caminho que
--      `estornar_aporte_capital` (migr. 475) já usa.
--
-- Contas da própria filial são zeradas, como a global faz com todas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE FICA DE FORA, E POR QUE
--
-- Quatro tabelas da régua global NÃO entram aqui: `feedbacks_organizacao`
-- (anônimo de propósito — filtrar por unidade estreitaria o anonimato até
-- identificar quem escreveu), `briefings_diarios`, `relatorios_bi` e
-- `desenvolvimentos_ia`. As quatro são da organização, não de uma unidade.
-- Quem quiser zerá-las usa o APAGAR TUDO global, que continua existindo.
--
-- `Matriz` não é resetável por aqui: ela é a contraparte de todo mundo, e zerá-la
-- deixaria as três unidades com aporte e mútuo apontando para o vazio. Para isso
-- existe a global.
--
-- ════════════════════════════════════════════════════════════════════════════
-- MODO DE ENSAIO
--
-- `p_dry_run` é **true por padrão**. Nessa forma nada é apagado: devolve a
-- contagem por tabela do que sairia. Quem quer apagar diz explicitamente
-- `false` — o default de uma função destrutiva não pode ser destruir.
--
-- IDEMPOTENTE. NÃO aplicar em turma com aula em andamento sem ensaiar antes
-- (ver ENSAIO no rodapé).

BEGIN;

CREATE OR REPLACE FUNCTION public.resetar_dados_da_filial(
  p_filial  text,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  -- tabela | WHERE (com $1 = p_filial). Ordem aqui é só legibilidade: quem
  -- resolve a dependência é o laço de repetição.
  v_alvos text[][] := ARRAY[
    -- ── Vendas ────────────────────────────────────────────────────────────
    ['itens_venda',      'venda_id IN (SELECT id FROM public.vendas WHERE filial = $1)'],
    ['notas_emitidas',   'filial = $1'],
    ['devolucoes',       'filial = $1'],
    ['itens_devolucao',  'devolucao_id IN (SELECT id FROM public.devolucoes WHERE filial = $1)'],
    ['vendas',           'filial = $1'],
    ['pix_pendentes',    'filial = $1'],
    ['cartao_pendentes', 'filial = $1'],
    -- `filial_pdv`, não `filial`: a coluna nasceu com outro nome no MaxPOS.
    ['beneficios_pendentes', 'filial_pdv = $1'],
    ['pedidos_online_itens', 'pedido_id IN (SELECT id FROM public.pedidos_online WHERE filial = $1)'],
    ['pedidos_online',       'filial = $1'],
    -- ── Estoque ───────────────────────────────────────────────────────────
    ['movimentacoes_estoque', 'filial = $1'],
    ['produto_unidades',      'filial = $1'],
    ['vencimentos_estoque',   'filial = $1'],
    ['inventarios',           'filial = $1'],
    ['expedicao',             'filial = $1'],
    ['requisicoes_estoque',   'filial = $1'],
    ['aprovacoes_estoque',    'filial = $1'],
    ['consumos_material',     'filial = $1'],
    ['devolucoes_fornecedor', 'filial = $1'],
    ['notas_recebidas',       'filial = $1'],
    ['recebimentos',          'filial = $1'],
    -- ── Compras ───────────────────────────────────────────────────────────
    ['pedidos',            'filial = $1'],
    ['cotacoes',           'filial = $1'],
    ['aprovacoes_compras', 'filial = $1'],
    ['requisicoes',        'filial = $1'],
    -- ── Financeiro ────────────────────────────────────────────────────────
    -- parcelas_emprestimo ANTES das contas: a FK é NO ACTION nos dois lados.
    ['parcelas_emprestimo', 'emprestimo_id IN (SELECT id FROM public.emprestimos_filial WHERE filial = $1)'],
    -- O outro lado, na Matriz. Só o que pertence a empréstimo DESTA unidade.
    ['contas_receber',      'id IN (SELECT p.contas_receber_id FROM public.parcelas_emprestimo p'
                         || ' JOIN public.emprestimos_filial e ON e.id = p.emprestimo_id'
                         || ' WHERE e.filial = $1)'],
    ['contas_receber_baixas', 'filial = $1'],
    ['contas_pagar_baixas',   'filial = $1'],
    ['rateio_administrativo_itens', 'filial = $1'],
    ['folha_credito_falhas',  'filial = $1'],
    ['contas_receber',        'filial = $1'],
    ['contas_pagar',          'filial = $1'],
    ['previsoes',             'filial = $1'],
    ['duplicatas',            'filial = $1'],
    ['integracoes_bancarias', 'filial = $1'],
    ['movimentacoes_caixa',   'filial = $1'],
    ['controle_caixa_reaberturas', 'filial = $1'],
    ['controle_caixa',        'filial = $1'],
    ['emprestimos_filial',    'filial = $1'],
    ['capital_filial',        'filial = $1'],
    -- ── RH ────────────────────────────────────────────────────────────────
    ['ponto_eletronico',    'filial = $1'],
    ['ponto_qr_registros',  'user_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['folha_rubricas',      'folha_id IN (SELECT id FROM public.folha_pagamento WHERE filial = $1)'],
    ['folha_pagamento',     'filial = $1'],
    ['maxbank_folgas_conquistadas',
                            'colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['ferias',              'filial = $1'],
    ['afastamentos',        'filial = $1'],
    ['justificativas_falta','funcionario_id IN (SELECT id FROM public.funcionarios WHERE filial = $1)'],
    ['treinamento_inscricoes',
                            'funcionario_id IN (SELECT id FROM public.funcionarios WHERE filial = $1)'],
    -- ── Pesquisas ─────────────────────────────────────────────────────────
    ['pesquisa_resposta_itens',
       'resposta_id IN (SELECT r.id FROM public.pesquisa_respostas r'
    || ' JOIN public.pesquisas p ON p.id = r.pesquisa_id WHERE p.filial = $1)'],
    ['pesquisa_respostas', 'pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisa_perguntas', 'pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisas',          'filial = $1'],
    -- ── Marketing ─────────────────────────────────────────────────────────
    ['marketing_arte_feedback', 'arte_id IN (SELECT id FROM public.marketing_artes WHERE filial = $1)'],
    ['marketing_artes',     'filial = $1'],
    ['marketing_tarefas',   'filial = $1'],
    ['marketing_promocoes', 'filial = $1'],
    ['marketing_calendario','filial = $1'],
    ['marketing_cupons',    'filial = $1'],
    ['itens_campanha',      'campanha_id IN (SELECT id FROM public.marketing_campanhas WHERE filial = $1)'],
    ['marketing_campanhas', 'filial = $1'],
    -- ── B2B ───────────────────────────────────────────────────────────────
    ['orcamentos',    'filial = $1'],
    ['pedidos_venda', 'filial = $1'],
    -- ── MaxBank ───────────────────────────────────────────────────────────
    -- As CONTAS ficam (a global também as preserva, com saldo). Some o
    -- histórico. Transferência entre pessoas de unidades diferentes sai pelos
    -- dois lados: o registro é um só, e o saldo de ninguém depende dele.
    ['maxbank_transacoes',
       'conta_id IN (SELECT c.id FROM public.maxbank_contas c'
    || ' JOIN public.user_profiles u ON u.id = c.colaborador_id WHERE u.filial = $1)'],
    ['maxbank_transferencias',
       'de_colaborador_id   IN (SELECT id FROM public.user_profiles WHERE filial = $1)'
    || ' OR para_colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['maxbank_metas', 'filial = $1'],
    -- ── Metas e tarefas ───────────────────────────────────────────────────
    ['tarefas_taticas',
       'meta_estrategica_id IN (SELECT m.id FROM public.metas_estrategicas m'
    || ' JOIN public.user_profiles u ON u.id = m.criada_por WHERE u.filial = $1)'],
    ['metas_estrategicas',
       'criada_por IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['tarefas', 'filial = $1'],
    -- ── TI, avisos, pedidos internos ──────────────────────────────────────
    ['ti_chamados',   'filial = $1'],
    ['notificacoes',  'filial = $1'],
    ['requerimentos', 'filial = $1'],
    ['votacoes_votos','votacao_id IN (SELECT v.id FROM public.votacoes v'
                   || ' JOIN public.user_profiles u ON u.id = v.criador_id WHERE u.filial = $1)'],
    ['votacoes',      'criador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    -- ── Governança ────────────────────────────────────────────────────────
    ['orcamento_itens',   'orcamento_id IN (SELECT id FROM public.orcamentos_periodo WHERE filial = $1)'],
    ['orcamentos_periodo','filial = $1'],
    ['prestacao_pareceres','prestacao_id IN (SELECT id FROM public.prestacoes_contas WHERE filial = $1)'],
    ['prestacoes_contas', 'filial = $1'],
    ['destinacoes_resultado', 'filial = $1'],
    ['apuracao_bonus_itens',  'filial = $1'],
    ['mandatos',          'filial = $1'],
    ['risco_revisoes',    'risco_id IN (SELECT id FROM public.riscos WHERE filial = $1)'],
    ['riscos',            'filial = $1'],
    ['auditoria_revisoes','filial = $1'],
    ['orcamento_mensal_categoria', 'filial = $1'],
    -- ── Avaliações: só o que NÃO é o placar da competição (mesma régua 377) ─
    ['avaliacoes', 'filial = $1 AND tipo IS DISTINCT FROM ''matriz_filial'''],
    -- ── Cadastros que são exercício (fornecedor e categoria ficam — migr. 482)
    ['produtos_custo', 'produto_id IN (SELECT id FROM public.produtos WHERE filial = $1)'],
    ['produtos',  'filial = $1'],
    ['servicos',  'filial = $1'],
    ['clientes',  'filial = $1'],
    ['projetos',  'filial = $1']
  ];

  v_tab        text;
  v_where      text;
  v_i          int;
  v_passada    int;
  v_apagou     bigint;
  v_total      bigint := 0;
  v_progresso  boolean;
  v_restou     text := '';
  v_contagem   jsonb := '{}'::jsonb;
  v_estorno    jsonb := '[]'::jsonb;
  v_devolvido  numeric := 0;
  v_zeradas    int := 0;
  r            record;
BEGIN
  IF auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin e CEO podem executar este reset.'
      USING ERRCODE = '42501';
  END IF;

  -- Mesma lista de `conceder_mutuo_capital`: unidade operacional, não a holding.
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax', 'MaxLook', 'TechMax') THEN
    RAISE EXCEPTION
      'Reset por unidade é de SuperMax, MaxLook ou TechMax — recebi %. A Matriz é a contraparte de todas: zerá-la sozinha deixaria aporte e mútuo das três apontando para o vazio. Para isso existe o APAGAR TUDO.',
      COALESCE(p_filial, '(vazio)') USING ERRCODE = 'P0001';
  END IF;

  -- ── 1. O estorno, medido ANTES de apagar ────────────────────────────────
  -- Aporte e mútuo saíram de uma conta que fica (quase sempre da Matriz). O
  -- valor volta para lá. Conta da própria unidade não entra: ela vai a zero
  -- logo abaixo, e creditar para depois zerar só confundiria o relatório.
  FOR r IN
    SELECT b.id AS banco_id,
           COALESCE(b.banco, b.conta) AS banco_nome,
           SUM(x.valor) AS valor
      FROM (
        SELECT banco_origem_id AS banco, valor
          FROM public.capital_filial
         WHERE filial = p_filial AND banco_origem_id IS NOT NULL
        UNION ALL
        SELECT banco_id, valor
          FROM public.emprestimos_filial
         WHERE filial = p_filial AND status = 'Aprovado' AND banco_id IS NOT NULL
      ) x
      JOIN public.caixa_bancos b ON b.id = x.banco
     WHERE b.filial IS DISTINCT FROM p_filial
     GROUP BY b.id, COALESCE(b.banco, b.conta)
  LOOP
    v_estorno := v_estorno || jsonb_build_object(
      'banco', r.banco_nome, 'devolvido', r.valor);
    v_devolvido := v_devolvido + r.valor;
    IF NOT p_dry_run THEN
      UPDATE public.caixa_bancos
         SET saldo = COALESCE(saldo, 0) + r.valor
       WHERE id = r.banco_id;
    END IF;
  END LOOP;

  -- ── 2. As exclusões, por repetição até parar de render ──────────────────
  IF p_dry_run THEN
    FOR v_i IN 1 .. array_length(v_alvos, 1) LOOP
      v_tab   := v_alvos[v_i][1];
      v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN
        v_contagem := v_contagem || jsonb_build_object(v_tab,
          COALESCE((v_contagem ->> v_tab)::bigint, 0) + v_apagou);
        v_total := v_total + v_apagou;
      END IF;
    END LOOP;
  ELSE
    -- 6 passadas cobrem folgadamente a profundidade real do grafo (a mais
    -- funda tem 4 níveis). O que importa é a conferência do passo 3.
    FOR v_passada IN 1 .. 6 LOOP
      v_progresso := false;
      FOR v_i IN 1 .. array_length(v_alvos, 1) LOOP
        v_tab   := v_alvos[v_i][1];
        v_where := v_alvos[v_i][2];
        BEGIN
          EXECUTE format(
            'WITH del AS (DELETE FROM public.%I WHERE %s RETURNING 1) SELECT count(*) FROM del',
            v_tab, v_where) INTO v_apagou USING p_filial;
          IF v_apagou > 0 THEN
            v_progresso := true;
            v_contagem := v_contagem || jsonb_build_object(v_tab,
              COALESCE((v_contagem ->> v_tab)::bigint, 0) + v_apagou);
            v_total := v_total + v_apagou;
          END IF;
        EXCEPTION
          -- Filha ainda de pé: fica para a próxima passada. Se nunca sair, o
          -- passo 3 derruba a transação inteira.
          WHEN foreign_key_violation THEN
            NULL;
        END;
      END LOOP;
      EXIT WHEN NOT v_progresso;
    END LOOP;

    -- ── 3. A conferência ─────────────────────────────────────────────────
    -- Sobrou linha que devia ter saído? A transação inteira volta. Meio-reset
    -- é pior que reset nenhum: ninguém sabe o que ficou.
    FOR v_i IN 1 .. array_length(v_alvos, 1) LOOP
      v_tab   := v_alvos[v_i][1];
      v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN
        v_restou := v_restou || v_tab || ' (' || v_apagou || '), ';
      END IF;
    END LOOP;
    IF v_restou <> '' THEN
      RAISE EXCEPTION
        'Reset abortado: sobraram linhas presas por chave estrangeira em %. Nada foi apagado. Provável tabela nova sem tratamento na migr. 484.',
        rtrim(v_restou, ', ') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 4. O caixa da unidade ───────────────────────────────────────────────
  -- Mesma regra da global (393): a conta é parametrização e fica, o dinheiro da
  -- turma anterior não.
  SELECT count(*) INTO v_zeradas
    FROM public.caixa_bancos
   WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  IF NOT p_dry_run THEN
    UPDATE public.caixa_bancos SET saldo = 0
     WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  END IF;

  RETURN jsonb_build_object(
    'sucesso',        true,
    'ensaio',         p_dry_run,
    'filial',         p_filial,
    'linhas',         v_total,
    'por_tabela',     v_contagem,
    'contas_zeradas', v_zeradas,
    'estorno_matriz', v_estorno,
    'estorno_total',  v_devolvido,
    'executado_em',   now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resetar_dados_da_filial(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resetar_dados_da_filial(text, boolean) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- ENSAIO — fazer ANTES de confiar nela, em cada projeto
--
-- 1) Só medir (não apaga nada; é o default):
--
--      SELECT jsonb_pretty(public.resetar_dados_da_filial('TechMax'));
--
--    Confira `por_tabela` e `estorno_matriz` contra o que você espera.
--
-- 2) Ensaio de verdade, exercitando as FKs e desfazendo no fim. Rodar no SQL
--    Editor, o bloco INTEIRO de uma vez:
--
--      BEGIN;
--      SELECT jsonb_pretty(public.resetar_dados_da_filial('TechMax', false));
--      ROLLBACK;   -- <<< não esqueça
--
--    Se passar aqui, passa na hora real: a ordem das FKs é o que este ensaio
--    prova. Se abortar, a mensagem diz qual tabela ficou presa.
--
-- 3) Valendo:
--
--      SELECT jsonb_pretty(public.resetar_dados_da_filial('TechMax', false));
--
-- ────────────────────────────────────────────────────────────────────────────
-- MANUTENÇÃO
--
-- Tabela nova entra aqui TAMBÉM. A global esconde a omissão (o CASCADE apaga
-- sem ninguém listar); esta não esconde: a conferência do passo 3 aborta e diz
-- o nome. É de propósito — barulho na hora certa vale mais que silêncio.
-- ════════════════════════════════════════════════════════════════════════════
