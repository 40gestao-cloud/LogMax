-- =================================================================
-- 361 — Tarefas do ciclo Padrão (Matriz cria demanda, filial executa)
--
-- Gargalo fechado aqui:
--   Central de Avaliação > Padrão só criava CICLO. Tarefa/demanda só
--   existia dentro de uma Competição do Conselho, porque
--   `matriz_tarefas.competicao_id` é NOT NULL (migr. 216). Resultado:
--   ciclo Padrão aberto = filial sem nenhuma pauta vinda da Matriz, e
--   Filiais > Demandas só tinha "Demandas do Conselho".
--
-- Escolha de modelagem: TABELA NOVA, não reaproveitar matriz_tarefas.
--   Amarrar tarefa de ciclo em `avaliacoes_matriz` faria a nota entrar
--   no `calcular_placar_competicao` — o Padrão passaria a mexer no
--   ranking inter-filiais sem ninguém pedir. Aqui o julgamento é do
--   ciclo e morre no ciclo.
--
-- Fluxo (espelha a régua da 345, de propósito):
--   rascunho → aberta (libera nota + aviso no sino) → encerrada
--   Voto selado: conselheiro não vê nota alheia antes de encerrar.
--   Filial só vê média de tarefa ENCERRADA, e só dos próprios
--   participantes — resultado, nunca o voto.
--
-- Quem faz o quê:
--   admin/CEO/conselheiro da Matriz → cria, edita, libera, encerra
--   CEO/conselheiro da Matriz       → dá nota (admin modera, não vota,
--                                     mesma regra da 240)
--   qualquer um da filial           → lê a pauta + a média da filial
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Tabelas ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ciclo_tarefas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id     uuid NOT NULL REFERENCES public.ciclos_avaliacao(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN (
                 'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
                 'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica'
               )),
  nome         text NOT NULL,
  descricao    text,
  data         date NOT NULL,
  status       text NOT NULL DEFAULT 'rascunho'
                 CHECK (status IN ('rascunho','aberta','encerrada')),
  criado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  liberada_em  timestamptz,
  liberada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  ativo        boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_ciclo_tarefas_ciclo
  ON public.ciclo_tarefas (ciclo_id, tipo) WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.ciclo_tarefa_participantes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id      uuid NOT NULL REFERENCES public.ciclo_tarefas(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  nome_snapshot  text NOT NULL,
  filial         text NOT NULL CHECK (filial IN ('SuperMax','MaxLook','TechMax')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  ativo          boolean NOT NULL DEFAULT true
);

-- Partial UNIQUE: sem `WHERE ativo` o participante removido travaria a
-- re-inclusão dele na mesma tarefa.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ciclo_tarefa_participante
  ON public.ciclo_tarefa_participantes (tarefa_id, funcionario_id)
  WHERE ativo = true AND funcionario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ciclo_tarefa_part_tarefa
  ON public.ciclo_tarefa_participantes (tarefa_id) WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_ciclo_tarefa_part_filial
  ON public.ciclo_tarefa_participantes (filial) WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.ciclo_tarefa_avaliacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participante_id uuid NOT NULL REFERENCES public.ciclo_tarefa_participantes(id) ON DELETE CASCADE,
  avaliador_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nota            numeric(4,2) NOT NULL CHECK (nota >= 0 AND nota <= 10),
  comentario      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  ativo           boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ciclo_tarefa_aval
  ON public.ciclo_tarefa_avaliacoes (participante_id, avaliador_id)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_ciclo_tarefa_aval_part
  ON public.ciclo_tarefa_avaliacoes (participante_id) WHERE ativo = true;

-- updated_at
CREATE OR REPLACE FUNCTION public.trg_ciclo_tarefas_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ciclo_tarefas_upd ON public.ciclo_tarefas;
CREATE TRIGGER trg_ciclo_tarefas_upd
  BEFORE UPDATE ON public.ciclo_tarefas
  FOR EACH ROW EXECUTE FUNCTION public.trg_ciclo_tarefas_updated_at();

DROP TRIGGER IF EXISTS trg_ciclo_tarefa_aval_upd ON public.ciclo_tarefa_avaliacoes;
CREATE TRIGGER trg_ciclo_tarefa_aval_upd
  BEFORE UPDATE ON public.ciclo_tarefa_avaliacoes
  FOR EACH ROW EXECUTE FUNCTION public.trg_ciclo_tarefas_updated_at();

-- ── 2. Guards internos ────────────────────────────────────────────

-- Quem pode GERIR tarefa do ciclo: conselho da Matriz (inclui admin).
CREATE OR REPLACE FUNCTION public._assert_ciclo_tarefa_gestor()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_role text; v_filial text; v_cons boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT role, filial, is_conselheiro INTO v_role, v_filial, v_cons
    FROM user_profiles WHERE id = auth.uid();
  -- COALESCE obrigatório: `NOT (… OR (v_role='gerente' AND v_cons))` com
  -- v_cons NULL devolve NULL e o IF não barra ninguém.
  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT COALESCE(
          v_role IN ('admin','ceo','conselheiro')
          OR (v_role = 'gerente' AND COALESCE(v_cons,false)), false)
  THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro da Matriz gerencia tarefas do ciclo'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Quem pode DAR NOTA: CEO/conselheiro da Matriz. Admin modera, não vota.
CREATE OR REPLACE FUNCTION public._assert_ciclo_tarefa_avaliador()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_role text; v_filial text; v_cons boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT role, filial, is_conselheiro INTO v_role, v_filial, v_cons
    FROM user_profiles WHERE id = auth.uid();
  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT COALESCE(
          v_role IN ('ceo','conselheiro')
          OR (v_role = 'gerente' AND COALESCE(v_cons,false)), false)
  THEN
    RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz dão nota'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_ciclo_tarefa_gestor()   FROM public, anon;
REVOKE ALL ON FUNCTION public._assert_ciclo_tarefa_avaliador() FROM public, anon;

-- ── 3. RPC: criar tarefa ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.criar_ciclo_tarefa(
  p_ciclo_id      uuid,
  p_tipo          text,
  p_nome          text,
  p_descricao     text,
  p_data          date,
  p_participantes jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tarefa uuid;
  v_p      jsonb;
  v_status text;
BEGIN
  PERFORM _assert_ciclo_tarefa_gestor();

  IF p_tipo NOT IN (
    'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
    'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica'
  ) THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(TRIM(p_nome),'') = '' THEN
    RAISE EXCEPTION 'Informe o nome da tarefa' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM ciclos_avaliacao WHERE id = p_ciclo_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Ciclo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'Aberto' THEN
    RAISE EXCEPTION 'Ciclo fechado — reabra para criar tarefas' USING ERRCODE = 'P0001';
  END IF;

  -- Ciclo gerado por competição pertence à Competição do Conselho; a
  -- tarefa dele nasce lá, com placar. Aqui é só o Padrão.
  IF EXISTS (SELECT 1 FROM competicoes_matriz WHERE ciclo_id = p_ciclo_id) THEN
    RAISE EXCEPTION 'Este ciclo é de competição — crie a tarefa na Competição do Conselho'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO ciclo_tarefas (ciclo_id, tipo, nome, descricao, data, criado_por, status)
  VALUES (p_ciclo_id, p_tipo, TRIM(p_nome), NULLIF(TRIM(COALESCE(p_descricao,'')),''),
          p_data, auth.uid(), 'rascunho')
  RETURNING id INTO v_tarefa;

  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes,'[]'::jsonb))
  LOOP
    INSERT INTO ciclo_tarefa_participantes (tarefa_id, funcionario_id, nome_snapshot, filial)
    VALUES (
      v_tarefa,
      NULLIF(v_p->>'funcionario_id','')::uuid,
      COALESCE(v_p->>'nome',''),
      v_p->>'filial'
    );
  END LOOP;

  RETURN v_tarefa;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_ciclo_tarefa(uuid,text,text,text,date,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.criar_ciclo_tarefa(uuid,text,text,text,date,jsonb) TO authenticated;

-- ── 4. RPC: atualizar (pauta + participantes) ─────────────────────

CREATE OR REPLACE FUNCTION public.atualizar_ciclo_tarefa(
  p_tarefa_id     uuid,
  p_nome          text,
  p_descricao     text,
  p_data          date,
  p_participantes jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_p      jsonb;
  v_ids    uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM _assert_ciclo_tarefa_gestor();

  SELECT status INTO v_status FROM ciclo_tarefas WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra para editar' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(TRIM(p_nome),'') = '' THEN
    RAISE EXCEPTION 'Informe o nome da tarefa' USING ERRCODE = 'P0001';
  END IF;

  UPDATE ciclo_tarefas
     SET nome      = TRIM(p_nome),
         descricao = NULLIF(TRIM(COALESCE(p_descricao,'')),''),
         data      = p_data
   WHERE id = p_tarefa_id;

  -- Reativa quem voltou, insere quem é novo, desativa quem saiu.
  -- Nota já dada a um participante removido fica no banco mas sai da
  -- média — o JOIN em `media_participantes_ciclo` filtra ativo = true.
  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes,'[]'::jsonb))
  LOOP
    DECLARE
      v_func uuid := NULLIF(v_p->>'funcionario_id','')::uuid;
      v_id   uuid;
    BEGIN
      IF v_func IS NOT NULL THEN
        UPDATE ciclo_tarefa_participantes
           SET ativo = true, nome_snapshot = COALESCE(v_p->>'nome', nome_snapshot),
               filial = v_p->>'filial'
         WHERE tarefa_id = p_tarefa_id AND funcionario_id = v_func
         RETURNING id INTO v_id;
      END IF;

      IF v_id IS NULL THEN
        INSERT INTO ciclo_tarefa_participantes (tarefa_id, funcionario_id, nome_snapshot, filial)
        VALUES (p_tarefa_id, v_func, COALESCE(v_p->>'nome',''), v_p->>'filial')
        RETURNING id INTO v_id;
      END IF;

      v_ids := v_ids || v_id;
    END;
  END LOOP;

  -- `array_remove(…, NULL)`: um NULL no array faria `id = ANY(v_ids)`
  -- devolver NULL, o NOT devolver NULL, e nenhum participante sair da
  -- tarefa — a remoção falharia em silêncio.
  UPDATE ciclo_tarefa_participantes
     SET ativo = false
   WHERE tarefa_id = p_tarefa_id
     AND ativo = true
     AND NOT (id = ANY(array_remove(v_ids, NULL)));
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_ciclo_tarefa(uuid,text,text,date,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_ciclo_tarefa(uuid,text,text,date,jsonb) TO authenticated;

-- ── 5. RPC: liberar / encerrar / reabrir / excluir ────────────────

CREATE OR REPLACE FUNCTION public.liberar_ciclo_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text; v_nome text; v_n_part int;
BEGIN
  PERFORM _assert_ciclo_tarefa_gestor();

  SELECT status, nome INTO v_status, v_nome
    FROM ciclo_tarefas WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'aberta' THEN
    RAISE EXCEPTION 'Tarefa já está liberada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — use Reabrir' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_n_part
    FROM ciclo_tarefa_participantes WHERE tarefa_id = p_tarefa_id AND ativo = true;
  IF v_n_part = 0 THEN
    RAISE EXCEPTION 'Adicione participantes antes de liberar' USING ERRCODE = 'P0001';
  END IF;

  UPDATE ciclo_tarefas
     SET status = 'aberta', liberada_em = now(), liberada_por = auth.uid()
   WHERE id = p_tarefa_id;

  -- Aviso pro conselho (Matriz).
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  VALUES (
    'all', 'info',
    'Demanda do ciclo liberada',
    format('"%s" está liberada para notas — %s participante(s) aguardando o conselho.', v_nome, v_n_part),
    'matriz-avaliacoes', 'Alta', auth.uid(), p_tarefa_id, 'ciclo_tarefa_liberada', 'Matriz'
  );

  -- Aviso pras filiais que têm gente na tarefa: é aqui que a demanda
  -- aparece em Demandas > Padrão, então é aqui que ela é anunciada.
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  SELECT DISTINCT
    'all', 'info',
    'Nova demanda da Matriz',
    format('"%s" foi publicada em Demandas > Padrão.', v_nome),
    'demandas', 'Média', auth.uid(), p_tarefa_id, 'ciclo_tarefa_liberada', p.filial
    FROM ciclo_tarefa_participantes p
   WHERE p.tarefa_id = p_tarefa_id AND p.ativo = true;
END;
$$;

REVOKE ALL ON FUNCTION public.liberar_ciclo_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.liberar_ciclo_tarefa(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.encerrar_ciclo_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  PERFORM _assert_ciclo_tarefa_gestor();
  SELECT status INTO v_status FROM ciclo_tarefas WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'aberta' THEN
    RAISE EXCEPTION 'Só tarefa liberada pode ser encerrada' USING ERRCODE = 'P0001';
  END IF;
  UPDATE ciclo_tarefas SET status = 'encerrada' WHERE id = p_tarefa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_ciclo_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_ciclo_tarefa(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reabrir_ciclo_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  PERFORM _assert_ciclo_tarefa_gestor();
  SELECT status INTO v_status FROM ciclo_tarefas WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa não está encerrada' USING ERRCODE = 'P0001';
  END IF;
  UPDATE ciclo_tarefas SET status = 'aberta' WHERE id = p_tarefa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reabrir_ciclo_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_ciclo_tarefa(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.excluir_ciclo_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM _assert_ciclo_tarefa_gestor();
  IF NOT EXISTS (SELECT 1 FROM ciclo_tarefas WHERE id = p_tarefa_id AND ativo = true) THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  -- Soft-delete não cascateia sozinho: participante inativa junto,
  -- senão ele continua contando em qualquer agregado por filial.
  UPDATE ciclo_tarefas SET ativo = false WHERE id = p_tarefa_id;
  UPDATE ciclo_tarefa_participantes SET ativo = false WHERE tarefa_id = p_tarefa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_ciclo_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.excluir_ciclo_tarefa(uuid) TO authenticated;

-- ── 6. RPC: nota do conselho ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.avaliar_ciclo_tarefa(
  p_participante_id uuid,
  p_nota            numeric,
  p_comentario      text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_status text; v_id uuid;
BEGIN
  PERFORM _assert_ciclo_tarefa_avaliador();

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
  PERFORM _assert_ciclo_tarefa_avaliador();

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
    RAISE EXCEPTION 'Você não tem nota registrada neste participante' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remover_avaliacao_ciclo_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remover_avaliacao_ciclo_tarefa(uuid) TO authenticated;

-- ── 7. RPC: média que a filial enxerga ────────────────────────────
-- Mesma régua da 346: SECURITY DEFINER devolvendo só o agregado, de
-- tarefa ENCERRADA, sem nota de admin, escopado na filial de quem chama.

CREATE OR REPLACE FUNCTION public.media_participantes_ciclo(p_ciclo_id uuid)
RETURNS TABLE (
  participante_id uuid,
  filial          text,
  media_nota      numeric,
  n_notas         int
)
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
    JOIN user_profiles up ON up.id = a.avaliador_id
   WHERE t.ciclo_id = p_ciclo_id
     AND a.ativo = true AND p.ativo = true AND t.ativo = true
     AND t.status = 'encerrada'
     AND up.role <> 'admin'
     AND (v_filial = 'Matriz' OR p.filial = v_filial)
   GROUP BY p.id, p.filial;
END;
$$;

REVOKE ALL ON FUNCTION public.media_participantes_ciclo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.media_participantes_ciclo(uuid) TO authenticated;

-- ── 8. RLS ────────────────────────────────────────────────────────
-- Escrita é 100% via RPC acima: nenhuma policy de INSERT/UPDATE/DELETE.

ALTER TABLE public.ciclo_tarefas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ciclo_tarefa_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ciclo_tarefa_avaliacoes    ENABLE ROW LEVEL SECURITY;

-- Matriz vê tudo (inclusive rascunho); filial só o que já foi liberado.
DROP POLICY IF EXISTS ct_tarefas_select ON public.ciclo_tarefas;
CREATE POLICY ct_tarefas_select ON public.ciclo_tarefas
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND filial = 'Matriz')
    OR status <> 'rascunho'
  );

DROP POLICY IF EXISTS ct_part_select ON public.ciclo_tarefa_participantes;
CREATE POLICY ct_part_select ON public.ciclo_tarefa_participantes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND filial = 'Matriz')
    OR EXISTS (SELECT 1 FROM public.ciclo_tarefas t
                WHERE t.id = tarefa_id AND t.status <> 'rascunho')
  );

-- Voto selado (régua da 345): admin da Matriz audita e vê tudo; qualquer
-- um vê a própria linha; conselheiro só vê a nota alheia depois de a
-- tarefa encerrar. Filial não lê esta tabela — usa a RPC de média.
DROP POLICY IF EXISTS ct_aval_select ON public.ciclo_tarefa_avaliacoes;
CREATE POLICY ct_aval_select ON public.ciclo_tarefa_avaliacoes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND filial = 'Matriz' AND role = 'admin')
    OR avaliador_id = auth.uid()
    OR (
      EXISTS (SELECT 1 FROM public.user_profiles
               WHERE id = auth.uid() AND filial = 'Matriz'
                 AND (role IN ('ceo','conselheiro')
                      OR (role = 'gerente' AND is_conselheiro = true)))
      AND EXISTS (SELECT 1
                    FROM public.ciclo_tarefa_participantes p
                    JOIN public.ciclo_tarefas t ON t.id = p.tarefa_id
                   WHERE p.id = ciclo_tarefa_avaliacoes.participante_id
                     AND t.status = 'encerrada')
    )
  );

-- ── 9. Realtime ───────────────────────────────────────────────────
-- Sem a tabela na publicação o canal do painel ouve silêncio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'ciclo_tarefas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ciclo_tarefas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'ciclo_tarefa_participantes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ciclo_tarefa_participantes;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
