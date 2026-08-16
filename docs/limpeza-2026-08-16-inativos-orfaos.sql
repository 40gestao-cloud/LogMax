-- ════════════════════════════════════════════════════════════════════════════
-- LIMPEZA DE INATIVOS ÓRFÃOS — roda nas 4 turmas
-- ════════════════════════════════════════════════════════════════════════════
-- Executada em 2026-08-16. NÃO é migração de schema: não numerar, não entra em
-- `supabase/migrations/`. Fica aqui como registro do que foi apagado e como
-- receita para repetir quando o lixo voltar a acumular.
--
-- Origem: pedido de "limpar o que é lixo, o que é histórico não", no fim da
-- auditoria de segurança de 16/08.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTE SCRIPT NÃO APAGA, E POR QUÊ
--
-- A intuição de que `ativo = false` é lixo não se sustenta neste schema. Em
-- cinco lugares o inativo é informação:
--
--   blackout_config    1 linha, `ativo=false` = simulação de perda de dados
--                      DESLIGADA. Apagar quebra a feature (migr. 339).
--   aula_config        idem: `ativo=false` = Modo Aula desligado.
--   demissoes          readmissão inativa a linha em vez de apagar; a tela de
--   rescisoes          Desligamento pede `includeInactive` para mostrar o
--                      histórico de readmitidos.
--   filiais            unidade desativada é cadastro que pode voltar.
--
-- E na massa operacional o inativo quase sempre tem histórico pendurado. Na
-- medição de 16/08, dos 48 produtos inativos da turma aprendiz, **zero**
-- estavam livres: todos com movimentação de estoque, item de venda, pedido ou
-- custo apontando para eles. Vale o mesmo para bancos, categorias e
-- treinamentos. Apagar teria quebrado saldo derivado sem aviso — DELETE não
-- passa pelos triggers que o soft delete acionou.
--
-- Por isso o script só apaga **cadastro inativo que ninguém referencia**, e
-- cada bloco carrega o próprio `NOT EXISTS`. Onde não houver alvo, não faz
-- nada: é seguro rodar em qualquer turma, quantas vezes quiser.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DUAS ARMADILHAS DE REFERÊNCIA POR TEXTO
--
-- Nem toda referência é FK. Duas relações deste schema apontam por NOME:
--
--   departamentos  ← funcionarios.departamento, vagas.departamento e
--                    movimentacoes_carreira.departamento_anterior/novo
--   fornecedores   ← produtos.fornecedor
--
-- A primeira versão do script checou `funcionarios.departamento_id` e quebrou
-- com 42703 — a coluna é `departamento`, texto. Quem for adaptar isto para
-- outra tabela: conferir `information_schema.columns` por colunas de texto com
-- o nome da entidade antes de confiar só nas FKs de `pg_constraint`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- RESULTADO DA EXECUÇÃO DE 2026-08-16 — 15 linhas nas 4 turmas
--
--   LogMax-ERP    13  (5 planilhas, 5 bancos, 1 fornecedor, 1 participante,
--                      1 métrica)
--   aprendiz       2  (1 fornecedor, 1 métrica)
--   contabilidade  0
--   Adm            0
--
-- Ficaram de pé por terem referência, exatamente como esperado: 1 fornecedor
-- no ERP, 2 participantes de tarefa da Matriz (com nota em `avaliacoes_matriz`)
-- e 1 departamento em aprendiz (citado por nome em `funcionarios`).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Planilhas do aluno apagadas na tela. Sem FK entrando, sem histórico.
DELETE FROM planilhas_trabalho     WHERE ativo = false;

-- Métrica de rede social removida. Idem.
DELETE FROM metricas_redes_sociais WHERE ativo = false;

-- Departamento: referência por NOME, não por id (ver armadilha acima).
DELETE FROM departamentos d WHERE d.ativo = false
  AND NOT EXISTS (SELECT 1 FROM funcionarios x WHERE x.departamento = d.nome)
  AND NOT EXISTS (SELECT 1 FROM vagas x WHERE x.departamento = d.nome)
  AND NOT EXISTS (SELECT 1 FROM movimentacoes_carreira x
                   WHERE x.departamento_anterior = d.nome OR x.departamento_novo = d.nome);

-- Fornecedor: quatro FKs mais `produtos.fornecedor`, que é texto.
DELETE FROM fornecedores f WHERE f.ativo = false
  AND NOT EXISTS (SELECT 1 FROM contas_pagar    x WHERE x.fornecedor_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM cotacoes        x WHERE x.fornecedor_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM pedidos         x WHERE x.fornecedor_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM notas_recebidas x WHERE x.fornecedor_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM produtos        x WHERE x.fornecedor = f.nome);

-- Participante removido de tarefa da Matriz. `avaliacoes_matriz.item_id`
-- aponta para cá SEM constraint de FK — o NOT EXISTS é a única proteção da
-- nota já dada.
DELETE FROM matriz_tarefa_participantes p WHERE p.ativo = false
  AND NOT EXISTS (SELECT 1 FROM avaliacoes_matriz a WHERE a.item_id = p.id);

-- Banco desativado. Só sai com saldo zero e sem nenhum lançamento apontando —
-- sete tabelas ao todo, incluindo as duas de baixas parciais (migr. 422).
DELETE FROM caixa_bancos b WHERE b.ativo = false AND COALESCE(b.saldo,0) = 0
  AND NOT EXISTS (SELECT 1 FROM contas_pagar          x WHERE x.banco_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM contas_receber        x WHERE x.banco_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM contas_pagar_baixas   x WHERE x.banco_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM contas_receber_baixas x WHERE x.banco_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM emprestimos_filial    x WHERE x.banco_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM capital_filial        x WHERE x.banco_origem_id = b.id OR x.banco_destino_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM destinacoes_resultado x WHERE x.banco_origem_id = b.id OR x.banco_destino_id = b.id);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — o que sobrou de inativo, por tabela
--
--   SELECT c.relname,
--          (xpath('/row/c/text()', query_to_xml(
--             format('SELECT count(*) c FROM public.%I WHERE ativo = false', c.relname),
--             false, true, '')))[1]::text::int AS inativos
--     FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--     JOIN information_schema.columns col
--       ON col.table_schema = 'public' AND col.table_name = c.relname
--      AND col.column_name = 'ativo'
--    WHERE n.nspname = 'public' AND c.relkind = 'r'
--    ORDER BY 2 DESC;
--
-- O que aparecer aqui e não estiver na lista de blocos acima ou é histórico
-- (o certo) ou é cadastro com referência viva (também o certo). Se quiser
-- base limpa de verdade para começar um período, o caminho é o reset da
-- migr. 395, que trunca na ordem de FK e preserva cadastros e usuários.
-- ════════════════════════════════════════════════════════════════════════════
