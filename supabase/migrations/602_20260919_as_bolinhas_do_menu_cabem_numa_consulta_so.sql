-- 602 — As 21 bolinhas do menu cabem numa consulta só
--
-- O QUE ESTAVA ACONTECENDO
--
-- Cada badge da sidebar era um `count` próprio, com `head: true`, disparado
-- pelo `useSidebarBadges`. São 21 definições; uma atualização de badge eram
-- até 21 requisições HTTP, cada uma com seu parse, seu planejamento e sua
-- checagem de RLS. Como todo mundo na sala ouve as mesmas tabelas, um INSERT
-- de um aluno virava (turma inteira) × 21.
--
-- Medido na LogMax-ERP em 19/09, `pg_stat_statements` desde 11/05:
--
--   consultas de contagem sem corpo   1.398.242 chamadas   11.523 s
--   tempo total de banco no período                        80.998 s
--
-- Catorze por cento do banco para pintar bolinha de menu. A pior sozinha é a
-- de `aprovacoes_compras`: 52.845 chamadas a 82 ms numa tabela de 124 linhas.
--
-- E 82 ms ali não é varredura. `EXPLAIN ANALYZE` com JWT de gerente, na
-- LogMax-ERP:
--
--   Execution Time: 7.481 ms
--   Planning Time: 24.919 ms
--
-- O trabalho é planejar e autenticar, não contar — e era pago 21 vezes. Numa
-- função o plano fica em cache na sessão e a conta é uma só.
--
-- A régua é a mesma da `listar_pendencias` (527), que já responde o quadro
-- inteiro do professor em UMA chamada de 155 ms.
--
-- ─── SECURITY INVOKER, E ISSO IMPORTA ──────────────────────────────────────
--
-- A função NÃO é SECURITY DEFINER. Cada contagem roda com a RLS de quem
-- chamou, exatamente como as 21 consultas rodavam — é o que garante que o
-- número da bolinha seja o número de linhas que a pessoa consegue abrir. Uma
-- SECURITY DEFINER aqui contaria a holding inteira e a bolinha viraria mentira
-- (e vazamento: "existem 14 coisas que você não pode ver").
--
-- Por isso também não há gate de setor aqui dentro. Quem decide QUAIS badges
-- desenhar continua sendo o `SETOR_MODULES` no front; o banco devolve tudo o
-- que a RLS deixa e nada além.
--
-- ─── AS CHAVES SÃO OS viewId DO FRONT ──────────────────────────────────────
--
-- O jsonb sai com as mesmas chaves que o `BADGE_DEFS` usa (`compras-pedidos`,
-- `rh-férias`, com acento e tudo), para o hook ler sem tradutor no meio. Duas
-- chaves contam a MESMA fila de propósito — `requisicoes-aprovações` soma as
-- duas portas do gerente, e `financeiro-aprovaçõesdepromoções` e
-- `marketing-promoções` são os dois lados da mesma proposta. Aqui cada fila é
-- contada uma vez e o valor é reaproveitado; antes eram consultas idênticas
-- repetidas por máquina.
--
-- `estoque-recebimentos` é o oposto: SOMA duas filas (a carga que não chegou e
-- a entrada que ninguém confirmou), do mesmo jeito que a faixa dentro da tela.
--
-- O `ativo = true` aparece só onde a tabela tem a coluna — a mesma lista que o
-- `TABLES_WITH_ATIVO` do front carrega. `aprovacoes_compras`,
-- `aprovacoes_estoque` e a view `v_pedidos_a_receber` ficam de fora dela.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.contar_pendencias(p_filial text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Filas contadas uma vez e usadas em mais de uma chave.
  v_aprov_compras  int;
  v_aprov_estoque  int;
  v_promocoes      int;
  -- As duas metades de `estoque-recebimentos`.
  v_receb_pendente int;
  v_receb_saldo    int;
BEGIN
  SELECT count(*) INTO v_aprov_compras
    FROM aprovacoes_compras a
    JOIN requisicoes r ON r.id = a.requisicao_id
   WHERE a.status = 'Pendente'
     AND r.ativo AND r.status = 'Pendente'
     AND (p_filial IS NULL OR a.filial = p_filial);

  SELECT count(*) INTO v_aprov_estoque
    FROM aprovacoes_estoque a
    JOIN requisicoes_estoque r ON r.id = a.requisicao_estoque_id
   WHERE a.status = 'Pendente'
     AND r.ativo AND r.status = 'Pendente'
     AND (p_filial IS NULL OR a.filial = p_filial);

  SELECT count(*) INTO v_promocoes
    FROM marketing_promocoes
   WHERE ativo
     AND status IN ('Aguardando Aprovação', 'Em Análise')
     AND (p_filial IS NULL OR filial = p_filial);

  SELECT count(*) INTO v_receb_pendente
    FROM recebimentos
   WHERE ativo AND status = 'Pendente'
     AND (p_filial IS NULL OR filial = p_filial);

  SELECT count(*) INTO v_receb_saldo
    FROM v_pedidos_a_receber
   WHERE (p_filial IS NULL OR filial = p_filial);

  RETURN jsonb_build_object(
    -- ── Compras ──────────────────────────────────────────────────────────
    'compras-requisiçõesdecompra', (
      SELECT count(*) FROM requisicoes
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),
    'compras-cotações', (
      SELECT count(*) FROM cotacoes
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),
    'compras-pedidos', (
      SELECT count(*) FROM pedidos
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),

    -- ── Requisições (caixa de decisão do gerente) ────────────────────────
    -- Soma as duas portas: compra e material do almoxarifado.
    'requisicoes-aprovações', v_aprov_compras + v_aprov_estoque,

    -- ── Estoque ──────────────────────────────────────────────────────────
    'estoque-liberarrequisições',    v_aprov_estoque,
    'estoque-recebimentos',          v_receb_pendente + v_receb_saldo,
    'estoque-requisiçõesdematerial', (
      SELECT count(*) FROM requisicoes_estoque
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),
    'estoque-expedição', (
      SELECT count(*) FROM expedicao
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),
    'estoque-pedidosdevenda', (
      SELECT count(*) FROM pedidos_venda
       WHERE ativo AND separado_em IS NULL AND status <> 'Cancelado'
         AND (p_filial IS NULL OR filial = p_filial)),

    -- ── Financeiro ───────────────────────────────────────────────────────
    'financeiro-aprovaçõesdecotação', (
      SELECT count(*) FROM cotacoes
       WHERE ativo AND status = 'Aguardando Financeiro'
         AND (p_filial IS NULL OR filial = p_filial)),
    'financeiro-aprovaçõesdeorçamento', (
      SELECT count(*) FROM orcamentos
       WHERE ativo AND status = 'Aguardando Financeiro'
         AND (p_filial IS NULL OR filial = p_filial)),
    'financeiro-aprovaçõesdepromoções', v_promocoes,
    'financeiro-aprovaçõesdeconteúdo', (
      SELECT count(*) FROM marketing_tarefas
       WHERE ativo AND status_link = 'Aguardando Aprovação'
         AND (p_filial IS NULL OR filial = p_filial)),
    'financeiro-pedidosdevenda', (
      SELECT count(*) FROM pedidos_venda
       WHERE ativo AND pago_em IS NULL AND status <> 'Cancelado'
         AND (p_filial IS NULL OR filial = p_filial)),

    -- ── Vendas / Marketing / RH / TI / Metas ─────────────────────────────
    'vendas-orçamentos', (
      SELECT count(*) FROM orcamentos
       WHERE ativo AND status = 'Aprovado Financeiro'
         AND (p_filial IS NULL OR filial = p_filial)),
    'marketing-promoções', v_promocoes,
    'rh-férias', (
      SELECT count(*) FROM ferias
       WHERE ativo AND status = 'Solicitada'
         AND (p_filial IS NULL OR filial = p_filial)),
    -- Metas e Desenvolvimento com IA não têm coluna de filial: a RLS já
    -- recorta, e inventar filtro aqui zeraria a bolinha de quem tem direito.
    'metas', (
      SELECT count(*) FROM metas_estrategicas
       WHERE ativo AND status = 'Em Produção'),
    'ti-desenvolvimentocomia', (
      SELECT count(*) FROM desenvolvimentos_ia
       WHERE ativo AND status = 'Agendado')
  );
END;
$fn$;

COMMENT ON FUNCTION public.contar_pendencias(text) IS
  'Conta as filas que viram bolinha na sidebar, todas numa chamada. '
  'SECURITY INVOKER de propósito: o número tem de ser o que a RLS de quem '
  'chamou deixa ver. Chaves = viewId do BADGE_DEFS (src/hooks/useSidebarBadges.ts).';

-- RPC nova nasce alcançável pelo `anon` por causa do grant de schema; fecha na mão.
REVOKE ALL     ON FUNCTION public.contar_pendencias(text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.contar_pendencias(text) TO authenticated;

-- PostgREST só enxerga a função depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
