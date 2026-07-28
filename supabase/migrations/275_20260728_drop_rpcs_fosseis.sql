-- RPCs fósseis: as versões que cada migração deixou para trás.
--
-- A 274 derrubou a `criar_venda_pdv` de 7 argumentos. Varrendo o resto do
-- catálogo, o padrão se repete em mais seis funções: toda migração que
-- acrescentou um parâmetro criou uma nova versão e deixou a anterior viva,
-- com `GRANT EXECUTE ... TO authenticated`. O PostgREST resolve overload pelo
-- conjunto de argumentos, então cada fóssil é um caminho de escrita paralelo,
-- parado no estado do dia em que foi escrito.
--
-- Duas famílias de dano:
--
--   • Sem `filial` (P8): `criar_requisicao_compra` de 5 args e
--     `criar_requisicao_estoque` de 4 args são anteriores ao isolamento por
--     filial. Gravam com o DEFAULT da coluna, furando o recorte que as
--     migrações 179-187 fecharam.
--
--   • Sem campos que a tela hoje exige: as versões antigas de
--     `criar_meta_estrategica`, `criar_tarefa_tatica`, `editar_meta_estrategica`
--     e `criar_matriz_tarefa` não conhecem título, horários ou origem.
--     Gravam registros que a tela lê incompletos.
--
-- Nenhum caller no código usa as assinaturas derrubadas aqui — as telas
-- passam o conjunto completo de parâmetros. Verificado em `src/`.
--
-- Nota lateral, não tratada aqui: `criar_requisicao_compra` e
-- `criar_tarefa_tatica` não têm caller nenhum, em versão alguma. As telas
-- inserem direto na tabela, e no caso de `requisicoes` a policy de INSERT é
-- `USING(true)`. A RPC com guard existe e ninguém passa por ela.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- Sem filial — anteriores ao isolamento por unidade
DROP FUNCTION IF EXISTS public.criar_requisicao_compra(text, text, integer, text, text);
DROP FUNCTION IF EXISTS public.criar_requisicao_estoque(uuid, text, integer, text);

-- Metas: pré-título (6/7 args) e pré-horários (7/8 args)
DROP FUNCTION IF EXISTS public.criar_meta_estrategica(text, text, numeric, numeric, date, date);
DROP FUNCTION IF EXISTS public.criar_meta_estrategica(text, text, text, numeric, numeric, date, date);
DROP FUNCTION IF EXISTS public.editar_meta_estrategica(uuid, text, text, numeric, numeric, date, date);
DROP FUNCTION IF EXISTS public.editar_meta_estrategica(uuid, text, text, text, numeric, numeric, date, date);

-- Tarefas táticas: mesmas duas gerações
DROP FUNCTION IF EXISTS public.criar_tarefa_tatica(uuid, text, uuid, numeric, date, date);
DROP FUNCTION IF EXISTS public.criar_tarefa_tatica(uuid, text, text, uuid, numeric, date, date);

-- Matriz: pré-origem
DROP FUNCTION IF EXISTS public.criar_matriz_tarefa(uuid, text, text, text, date, jsonb);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO — nenhuma função pública deve ter mais de uma versão
-- ════════════════════════════════════════════════════════════════════════════
--   SELECT p.proname, count(*) AS versoes,
--          string_agg(pg_get_function_identity_arguments(p.oid), ' | ') AS assinaturas
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--    GROUP BY 1 HAVING count(*) > 1;
--
-- Sonda reutilizável: rodar depois de toda migração que mude a assinatura de
-- uma RPC. Trocar parâmetro sem dropar a versão anterior é o jeito silencioso
-- de manter viva a regra que se acabou de corrigir.
-- ════════════════════════════════════════════════════════════════════════════
