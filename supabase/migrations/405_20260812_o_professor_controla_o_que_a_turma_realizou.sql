-- 405_20260812_o_professor_controla_o_que_a_turma_realizou.sql
--
-- Painel de controle da atividade: quem, na turma, realizou cada tarefa.
--
-- A migr. 403 levou o enunciado à filial e a 404 fez a ciência chegar ao vivo.
-- As duas param no mesmo ponto: «Ciente» é confirmação de LEITURA. Cada tarefa
-- carrega `entregavel` e `criterio`, o PDF os imprime, e nada no sistema sabia
-- dizer se a turma fez. O professor percorria a sala perguntando de cabeça e
-- guardava o resultado em papel.
--
-- Quem marca é o PROFESSOR, e só ele. Foi decisão de projeto, não limitação:
-- o aluno já tem, na tela dele, uma marcação pessoal de progresso que fica no
-- próprio aparelho (`logmax.aula_progresso.*`, src/views/AulaAtividadeView.tsx)
-- e que deliberadamente não é entrega. Deixar o aluno escrever aqui misturaria
-- as duas coisas: uma é anotação para não se perder no roteiro, a outra é o
-- registro de quem conduz a aula. O aluno LÊ o que o professor marcou — é
-- devolutiva, e ver a própria linha não deixa mexer nela.
--
-- Binário de propósito: linha existe = realizou. Não há nota, não há rubrica e
-- nada disto toca o placar da competição entre filiais — atividade de aula que
-- vira nota contamina o ranking, que foi exatamente a razão de a 403 não ter
-- reaproveitado `matriz_tarefas`.
--
-- `tarefa_idx` é a posição (0-based) da tarefa dentro de `roteiro->'tarefas'`.
-- Índice, e não FK: as tarefas moram num jsonb e não têm identidade própria. É
-- estável porque atividade publicada não se edita — o fluxo do professor é
-- remover e republicar, e a remoção leva as marcações junto (ON DELETE CASCADE
-- pega o hard delete; o soft delete de `remover_atividade_aula` só esconde,
-- então marcação de atividade reativada continua de pé, que é o desejado).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabela
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.aula_tarefas_realizadas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atividade_id  uuid NOT NULL REFERENCES public.aula_atividades(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.user_profiles(id)   ON DELETE CASCADE,
  tarefa_idx    integer NOT NULL CHECK (tarefa_idx >= 0),
  -- Snapshots pelo mesmo motivo de `aula_atividades_ciencia`: o registro
  -- precisa continuar legível depois de o aluno mudar de filial ou sair.
  nome_snapshot text,
  filial        text,
  marcado_por   uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  marcado_em    timestamptz NOT NULL DEFAULT now(),
  -- Desmarcar é DELETE, então a existência da linha é o estado inteiro. Sem
  -- coluna booleana: duas fontes para o mesmo fato divergem na primeira
  -- gravação parcial.
  UNIQUE (atividade_id, user_id, tarefa_idx)
);

COMMENT ON TABLE public.aula_tarefas_realizadas IS
  'Tarefas da atividade da aula dadas por realizadas PELO PROFESSOR (admin/CEO). '
  'Linha existe = realizou. Não é nota e não alimenta o placar da competição.';

-- Só o índice por aluno. A busca do painel é por `atividade_id`, e o índice
-- único de (atividade_id, user_id, tarefa_idx) já a atende pelo prefixo —
-- um índice extra só em `atividade_id` seria escrita paga em todo INSERT
-- para servir uma consulta que já tinha caminho.
CREATE INDEX IF NOT EXISTS idx_aula_tarefas_realizadas_user
  ON public.aula_tarefas_realizadas (user_id);

-- ─────────────────────────────────────────────
-- 2. Alcance — uma regra só, dois chamadores
-- ─────────────────────────────────────────────
-- `atividade_aula_alcanca` (migr. 403) responde "esta atividade me alcança?"
-- lendo a sessão. O painel precisa da mesma pergunta sobre OUTRA pessoa, e
-- reescrever a conta daria duas réguas que divergem no dia em que a política
-- mudar. A implementação passa a ser esta, parametrizada; a função antiga vira
-- o caso particular dela com o contexto da sessão.
--
-- Assinatura e tipo de retorno da função antiga ficam idênticos — REPLACE que
-- muda coluna de saída derruba a transação inteira com 42P13.

CREATE OR REPLACE FUNCTION public.atividade_aula_alcanca_perfil(
  p_filiais text[],
  p_publico text,
  p_filial  text,
  p_role    text
) RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = public AS $$
  SELECT (COALESCE(cardinality(p_filiais), 0) = 0 OR p_filial = ANY(p_filiais))
     AND (p_publico = 'todos'
          OR (p_publico = 'gerentes'      AND p_role = 'gerente')
          OR (p_publico = 'colaboradores' AND p_role = 'colaborador'));
$$;

CREATE OR REPLACE FUNCTION public.atividade_aula_alcanca(p_filiais text[], p_publico text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.atividade_aula_alcanca_perfil(
    p_filiais, p_publico, public.auth_user_filial(), public.auth_user_role()
  );
$$;

-- ─────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────

ALTER TABLE public.aula_tarefas_realizadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aula_tarefas_realizadas_read"   ON public.aula_tarefas_realizadas;
DROP POLICY IF EXISTS "aula_tarefas_realizadas_insert" ON public.aula_tarefas_realizadas;
DROP POLICY IF EXISTS "aula_tarefas_realizadas_delete" ON public.aula_tarefas_realizadas;

-- O professor vê a turma; o aluno vê a própria linha e não escreve em lugar
-- nenhum. `auth_is_admin()` continua fora daqui: ela inclui conselheiro, que
-- nesta operação é aluno (migr. 403).
CREATE POLICY "aula_tarefas_realizadas_read" ON public.aula_tarefas_realizadas
  FOR SELECT TO authenticated USING (
    public.auth_user_role() IN ('admin','ceo') OR user_id = auth.uid()
  );

CREATE POLICY "aula_tarefas_realizadas_insert" ON public.aula_tarefas_realizadas
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() IN ('admin','ceo'));

CREATE POLICY "aula_tarefas_realizadas_delete" ON public.aula_tarefas_realizadas
  FOR DELETE TO authenticated
  USING (public.auth_user_role() IN ('admin','ceo'));

-- Sem policy de UPDATE: o estado é a existência da linha. Marcar é INSERT,
-- desmarcar é DELETE, e não há campo que faça sentido editar depois.

-- ─────────────────────────────────────────────
-- 4. RPC
-- ─────────────────────────────────────────────

-- Marca ou desmarca uma tarefa para um aluno. Idempotente nos dois sentidos:
-- marcar o que já está marcado não duplica, desmarcar o que não está não erra.
-- O painel é clicado durante a aula, com a turma esperando — reclique não pode
-- virar erro na tela.
CREATE OR REPLACE FUNCTION public.marcar_tarefa_aula(
  p_atividade_id uuid,
  p_user_id      uuid,
  p_tarefa_idx   integer,
  p_feito        boolean
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_atividade public.aula_atividades%ROWTYPE;
  v_perfil    public.user_profiles%ROWTYPE;
  v_total     integer;
BEGIN
  -- COALESCE porque `auth_user_role()` devolve NULL para sessão sem perfil, e
  -- `NULL IN (...)` é NULL — que num IF NOT não barra ninguém.
  IF NOT COALESCE(public.auth_user_role() IN ('admin','ceo'), false) THEN
    RAISE EXCEPTION 'Apenas admin ou CEO pode marcar tarefa da aula.'
      USING ERRCODE = '42501';
  END IF;

  -- `ativo` no filtro: remover é soft delete, a atividade some da tela da
  -- turma e do painel, e marcar nela escreveria num documento que ninguém
  -- mais lê. Acontece na corrida entre uma aba aberta e a remoção em outra.
  SELECT * INTO v_atividade
    FROM public.aula_atividades
   WHERE id = p_atividade_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atividade não encontrada (ou já removida).' USING ERRCODE = '22023';
  END IF;

  v_total := COALESCE(jsonb_array_length(v_atividade.roteiro -> 'tarefas'), 0);
  IF p_tarefa_idx < 0 OR p_tarefa_idx >= v_total THEN
    RAISE EXCEPTION 'Tarefa % não existe nesta atividade (são %).', p_tarefa_idx, v_total
      USING ERRCODE = '22023';
  END IF;

  -- Desligado fora: o vínculo dele acabou, `auth_user_role()` já ignora a
  -- linha e os dois painéis o tiram do alvo. Marcá-lo criaria um registro que
  -- nenhuma tela mostra de volta.
  SELECT * INTO v_perfil
    FROM public.user_profiles
   WHERE id = p_user_id AND desligado_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado (ou desligado).' USING ERRCODE = '22023';
  END IF;

  -- O alcance sozinho não basta: `publico = 'todos'` é verdadeiro para
  -- QUALQUER role, inclusive admin e CEO. O painel monta o alvo com
  -- gerente/colaborador, então sem esta linha a RPC aceitaria marcar tarefa
  -- para quem a matriz nunca desenha — o registro órfão que o alcance existe
  -- justamente para impedir.
  -- COALESCE pelo mesmo motivo do guard de papel lá em cima: `NULL NOT IN (…)`
  -- é NULL, e um IF que recebe NULL simplesmente não dispara.
  IF NOT COALESCE(v_perfil.role IN ('gerente','colaborador'), false) THEN
    RAISE EXCEPTION 'Só gerente ou colaborador executa tarefa da aula (% é %).',
      v_perfil.nome, v_perfil.role USING ERRCODE = '22023';
  END IF;

  -- Marcar quem a atividade não alcança criaria uma linha que nenhuma tela lê
  -- de volta: o painel monta o alvo pela mesma régua, e o registro ficaria
  -- órfão inflando o denominador de ninguém.
  IF NOT COALESCE(public.atividade_aula_alcanca_perfil(
        v_atividade.filiais, v_atividade.publico, v_perfil.filial, v_perfil.role), false) THEN
    RAISE EXCEPTION 'Esta atividade não alcança % (filial ou público não batem).', v_perfil.nome
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_feito, false) THEN
    INSERT INTO public.aula_tarefas_realizadas
      (atividade_id, user_id, tarefa_idx, nome_snapshot, filial, marcado_por)
    VALUES
      (p_atividade_id, p_user_id, p_tarefa_idx, v_perfil.nome, v_perfil.filial, auth.uid())
    ON CONFLICT (atividade_id, user_id, tarefa_idx) DO NOTHING;
  ELSE
    DELETE FROM public.aula_tarefas_realizadas
     WHERE atividade_id = p_atividade_id
       AND user_id      = p_user_id
       AND tarefa_idx   = p_tarefa_idx;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────
-- 5. Grants (padrão da migr. 260: nada nominalmente para anon)
-- ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.atividade_aula_alcanca_perfil(text[], text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.atividade_aula_alcanca(text[], text)                    FROM public, anon;
REVOKE ALL ON FUNCTION public.marcar_tarefa_aula(uuid, uuid, integer, boolean)        FROM public, anon;

GRANT EXECUTE ON FUNCTION public.atividade_aula_alcanca_perfil(text[], text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atividade_aula_alcanca(text[], text)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_tarefa_aula(uuid, uuid, integer, boolean)        TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 6. Realtime
-- ─────────────────────────────────────────────
-- Duas pontas dependem disto. O aluno recebe a devolutiva sem F5 — e o Modo
-- Aula esconde o sino dele, então não há outro canal. E o professor que marca
-- no celular, andando pela sala, vê o painel projetado acompanhar.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'aula_tarefas_realizadas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.aula_tarefas_realizadas;
  END IF;
END $$;

-- Esta tabela DESVIA da convenção da migr. 329 ("canal sem filtro + refetch,
-- logo REPLICA IDENTITY DEFAULT basta"), e o motivo é o DELETE.
--
-- Desmarcar é DELETE. Com REPLICA IDENTITY DEFAULT o WAL carrega só a chave
-- primária, então a policy do aluno (`user_id = auth.uid()`) não tem `user_id`
-- para avaliar e o evento não chega até ele. O professor corrige a marcação na
-- frente da turma e o selo «Realizada» fica na tela do aluno até ele recarregar
-- — exatamente o F5 que o realtime existe para evitar, e ainda por cima
-- mostrando algo que deixou de ser verdade.
--
-- FULL põe a linha antiga no WAL e a policy passa a ter o que ler. O custo é
-- proporcional à tabela, que guarda cinco colunas curtas por tarefa marcada.
ALTER TABLE public.aula_tarefas_realizadas REPLICA IDENTITY FULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- alcance parametrizado bate com o da sessão:
--   SELECT public.atividade_aula_alcanca_perfil(ARRAY['SuperMax'],'todos','SuperMax','colaborador'); -- t
--   SELECT public.atividade_aula_alcanca_perfil(ARRAY['SuperMax'],'gerentes','SuperMax','colaborador'); -- f
--
--   -- marcar e desmarcar (como admin):
--   SELECT public.marcar_tarefa_aula('<atividade>','<aluno>',0,true);
--   SELECT user_id, tarefa_idx, marcado_em FROM aula_tarefas_realizadas WHERE atividade_id = '<atividade>';
--   SELECT public.marcar_tarefa_aula('<atividade>','<aluno>',0,false);
--
--   -- publicação do realtime:
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename LIKE 'aula_%';
--   -- esperado: aula_config, aula_atividades, aula_atividades_ciencia,
--   --           aula_tarefas_realizadas
-- =================================================================
