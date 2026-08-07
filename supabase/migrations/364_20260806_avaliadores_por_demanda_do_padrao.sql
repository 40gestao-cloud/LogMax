-- =================================================================
-- 364 — Quem dá nota é escolhido por demanda (ciclo Padrão)
--
-- Como era: toda demanda do Padrão era avaliada pelo mesmo conjunto fixo
-- — CEO e conselheiros da Matriz —, e quem criava a demanda não entrava
-- nisso. Admin publicava a pauta e ficava de fora da nota, mesmo sendo
-- quem montou a demanda e sabe o que ela cobra.
--
-- Como fica: cada demanda carrega a própria lista de avaliadores. Quem
-- cria se inclui, e escolhe quem mais dá nota. É lista, não hierarquia:
-- estar nela é o que autoriza, seja admin, CEO ou conselheiro.
--
-- Nota: isto é a NOTA da demanda do Padrão, não o voto da Competição do
-- Conselho — `matriz_tarefas` e o placar inter-filiais não são tocados.
--
-- Compatibilidade: demanda sem lista (tudo que existe hoje) continua
-- valendo a régua antiga — CEO e conselheiros, admin fora. Nenhuma nota
-- já dada muda de valor.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Lista de avaliadores da demanda ────────────────────────────
CREATE TABLE IF NOT EXISTS public.ciclo_tarefa_avaliadores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id       uuid NOT NULL REFERENCES public.ciclo_tarefas(id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ativo           boolean NOT NULL DEFAULT true
);

-- Partial UNIQUE: sem `WHERE ativo` o avaliador retirado travaria a
-- recolocação dele na mesma demanda.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ciclo_tarefa_avaliador
  ON public.ciclo_tarefa_avaliadores (tarefa_id, user_profile_id)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_ciclo_tarefa_avaliador_tarefa
  ON public.ciclo_tarefa_avaliadores (tarefa_id) WHERE ativo = true;

-- ── 2. Guard: agora depende da demanda, não só do cargo ───────────
-- Função nova em vez de trocar a assinatura da `_assert_ciclo_tarefa_avaliador()`:
-- sobrecarga de função é justamente o que o PostgREST recusa resolver.
CREATE OR REPLACE FUNCTION public._assert_pode_avaliar_ciclo_tarefa(p_participante_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role   text;
  v_filial text;
  v_cons   boolean;
  v_tarefa uuid;
  v_tem_lista boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro INTO v_role, v_filial, v_cons
    FROM user_profiles WHERE id = auth.uid();

  -- Nota da demanda é assunto da Matriz em qualquer cenário.
  IF v_filial IS DISTINCT FROM 'Matriz' THEN
    RAISE EXCEPTION 'Apenas a Matriz dá nota em demanda do ciclo'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.tarefa_id INTO v_tarefa
    FROM ciclo_tarefa_participantes p
   WHERE p.id = p_participante_id AND p.ativo = true;
  IF v_tarefa IS NULL THEN
    RAISE EXCEPTION 'Participante não encontrado' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ciclo_tarefa_avaliadores
     WHERE tarefa_id = v_tarefa AND ativo = true
  ) INTO v_tem_lista;

  IF v_tem_lista THEN
    -- `COALESCE(..., false)`: guard que testa NOT de expressão NULL não
    -- barra ninguém — o IF simplesmente não dispara.
    IF NOT COALESCE((
      SELECT true FROM ciclo_tarefa_avaliadores
       WHERE tarefa_id = v_tarefa AND user_profile_id = auth.uid() AND ativo = true
    ), false) THEN
      RAISE EXCEPTION 'Você não foi designado para dar nota nesta demanda'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Demanda anterior à 364: régua antiga, admin fora.
    IF NOT COALESCE(
         v_role IN ('ceo','conselheiro')
         OR (v_role = 'gerente' AND COALESCE(v_cons,false)), false)
    THEN
      RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz dão nota'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_pode_avaliar_ciclo_tarefa(uuid) FROM public, anon;

-- ── 3. RPC: definir a lista da demanda ────────────────────────────
-- Separada de criar/atualizar de propósito: mexer na assinatura daquelas
-- criaria sobrecarga e o PostgREST passaria a recusar as duas.
CREATE OR REPLACE FUNCTION public.definir_avaliadores_ciclo_tarefa(
  p_tarefa_id   uuid,
  p_avaliadores uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_id     uuid;
  v_ids    uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM _assert_ciclo_tarefa_gestor();

  SELECT status INTO v_status FROM ciclo_tarefas WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Demanda encerrada — reabra para trocar os avaliadores'
      USING ERRCODE = 'P0001';
  END IF;

  FOREACH v_id IN ARRAY COALESCE(p_avaliadores, ARRAY[]::uuid[])
  LOOP
    -- Só gente da Matriz que dá nota: admin, CEO, conselheiro, ou gerente
    -- com o selo. Colaborador de filial não entra nem por engano.
    IF NOT COALESCE((
      SELECT filial = 'Matriz'
             AND (role IN ('admin','ceo','conselheiro')
                  OR (role = 'gerente' AND COALESCE(is_conselheiro,false)))
        FROM user_profiles WHERE id = v_id
    ), false) THEN
      RAISE EXCEPTION 'Avaliador inválido para demanda do ciclo' USING ERRCODE = 'P0001';
    END IF;

    UPDATE ciclo_tarefa_avaliadores
       SET ativo = true
     WHERE tarefa_id = p_tarefa_id AND user_profile_id = v_id;

    IF NOT FOUND THEN
      INSERT INTO ciclo_tarefa_avaliadores (tarefa_id, user_profile_id)
      VALUES (p_tarefa_id, v_id);
    END IF;

    v_ids := v_ids || v_id;
  END LOOP;

  -- Quem saiu da lista para de avaliar. A nota que ele já deu continua na
  -- tabela e continua na média: retirar do time depois do trabalho feito
  -- não apaga o julgamento que ele emitiu.
  UPDATE ciclo_tarefa_avaliadores
     SET ativo = false
   WHERE tarefa_id = p_tarefa_id
     AND ativo = true
     AND NOT (user_profile_id = ANY(array_remove(v_ids, NULL)));
END;
$$;

REVOKE ALL ON FUNCTION public.definir_avaliadores_ciclo_tarefa(uuid,uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.definir_avaliadores_ciclo_tarefa(uuid,uuid[]) TO authenticated;

-- ── 4. As RPCs de nota passam a usar o guard por demanda ──────────
CREATE OR REPLACE FUNCTION public.avaliar_ciclo_tarefa(
  p_participante_id uuid,
  p_nota            numeric,
  p_comentario      text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_status text; v_id uuid;
BEGIN
  PERFORM _assert_pode_avaliar_ciclo_tarefa(p_participante_id);

  IF p_nota IS NULL OR p_nota < 0 OR p_nota > 10 THEN
    RAISE EXCEPTION 'Nota deve estar entre 0 e 10' USING ERRCODE = 'P0001';
  END IF;

  SELECT t.status INTO v_status
    FROM ciclo_tarefa_participantes p
    JOIN ciclo_tarefas t ON t.id = p.tarefa_id
   WHERE p.id = p_participante_id AND p.ativo = true AND t.ativo = true;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Participante não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'rascunho' THEN
    RAISE EXCEPTION 'Tarefa ainda não liberada para notas' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'aberta' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra para alterar notas' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO ciclo_tarefa_avaliacoes (participante_id, avaliador_id, nota, comentario)
  VALUES (p_participante_id, auth.uid(), p_nota, NULLIF(TRIM(COALESCE(p_comentario,'')),''))
  ON CONFLICT (participante_id, avaliador_id) WHERE ativo = true
  DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.avaliar_ciclo_tarefa(uuid,numeric,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_ciclo_tarefa(uuid,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remover_avaliacao_ciclo_tarefa(p_participante_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_status text; v_afetadas int;
BEGIN
  PERFORM _assert_pode_avaliar_ciclo_tarefa(p_participante_id);

  SELECT t.status INTO v_status
    FROM ciclo_tarefa_participantes p
    JOIN ciclo_tarefas t ON t.id = p.tarefa_id
   WHERE p.id = p_participante_id AND p.ativo = true AND t.ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Participante não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'aberta' THEN
    RAISE EXCEPTION 'Tarefa não está liberada para notas' USING ERRCODE = 'P0001';
  END IF;

  UPDATE ciclo_tarefa_avaliacoes
     SET ativo = false, updated_at = now()
   WHERE participante_id = p_participante_id
     AND avaliador_id = auth.uid()
     AND ativo = true;

  GET DIAGNOSTICS v_afetadas = ROW_COUNT;
  IF v_afetadas = 0 THEN
    RAISE EXCEPTION 'Você não tem nota nesta demanda' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remover_avaliacao_ciclo_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remover_avaliacao_ciclo_tarefa(uuid) TO authenticated;

-- ── 5. Média deixa de excluir admin por cargo ─────────────────────
-- O `up.role <> 'admin'` era a forma de dizer "admin não dá nota". Agora
-- quem dá nota é quem está na lista, e a escrita só passa pelo guard —
-- então toda nota gravada é nota autorizada. Nenhum valor histórico muda:
-- admin nunca conseguiu gravar nota aqui, não há linha dele para entrar.
CREATE OR REPLACE FUNCTION public.media_participantes_ciclo(p_ciclo_id uuid)
RETURNS TABLE (participante_id uuid, filial text, media numeric, n int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_filial text;
BEGIN
  SELECT up.filial INTO v_filial FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.filial,
         ROUND(AVG(a.nota), 2),
         COUNT(*)::int
    FROM ciclo_tarefa_avaliacoes a
    JOIN ciclo_tarefa_participantes p ON p.id = a.participante_id
    JOIN ciclo_tarefas t ON t.id = p.tarefa_id
   WHERE t.ciclo_id = p_ciclo_id
     AND a.ativo = true AND p.ativo = true AND t.ativo = true
     AND t.status = 'encerrada'
     AND (v_filial = 'Matriz' OR p.filial = v_filial)
   GROUP BY p.id, p.filial;
END;
$$;

REVOKE ALL ON FUNCTION public.media_participantes_ciclo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.media_participantes_ciclo(uuid) TO authenticated;

-- ── 6. RLS ────────────────────────────────────────────────────────
-- Escrita é 100% via RPC: nenhuma policy de INSERT/UPDATE/DELETE.
ALTER TABLE public.ciclo_tarefa_avaliadores ENABLE ROW LEVEL SECURITY;

-- Quem é designado é informação da Matriz. A filial não precisa saber
-- quem a nota dela e nunca leu esta tabela.
DROP POLICY IF EXISTS ct_avaliadores_select ON public.ciclo_tarefa_avaliadores;
CREATE POLICY ct_avaliadores_select ON public.ciclo_tarefa_avaliadores
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND filial = 'Matriz')
  );

-- ── 7. Realtime ───────────────────────────────────────────────────
-- Sem a tabela na publicação o painel não reage a troca de avaliador.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'ciclo_tarefa_avaliadores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ciclo_tarefa_avaliadores;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
