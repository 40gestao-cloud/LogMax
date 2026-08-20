-- 487_20260819_o_reset_por_unidade_esbarrava_nos_gatilhos_de_negocio.sql
--
-- O ensaio da 484/485 (`BEGIN; … dry_run=false; ROLLBACK;`) parou na primeira
-- tabela de estoque:
--
--   ERROR: Estoque insuficiente: a operação deixaria o produto com -1.000
--   CONTEXT: PL/pgSQL function fn_atualiza_estoque_produto() line 52
--            SQL statement "DELETE FROM public.movimentacoes_estoque ..."
--
-- ════════════════════════════════════════════════════════════════════════════
-- A DIFERENÇA ENTRE TRUNCATE E DELETE QUE EU NÃO TINHA CONSIDERADO
--
-- `TRUNCATE` **não dispara gatilho de linha**. `DELETE` dispara. A régua global
-- nunca encostou nesses gatilhos porque nunca apagou linha nenhuma — ela trunca.
-- A régua por unidade apaga linha a linha, e aí a operação inteira passa a
-- conversar com a lógica de negócio de cada tabela, que está ali para proteger
-- o dia a dia e não sabe nada sobre reset.
--
-- Os cinco que atrapalham, nesta base:
--
--   movimentacoes_estoque  trg_atualiza_estoque            -- desfaz a entrada e
--                                                             acusa saldo negativo
--                          trg_consumo_material_mov_apagada
--   contas_pagar           trg_sync_saldo_contas_pagar     -- mexe no caixa
--   contas_receber         trg_sync_saldo_contas_receber   -- mexe no caixa
--   capital_filial         trg_bloqueia_delete_aporte_com_caixa  -- RECUSA o delete
--   maxbank_transacoes     trg_maxbank_tx_protege_abertura
--
-- O de `capital_filial` é o mais instrutivo: ele existe para impedir que alguém
-- apague um aporte cujo dinheiro já foi usado — regra certa, e que num reset
-- vira um bloqueio absoluto. E o `trg_sync_saldo_*` faria o caixa ser corrigido
-- 40 vezes durante a limpeza, brigando com o estorno que a própria função
-- calcula no início.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A CORREÇÃO: DESLIGAR O GATILHO DE NEGÓCIO, NUNCA A CHAVE ESTRANGEIRA
--
-- `ALTER TABLE ... DISABLE TRIGGER USER` desliga só os gatilhos declarados no
-- projeto. Os de chave estrangeira são internos e continuam ativos — o que é
-- essencial aqui: o laço de repetição da 484 usa a violação de FK para
-- descobrir a ordem, e a conferência final usa a mesma FK para provar que não
-- sobrou nada. Desligar tudo (`session_replication_role = replica`) faria a
-- função parecer bem-sucedida enquanto deixava referência pendurada.
--
-- Tudo dentro da mesma transação, e DDL no Postgres é transacional: se a
-- conferência abortar, os gatilhos voltam sozinhos junto com o resto.
--
-- Desliga na lista INTEIRA, não só nos cinco. Não é preguiça: é o que mantém as
-- duas réguas equivalentes, que é o princípio da 484 — a global não dispara
-- gatilho nenhum, esta também não. E gatilho novo numa das 95 tabelas não volta
-- a quebrar o reset seis meses depois.
--
-- O modo ensaio (`p_dry_run`) não toca em nada disso: continua sendo leitura.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

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
  v_alvos text[][] := ARRAY[
    ['itens_venda','venda_id IN (SELECT id FROM public.vendas WHERE filial = $1)'],
    ['notas_emitidas','filial = $1'],
    ['devolucoes','filial = $1'],
    ['itens_devolucao','devolucao_id IN (SELECT id FROM public.devolucoes WHERE filial = $1)'],
    ['vendas','filial = $1'],
    ['pix_pendentes','filial = $1'],
    ['cartao_pendentes','filial = $1'],
    ['beneficios_pendentes','filial_pdv = $1'],
    ['pedidos_online_itens','pedido_id IN (SELECT id FROM public.pedidos_online WHERE filial = $1)'],
    ['pedidos_online','filial = $1'],
    ['movimentacoes_estoque','filial = $1'],
    ['produto_unidades','filial = $1'],
    ['vencimentos_estoque','filial = $1'],
    ['inventarios','filial = $1'],
    ['expedicao','filial = $1'],
    ['requisicoes_estoque','filial = $1'],
    ['aprovacoes_estoque','filial = $1'],
    ['consumos_material','filial = $1'],
    ['devolucoes_fornecedor','filial = $1'],
    ['notas_recebidas','filial = $1'],
    ['recebimentos','filial = $1'],
    ['pedidos','filial = $1'],
    ['cotacoes','filial = $1'],
    ['aprovacoes_compras','filial = $1'],
    ['requisicoes','filial = $1'],
    ['parcelas_emprestimo','emprestimo_id IN (SELECT id FROM public.emprestimos_filial WHERE filial = $1)'],
    -- [485] Por foto: a linha acima já apagou o caminho até estas contas.
    ['contas_receber','id IN (SELECT id FROM _reset_cr_matriz)'],
    ['contas_receber_baixas','filial = $1'],
    ['contas_pagar_baixas','filial = $1'],
    ['rateio_administrativo_itens','filial = $1'],
    ['folha_credito_falhas','filial = $1'],
    ['contas_receber','filial = $1'],
    ['contas_pagar','filial = $1'],
    ['previsoes','filial = $1'],
    ['duplicatas','filial = $1'],
    ['integracoes_bancarias','filial = $1'],
    ['movimentacoes_caixa','filial = $1'],
    ['controle_caixa_reaberturas','filial = $1'],
    ['controle_caixa','filial = $1'],
    ['emprestimos_filial','filial = $1'],
    ['capital_filial','filial = $1'],
    ['ponto_eletronico','filial = $1'],
    ['ponto_qr_registros','user_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['folha_rubricas','folha_id IN (SELECT id FROM public.folha_pagamento WHERE filial = $1)'],
    ['folha_pagamento','filial = $1'],
    ['maxbank_folgas_conquistadas','colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['ferias','filial = $1'],
    ['afastamentos','filial = $1'],
    ['justificativas_falta','funcionario_id IN (SELECT id FROM public.funcionarios WHERE filial = $1)'],
    ['treinamento_inscricoes','funcionario_id IN (SELECT id FROM public.funcionarios WHERE filial = $1)'],
    ['pesquisa_resposta_itens','resposta_id IN (SELECT r.id FROM public.pesquisa_respostas r JOIN public.pesquisas p ON p.id = r.pesquisa_id WHERE p.filial = $1)'],
    ['pesquisa_respostas','pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisa_perguntas','pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisas','filial = $1'],
    ['marketing_arte_feedback','arte_id IN (SELECT id FROM public.marketing_artes WHERE filial = $1)'],
    ['marketing_artes','filial = $1'],
    ['marketing_tarefas','filial = $1'],
    ['marketing_promocoes','filial = $1'],
    ['marketing_calendario','filial = $1'],
    ['marketing_cupons','filial = $1'],
    ['itens_campanha','campanha_id IN (SELECT id FROM public.marketing_campanhas WHERE filial = $1)'],
    ['marketing_campanhas','filial = $1'],
    ['orcamentos','filial = $1'],
    ['pedidos_venda','filial = $1'],
    ['maxbank_transacoes','conta_id IN (SELECT c.id FROM public.maxbank_contas c JOIN public.user_profiles u ON u.id = c.colaborador_id WHERE u.filial = $1)'],
    ['maxbank_transferencias','de_colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1) OR para_colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['maxbank_metas','filial = $1'],
    ['tarefas_taticas','meta_estrategica_id IN (SELECT m.id FROM public.metas_estrategicas m JOIN public.user_profiles u ON u.id = m.criada_por WHERE u.filial = $1)'],
    ['metas_estrategicas','criada_por IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['tarefas','filial = $1'],
    ['ti_chamados','filial = $1'],
    ['notificacoes','filial = $1'],
    ['requerimentos','filial = $1'],
    ['votacoes_votos','votacao_id IN (SELECT v.id FROM public.votacoes v JOIN public.user_profiles u ON u.id = v.criador_id WHERE u.filial = $1)'],
    ['votacoes','criador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['orcamento_itens','orcamento_id IN (SELECT id FROM public.orcamentos_periodo WHERE filial = $1)'],
    ['orcamentos_periodo','filial = $1'],
    ['prestacao_pareceres','prestacao_id IN (SELECT id FROM public.prestacoes_contas WHERE filial = $1)'],
    ['prestacoes_contas','filial = $1'],
    ['destinacoes_resultado','filial = $1'],
    ['apuracao_bonus_itens','filial = $1'],
    ['mandatos','filial = $1'],
    ['risco_revisoes','risco_id IN (SELECT id FROM public.riscos WHERE filial = $1)'],
    ['riscos','filial = $1'],
    ['auditoria_revisoes','filial = $1'],
    ['orcamento_mensal_categoria','filial = $1'],
    ['avaliacoes','filial = $1 AND tipo IS DISTINCT FROM ''matriz_filial'''],
    ['produtos_codigo_reserva','filial = $1'],
    ['produtos_custo','produto_id IN (SELECT id FROM public.produtos WHERE filial = $1)'],
    ['produtos','filial = $1'],
    ['servicos','filial = $1'],
    ['clientes','filial = $1'],
    ['projetos','filial = $1']];
  v_tab text; v_where text; v_i int; v_passada int;
  v_apagou bigint; v_total bigint := 0; v_progresso boolean;
  v_restou text := ''; v_contagem jsonb := '{}'::jsonb;
  v_estorno jsonb := '[]'::jsonb; v_devolvido numeric := 0;
  v_zeradas int := 0; r record;
BEGIN
  IF NOT COALESCE(public.auth_user_role() = 'admin', false)
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas o administrador pode zerar uma unidade.'
      USING ERRCODE = '42501';
  END IF;

  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Reset por unidade é de SuperMax, MaxLook ou TechMax — recebi %. A Matriz é a contraparte de todas; para ela existe o APAGAR TUDO.',
      COALESCE(p_filial,'(vazio)') USING ERRCODE = 'P0001';
  END IF;

  DROP TABLE IF EXISTS _reset_cr_matriz;
  CREATE TEMP TABLE _reset_cr_matriz ON COMMIT DROP AS
    SELECT p.contas_receber_id AS id
      FROM public.parcelas_emprestimo p
      JOIN public.emprestimos_filial e ON e.id = p.emprestimo_id
     WHERE e.filial = p_filial AND p.contas_receber_id IS NOT NULL;

  FOR r IN
    SELECT b.id AS banco_id, COALESCE(b.banco, b.conta) AS banco_nome, SUM(x.valor) AS valor
      FROM (SELECT banco_origem_id AS banco, valor FROM public.capital_filial
             WHERE filial = p_filial AND banco_origem_id IS NOT NULL
            UNION ALL
            SELECT banco_id, valor FROM public.emprestimos_filial
             WHERE filial = p_filial AND status = 'Aprovado' AND banco_id IS NOT NULL) x
      JOIN public.caixa_bancos b ON b.id = x.banco
     WHERE b.filial IS DISTINCT FROM p_filial
     GROUP BY b.id, COALESCE(b.banco, b.conta)
  LOOP
    v_estorno := v_estorno || jsonb_build_object('banco', r.banco_nome, 'devolvido', r.valor);
    v_devolvido := v_devolvido + r.valor;
    IF NOT p_dry_run THEN
      UPDATE public.caixa_bancos SET saldo = COALESCE(saldo,0) + r.valor WHERE id = r.banco_id;
    END IF;
  END LOOP;

  IF p_dry_run THEN
    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN
        v_contagem := v_contagem || jsonb_build_object(v_tab,
          COALESCE((v_contagem ->> v_tab)::bigint,0) + v_apagou);
        v_total := v_total + v_apagou;
      END IF;
    END LOOP;
  ELSE
    -- [487] Gatilho de NEGÓCIO desligado; o de chave estrangeira continua de pé
    -- (é interno, `DISABLE TRIGGER USER` não o alcança) e é dele que o laço
    -- abaixo depende. Volta no fim, ou no ROLLBACK — DDL é transacional.
    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_alvos[v_i][1]);
    END LOOP;

    FOR v_passada IN 1 .. 6 LOOP
      v_progresso := false;
      FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
        v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
        BEGIN
          EXECUTE format('WITH del AS (DELETE FROM public.%I WHERE %s RETURNING 1) SELECT count(*) FROM del',
            v_tab, v_where) INTO v_apagou USING p_filial;
          IF v_apagou > 0 THEN
            v_progresso := true;
            v_contagem := v_contagem || jsonb_build_object(v_tab,
              COALESCE((v_contagem ->> v_tab)::bigint,0) + v_apagou);
            v_total := v_total + v_apagou;
          END IF;
        EXCEPTION WHEN foreign_key_violation THEN NULL;
        END;
      END LOOP;
      EXIT WHEN NOT v_progresso;
    END LOOP;

    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN v_restou := v_restou || v_tab || ' (' || v_apagou || '), '; END IF;
    END LOOP;

    -- Religa ANTES da conferência falhar seria inútil (o RAISE desfaz tudo),
    -- mas religar aqui deixa o estado explícito para quem ler o log.
    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_alvos[v_i][1]);
    END LOOP;

    IF v_restou <> '' THEN
      RAISE EXCEPTION 'Reset abortado: sobraram linhas presas por chave estrangeira em %. Nada foi apagado.',
        rtrim(v_restou, ', ') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT count(*) INTO v_zeradas FROM public.caixa_bancos
   WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  IF NOT p_dry_run THEN
    UPDATE public.caixa_bancos SET saldo = 0
     WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  END IF;

  DROP TABLE IF EXISTS _reset_cr_matriz;

  RETURN jsonb_build_object('sucesso', true, 'ensaio', p_dry_run, 'filial', p_filial,
    'linhas', v_total, 'por_tabela', v_contagem, 'contas_zeradas', v_zeradas,
    'estorno_matriz', v_estorno, 'estorno_total', v_devolvido, 'executado_em', now());
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- ENSAIO — agora ele passa. Rodar o bloco INTEIRO de uma vez:
--
--   BEGIN;
--   SELECT jsonb_pretty(public.resetar_dados_da_filial('TechMax', false));
--   ROLLBACK;
--
-- Confira, no retorno: `contas_receber` presente em `por_tabela` (é a
-- contrapartida da Matriz, migr. 485) e `estorno_matriz` com o banco certo.
-- ════════════════════════════════════════════════════════════════════════════
