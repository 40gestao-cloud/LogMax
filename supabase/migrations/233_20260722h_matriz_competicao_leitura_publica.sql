-- =================================================================
-- Competição Matriz — leitura pública das tarefas / participantes /
-- avaliações / competição em si.
--
-- Contexto:
--   Antes as 4 tabelas (competicoes_matriz, matriz_tarefas,
--   matriz_tarefa_participantes, avaliacoes_matriz) só liberavam
--   SELECT para usuários com filial='Matriz' + roles do conselho.
--   Isso quebrava:
--     • O card de medalha da filial na Central de Avaliação (gerente
--       /colab não conseguia ler a competição pra saber a posição).
--     • O novo submódulo Demandas > Conselho, que precisa mostrar
--       as tarefas criadas pelo Admin/CEO em modo Matriz para
--       gerente/colab de qualquer filial (visibilidade total).
--
--   Escrita continua restrita (policies INSERT/UPDATE/DELETE não
--   alteradas — só a Matriz cria/edita/apaga tarefas e vota).
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS comp_read              ON public.competicoes_matriz;
CREATE POLICY comp_read              ON public.competicoes_matriz               FOR SELECT USING (true);

DROP POLICY IF EXISTS mt_tarefas_select      ON public.matriz_tarefas;
CREATE POLICY mt_tarefas_select      ON public.matriz_tarefas                   FOR SELECT USING (true);

DROP POLICY IF EXISTS mt_part_select         ON public.matriz_tarefa_participantes;
CREATE POLICY mt_part_select         ON public.matriz_tarefa_participantes      FOR SELECT USING (true);

DROP POLICY IF EXISTS aval_matriz_select     ON public.avaliacoes_matriz;
CREATE POLICY aval_matriz_select     ON public.avaliacoes_matriz                FOR SELECT USING (true);

COMMIT;
