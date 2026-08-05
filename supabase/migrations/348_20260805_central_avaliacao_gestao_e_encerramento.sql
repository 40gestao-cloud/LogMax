-- =================================================================
-- 348 — Central de Avaliação: tira o beco sem saída do conselheiro,
--       amarra a liberação ao estado da competição e avisa quando a
--       tarefa encerra.
--
-- 1) TAREFA DE CONSELHEIRO NASCIA ÓRFÃ
--    `criar_matriz_tarefa` (345) aceita conselheiro/gerente-conselheiro,
--    mas TODA a gestão da tarefa passa por `_assert_matriz_admin()`
--    (admin/CEO). Resultado: o conselheiro cria, a tarefa nasce
--    'rascunho' e ele não consegue liberar, editar nem mexer em
--    participante — fica encalhada até admin/CEO reparar.
--    Correção: quem criou gerencia a PRÓPRIA tarefa (liberar, editar,
--    participantes, e remover enquanto ainda é rascunho).
--    `encerrar`/`reabrir` seguem admin/CEO de propósito: encerrar é o
--    gesto que revela o voto selado da 345 — deixar o próprio avaliador
--    encerrar abriria a porta pra encerrar, espiar a nota alheia e
--    reabrir.
--
-- 2) LIBERAR EM COMPETIÇÃO QUE JÁ NÃO ACEITA NOTA
--    `liberar_matriz_tarefa` não olhava o status da competição, mas
--    `avaliar_item_matriz` exige 'em_andamento'. Dava pra liberar uma
--    tarefa em competição 'aguardando_encerramento' e criar uma tarefa
--    "Em avaliação" que ninguém consegue avaliar (e que o lembrete
--    diário também ignora).
--
-- 3) ENCERRAR ERA SILENCIOSO
--    Liberar avisa o conselho; encerrar — que é quando as notas se
--    revelam pro conselho e a filial passa a enxergar a média pela
--    `media_participantes_competicao` (346) — não avisava ninguém.
--    Agora notifica a Matriz e cada filial com participante na tarefa.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Guard de gestão da tarefa ──────────────────────────────────
-- admin/CEO da Matriz sempre passam. Conselheiro (ou gerente com
-- is_conselheiro) passa só na tarefa que ele mesmo criou.
-- p_so_rascunho = ação destrutiva que o criador só pode fazer antes de
-- a tarefa aceitar nota.
CREATE OR REPLACE FUNCTION public._assert_matriz_tarefa_gestor(
  p_tarefa_id   uuid,
  p_so_rascunho boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role    text;
  v_filial  text;
  v_cons    boolean;
  v_criador uuid;
  v_status  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_cons
    FROM user_profiles WHERE id = auth.uid();

  IF v_filial IS DISTINCT FROM 'Matriz' THEN
    RAISE EXCEPTION 'Apenas a Matriz gerencia tarefas da competição' USING ERRCODE = '42501';
  END IF;

  IF v_role IN ('admin','ceo') THEN
    RETURN;
  END IF;

  IF NOT (v_role = 'conselheiro' OR (v_role = 'gerente' AND COALESCE(v_cons, false))) THEN
    RAISE EXCEPTION 'Apenas admin/CEO da Matriz' USING ERRCODE = '42501';
  END IF;

  SELECT criado_por, status INTO v_criador, v_status
    FROM matriz_tarefas WHERE id = p_tarefa_id AND ativo = true;
  IF v_criador IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_criador IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Conselheiro só gerencia a tarefa que ele mesmo criou' USING ERRCODE = '42501';
  END IF;
  IF p_so_rascunho AND v_status IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'Tarefa já liberada — a partir daqui só admin/CEO' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_matriz_tarefa_gestor(uuid, boolean) FROM public, anon, authenticated;

-- ── 2. Liberar: criador também libera + competição precisa aceitar ─
CREATE OR REPLACE FUNCTION public.liberar_matriz_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_nome   text;
  v_comp   uuid;
  v_n_part int;
BEGIN
  PERFORM _assert_matriz_tarefa_gestor(p_tarefa_id);

  SELECT status, nome, competicao_id INTO v_status, v_nome, v_comp
    FROM matriz_tarefas WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — use Reabrir' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'aberta' THEN
    RAISE EXCEPTION 'Tarefa já está liberada para notas' USING ERRCODE = 'P0001';
  END IF;

  -- Liberar numa competição que não aceita mais nota produz tarefa
  -- "Em avaliação" que a RPC de avaliação recusa.
  IF NOT EXISTS (
    SELECT 1 FROM competicoes_matriz
     WHERE id = v_comp AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento — o conselho não conseguiria dar nota' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_n_part
    FROM matriz_tarefa_participantes WHERE tarefa_id = p_tarefa_id AND ativo = true;
  IF v_n_part = 0 THEN
    RAISE EXCEPTION 'Adicione participantes antes de liberar' USING ERRCODE = 'P0001';
  END IF;

  UPDATE matriz_tarefas
     SET status = 'aberta', liberada_em = now(), liberada_por = auth.uid(), updated_at = now()
   WHERE id = p_tarefa_id;

  -- setor 'all' + filial 'Matriz': a policy notif_read entrega pro
  -- conselho e barra as filiais.
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  VALUES (
    'all', 'info',
    'Avaliação liberada',
    format('"%s" está liberada para notas — %s participante(s) aguardando o conselho.', v_nome, v_n_part),
    'matriz-avaliacoes', 'Alta', auth.uid(), p_tarefa_id, 'tarefa_liberada', 'Matriz'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.liberar_matriz_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.liberar_matriz_tarefa(uuid) TO authenticated;

-- ── 3. Editar tarefa: criador edita a própria ─────────────────────
CREATE OR REPLACE FUNCTION public.atualizar_matriz_tarefa(
  p_tarefa_id uuid,
  p_nome      text,
  p_descricao text,
  p_data      date
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM _assert_matriz_tarefa_gestor(p_tarefa_id);
  IF COALESCE(TRIM(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Nome obrigatório' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM matriz_tarefas
   WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra antes de editar' USING ERRCODE = 'P0001';
  END IF;

  UPDATE matriz_tarefas
     SET nome        = TRIM(p_nome),
         descricao   = NULLIF(TRIM(p_descricao), ''),
         data        = p_data,
         updated_at  = now()
   WHERE id = p_tarefa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_matriz_tarefa(uuid, text, text, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.atualizar_matriz_tarefa(uuid, text, text, date) TO authenticated;

-- ── 4. Participantes: criador mexe na própria tarefa ──────────────
CREATE OR REPLACE FUNCTION public.adicionar_matriz_participante(
  p_tarefa_id      uuid,
  p_funcionario_id uuid,
  p_nome           text,
  p_filial         text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_id     uuid;
BEGIN
  PERFORM _assert_matriz_tarefa_gestor(p_tarefa_id);
  IF p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Filial inválida: %', p_filial USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM matriz_tarefas
   WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra antes de mexer em participantes' USING ERRCODE = 'P0001';
  END IF;

  UPDATE matriz_tarefa_participantes
     SET ativo = true, nome_snapshot = COALESCE(p_nome, nome_snapshot), filial = p_filial
   WHERE tarefa_id = p_tarefa_id
     AND funcionario_id = p_funcionario_id
     AND ativo = false
   RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO matriz_tarefa_participantes (tarefa_id, funcionario_id, nome_snapshot, filial)
  VALUES (p_tarefa_id, p_funcionario_id, COALESCE(p_nome, ''), p_filial)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.adicionar_matriz_participante(uuid, uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.adicionar_matriz_participante(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remover_matriz_participante(p_participante_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tarefa uuid;
  v_status text;
BEGIN
  SELECT p.tarefa_id, t.status
    INTO v_tarefa, v_status
    FROM matriz_tarefa_participantes p
    JOIN matriz_tarefas t ON t.id = p.tarefa_id
   WHERE p.id = p_participante_id AND p.ativo = true AND t.ativo = true;
  IF v_tarefa IS NULL THEN
    RAISE EXCEPTION 'Participante não encontrado' USING ERRCODE = 'P0001';
  END IF;

  PERFORM _assert_matriz_tarefa_gestor(v_tarefa);

  IF v_status = 'encerrada' THEN
    RAISE EXCEPTION 'Tarefa encerrada — reabra antes de mexer em participantes' USING ERRCODE = 'P0001';
  END IF;

  UPDATE matriz_tarefa_participantes SET ativo = false WHERE id = p_participante_id;
  -- Notas do conselho pra esse participante somem do placar junto
  UPDATE avaliacoes_matriz SET ativo = false
   WHERE item_id = p_participante_id
     AND item_tipo LIKE 'tarefa\_%';
END;
$$;

REVOKE ALL ON FUNCTION public.remover_matriz_participante(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remover_matriz_participante(uuid) TO authenticated;

-- ── 5. Remover tarefa: criador só enquanto rascunho ───────────────
CREATE OR REPLACE FUNCTION public.remover_matriz_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM _assert_matriz_tarefa_gestor(p_tarefa_id, true);

  IF NOT EXISTS (SELECT 1 FROM matriz_tarefas WHERE id = p_tarefa_id AND ativo = true) THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;

  UPDATE matriz_tarefas SET ativo = false, updated_at = now() WHERE id = p_tarefa_id;
  UPDATE matriz_tarefa_participantes SET ativo = false WHERE tarefa_id = p_tarefa_id;
  -- Notas ficam no histórico (ativo = false) e somem do placar ativo.
  UPDATE avaliacoes_matriz SET ativo = false
   WHERE item_tipo LIKE 'tarefa\_%'
     AND item_id IN (SELECT id FROM matriz_tarefa_participantes WHERE tarefa_id = p_tarefa_id);
END;
$$;

REVOKE ALL ON FUNCTION public.remover_matriz_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remover_matriz_tarefa(uuid) TO authenticated;

-- ── 6. Encerrar avisa Matriz + filiais envolvidas ─────────────────
CREATE OR REPLACE FUNCTION public.encerrar_matriz_tarefa(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_nome   text;
  v_f      record;
BEGIN
  PERFORM _assert_matriz_admin();
  SELECT status, nome INTO v_status, v_nome FROM matriz_tarefas
   WHERE id = p_tarefa_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'encerrada' THEN RETURN; END IF;

  UPDATE matriz_tarefas
     SET status = 'encerrada',
         encerrada_em = now(),
         encerrada_por = auth.uid(),
         updated_at = now()
   WHERE id = p_tarefa_id;

  -- Conselho: é aqui que o voto selado se abre.
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  VALUES (
    'all', 'info',
    'Avaliação encerrada',
    format('"%s" foi encerrada — as notas do conselho estão reveladas e congeladas.', v_nome),
    'matriz-avaliacoes', 'Média', auth.uid(), p_tarefa_id, 'tarefa_encerrada', 'Matriz'
  );

  -- Filiais com participante na tarefa: agora enxergam a média pela
  -- media_participantes_competicao (346).
  FOR v_f IN
    SELECT filial, COUNT(*)::int AS n
      FROM matriz_tarefa_participantes
     WHERE tarefa_id = p_tarefa_id AND ativo = true
     GROUP BY filial
  LOOP
    INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
    VALUES (
      'all', 'info',
      'Resultado da avaliação da Matriz',
      format('"%s" foi encerrada — a nota de %s participante(s) da sua unidade já pode ser consultada.', v_nome, v_f.n),
      'demandas-conselho', 'Média', auth.uid(), p_tarefa_id, 'tarefa_encerrada', v_f.filial
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_matriz_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_matriz_tarefa(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reabrir_matriz_tarefa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_matriz_tarefa(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
