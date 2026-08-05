-- =================================================================
-- 345 — Tarefa nasce fechada, é liberada com aviso, e o voto do
--       conselho fica selado até a tarefa encerrar.
--
-- Duas mudanças de processo pedidas pela operação:
--
-- 1) LIBERAÇÃO
--    Criar tarefa não abre mais a votação. Ela nasce 'rascunho'
--    (participantes ainda entrando, pauta em ajuste) e só aceita nota
--    depois que admin/CEO clica em "Permitir notas". Esse clique
--    dispara aviso no sino do conselho.
--    Fluxo: rascunho → aberta → encerrada (reabrir volta pra aberta).
--
-- 2) VOTO SELADO
--    CEO e conselheiros deixam de enxergar a nota um do outro enquanto
--    a tarefa está em avaliação — ver a nota alheia antes de julgar
--    ancora o voto e achata o desvio entre avaliadores, corroendo a
--    independência que dá legitimidade ao Top 3.
--    Regra nova de SELECT em avaliacoes_matriz:
--      • admin da Matriz  → vê tudo, sempre (modera e audita, não vota)
--      • qualquer um      → vê sempre a PRÓPRIA linha
--      • CEO/conselheiro  → vê a linha alheia só depois da tarefa
--                           encerrada (aí é nominal: quem deu qual nota)
--    Tipos que não são tarefa_% (arte, promoção, campanha…) seguem a
--    regra antiga — lá o julgamento é declarado, não secreto.
--
--    As views agregadas são security_invoker (migr. 259), então herdam
--    esse sigilo automaticamente: não há porta lateral pelo F12.
--    `calcular_placar_competicao` é SECURITY DEFINER e continua somando
--    tudo — o placar não muda, só quem enxerga o detalhe.
--
-- 3) LEMBRETE DE PRAZO
--    RPC chamada pelo cron diário: competição em_andamento a ≤3 dias do
--    fim com participante sem nota do conselho gera 1 aviso por dia.
--
-- Compatibilidade: tarefas existentes estão 'aberta' e seguem abertas.
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Estado 'rascunho' ──────────────────────────────────────────
ALTER TABLE public.matriz_tarefas
  ADD COLUMN IF NOT EXISTS liberada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS liberada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.matriz_tarefas DROP CONSTRAINT IF EXISTS matriz_tarefas_status_check;
ALTER TABLE public.matriz_tarefas
  ADD CONSTRAINT matriz_tarefas_status_check CHECK (status IN ('rascunho','aberta','encerrada'));

-- ── 2. Tarefa nasce em rascunho ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_matriz_tarefa(
  p_competicao_id uuid,
  p_tipo          text,
  p_nome          text,
  p_descricao     text,
  p_data          date,
  p_participantes jsonb,
  p_origem        text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_role   text;
  v_filial text;
  v_cons   boolean;
  v_tarefa uuid;
  v_p      jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro INTO v_role, v_filial, v_cons
    FROM user_profiles WHERE id = v_user;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role IN ('admin','ceo','conselheiro') OR (v_role='gerente' AND COALESCE(v_cons,false)))
  THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro da Matriz cria tarefa' USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN (
    'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
    'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica'
  ) THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competicoes_matriz
    WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  -- Nasce fechada pra nota: evita conselheiro avaliar enquanto a pauta
  -- e a lista de participantes ainda estão sendo montadas.
  INSERT INTO matriz_tarefas (competicao_id, tipo, nome, descricao, data, criado_por, origem, status)
  VALUES (p_competicao_id, p_tipo, p_nome, NULLIF(p_descricao,''), p_data, v_user, NULLIF(p_origem,''), 'rascunho')
  RETURNING id INTO v_tarefa;

  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes,'[]'::jsonb))
  LOOP
    INSERT INTO matriz_tarefa_participantes (tarefa_id, funcionario_id, nome_snapshot, filial)
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

GRANT EXECUTE ON FUNCTION public.criar_matriz_tarefa(uuid,text,text,text,date,jsonb,text) TO authenticated;

-- ── 3. Liberar pra notas (+ aviso no sino do conselho) ────────────
CREATE OR REPLACE FUNCTION public.liberar_matriz_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_nome   text;
  v_n_part int;
BEGIN
  PERFORM _assert_matriz_admin();

  SELECT status, nome INTO v_status, v_nome
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

REVOKE ALL ON FUNCTION public.liberar_matriz_tarefa(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.liberar_matriz_tarefa(uuid) TO authenticated;

-- ── 4. Escrita de nota exige tarefa ABERTA ────────────────────────
CREATE OR REPLACE FUNCTION public.avaliar_item_matriz(
  p_competicao_id  uuid,
  p_filial_avaliada text,
  p_item_tipo      text,
  p_item_id        uuid,
  p_decisao        text DEFAULT NULL,
  p_nota           numeric DEFAULT NULL,
  p_comentario     text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_role        text;
  v_filial      text;
  v_is_cons     boolean;
  v_id          uuid;
  v_tstatus     text;
  v_filial_item text;
  v_comp_tarefa uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_is_cons
  FROM public.user_profiles WHERE id = v_user_id;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role = 'ceo' OR v_role = 'conselheiro' OR (v_role = 'gerente' AND COALESCE(v_is_cons, false)))
  THEN
    RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competicoes_matriz
    WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  v_filial_item := p_filial_avaliada;

  IF p_item_tipo LIKE 'tarefa\_%' THEN
    SELECT t.status, p.filial, t.competicao_id
      INTO v_tstatus, v_filial_item, v_comp_tarefa
      FROM public.matriz_tarefa_participantes p
      JOIN public.matriz_tarefas t ON t.id = p.tarefa_id
     WHERE p.id = p_item_id AND p.ativo = true AND t.ativo = true;

    IF v_tstatus IS NULL THEN
      RAISE EXCEPTION 'Participante ou tarefa não encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF v_comp_tarefa IS DISTINCT FROM p_competicao_id THEN
      RAISE EXCEPTION 'Participante não pertence a esta competição' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus = 'rascunho' THEN
      RAISE EXCEPTION 'Tarefa ainda não liberada para notas' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus <> 'aberta' THEN
      RAISE EXCEPTION 'Tarefa encerrada — reabra pra alterar notas' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.avaliacoes_matriz (
    competicao_id, filial_avaliada, item_tipo, item_id,
    avaliador_id, decisao, nota, comentario
  )
  VALUES (
    p_competicao_id, v_filial_item, p_item_tipo, p_item_id,
    v_user_id, p_decisao, p_nota, p_comentario
  )
  ON CONFLICT (competicao_id, item_tipo, item_id, avaliador_id)
    WHERE ativo = true
  DO UPDATE SET
    filial_avaliada = EXCLUDED.filial_avaliada,
    decisao         = EXCLUDED.decisao,
    nota            = EXCLUDED.nota,
    comentario      = EXCLUDED.comentario,
    updated_at      = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.avaliar_item_matriz(uuid,text,text,uuid,text,numeric,text) FROM public;
GRANT EXECUTE ON FUNCTION public.avaliar_item_matriz(uuid,text,text,uuid,text,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remover_avaliacao_matriz(
  p_competicao_id uuid,
  p_item_tipo     text,
  p_item_id       uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_role     text;
  v_filial   text;
  v_is_cons  boolean;
  v_tstatus  text;
  v_afetadas int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_is_cons
    FROM public.user_profiles WHERE id = v_user_id;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role = 'ceo' OR v_role = 'conselheiro'
             OR (v_role = 'gerente' AND COALESCE(v_is_cons, false)))
  THEN
    RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competicoes_matriz
     WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  IF p_item_tipo LIKE 'tarefa\_%' THEN
    SELECT t.status INTO v_tstatus
      FROM public.matriz_tarefa_participantes p
      JOIN public.matriz_tarefas t ON t.id = p.tarefa_id
     WHERE p.id = p_item_id AND p.ativo = true AND t.ativo = true;
    IF v_tstatus IS NULL THEN
      RAISE EXCEPTION 'Participante ou tarefa não encontrado' USING ERRCODE = 'P0001';
    END IF;
    IF v_tstatus <> 'aberta' THEN
      RAISE EXCEPTION 'Tarefa não está liberada para notas' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.avaliacoes_matriz
     SET ativo = false, updated_at = now()
   WHERE competicao_id = p_competicao_id
     AND item_tipo     = p_item_tipo
     AND item_id       = p_item_id
     AND avaliador_id  = v_user_id
     AND ativo         = true;

  GET DIAGNOSTICS v_afetadas = ROW_COUNT;
  IF v_afetadas = 0 THEN
    RAISE EXCEPTION 'Você não tem avaliação registrada neste item' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remover_avaliacao_matriz(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remover_avaliacao_matriz(uuid, text, uuid) TO authenticated;

-- ── 5. Voto selado (RLS de leitura) ───────────────────────────────
DROP POLICY IF EXISTS aval_matriz_select ON public.avaliacoes_matriz;
CREATE POLICY aval_matriz_select ON public.avaliacoes_matriz
  FOR SELECT USING (
    -- admin da Matriz: modera e audita, não vota — sem viés a proteger
    EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid() AND filial = 'Matriz' AND role = 'admin'
    )
    -- a própria avaliação, sempre
    OR avaliador_id = auth.uid()
    -- conselho: linha alheia só depois da tarefa encerrada
    OR (
      EXISTS (
        SELECT 1 FROM public.user_profiles
         WHERE id = auth.uid() AND filial = 'Matriz'
           AND (role IN ('ceo','conselheiro') OR (role = 'gerente' AND is_conselheiro = true))
      )
      AND (
        item_tipo NOT LIKE 'tarefa\_%'
        OR EXISTS (
          SELECT 1
            FROM public.matriz_tarefa_participantes p
            JOIN public.matriz_tarefas t ON t.id = p.tarefa_id
           WHERE p.id = avaliacoes_matriz.item_id
             AND t.status = 'encerrada'
        )
      )
    )
  );

-- ── 6. Progresso sem vazar nota ───────────────────────────────────
-- "Quem já avaliou" precisa contar as notas dos OUTROS, o que a RLS
-- acima (corretamente) esconde. Esta RPC devolve só participação —
-- quantas notas cada eleitor deu — sem valor nenhum.
CREATE OR REPLACE FUNCTION public.progresso_avaliacao_matriz(p_competicao_id uuid)
RETURNS TABLE (avaliador_id uuid, nome text, role text, notas_dadas int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  SELECT up.role INTO v_role
    FROM user_profiles up
   WHERE up.id = auth.uid() AND up.filial = 'Matriz'
     AND (up.role IN ('admin','ceo','conselheiro') OR (up.role = 'gerente' AND up.is_conselheiro = true));
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Apenas a Matriz vê o progresso da avaliação' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT up.id,
         up.nome,
         up.role,
         COALESCE(COUNT(am.id) FILTER (WHERE am.nota IS NOT NULL), 0)::int
    FROM user_profiles up
    LEFT JOIN avaliacoes_matriz am
           ON am.avaliador_id  = up.id
          AND am.competicao_id = p_competicao_id
          AND am.ativo         = true
          AND am.item_tipo LIKE 'tarefa\_%'
   WHERE up.filial = 'Matriz'
     AND (up.role IN ('ceo','conselheiro') OR (up.role = 'gerente' AND up.is_conselheiro = true))
   GROUP BY up.id, up.nome, up.role
   ORDER BY up.nome;
END;
$$;

REVOKE ALL ON FUNCTION public.progresso_avaliacao_matriz(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.progresso_avaliacao_matriz(uuid) TO authenticated;

-- ── 7. Lembrete de prazo (cron diário) ────────────────────────────
CREATE OR REPLACE FUNCTION public.lembrar_avaliacoes_pendentes()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_hoje      date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  v_comp      record;
  v_pendentes int;
  v_dias      int;
  v_avisos    int := 0;
BEGIN
  FOR v_comp IN
    SELECT id, nome, data_fim FROM competicoes_matriz
     WHERE ativo = true AND status = 'em_andamento'
       AND data_fim - v_hoje BETWEEN 0 AND 3
  LOOP
    -- Participante de tarefa aberta que ainda não recebeu nota de
    -- TODOS os eleitores conta como pendência.
    SELECT COUNT(*) INTO v_pendentes
      FROM matriz_tarefa_participantes p
      JOIN matriz_tarefas t ON t.id = p.tarefa_id
     WHERE t.competicao_id = v_comp.id
       AND t.ativo = true AND p.ativo = true
       AND t.status = 'aberta'
       AND (
         SELECT COUNT(*) FROM avaliacoes_matriz am
          WHERE am.item_id = p.id AND am.ativo = true AND am.nota IS NOT NULL
       ) < (
         SELECT COUNT(*) FROM user_profiles up
          WHERE up.filial = 'Matriz'
            AND (up.role IN ('ceo','conselheiro') OR (up.role = 'gerente' AND up.is_conselheiro = true))
       );

    CONTINUE WHEN v_pendentes = 0;

    -- 1 aviso por competição por dia.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM notificacoes
       WHERE ref_id = v_comp.id AND motivo = 'lembrete_avaliacao'
         AND (created_at AT TIME ZONE 'America/Rio_Branco')::date = v_hoje
    );

    v_dias := v_comp.data_fim - v_hoje;
    INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, ref_id, motivo, filial)
    VALUES (
      'all', 'info',
      'Avaliações pendentes',
      format('%s participante(s) ainda sem nota de todo o conselho. "%s" encerra %s.',
             v_pendentes, v_comp.nome,
             CASE WHEN v_dias = 0 THEN 'hoje'
                  WHEN v_dias = 1 THEN 'amanhã'
                  ELSE 'em ' || v_dias || ' dias' END),
      'matriz-avaliacoes', 'Alta', v_comp.id, 'lembrete_avaliacao', 'Matriz'
    );
    v_avisos := v_avisos + 1;
  END LOOP;

  RETURN jsonb_build_object('avisos', v_avisos);
END;
$$;

REVOKE ALL ON FUNCTION public.lembrar_avaliacoes_pendentes() FROM public;
GRANT EXECUTE ON FUNCTION public.lembrar_avaliacoes_pendentes() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
