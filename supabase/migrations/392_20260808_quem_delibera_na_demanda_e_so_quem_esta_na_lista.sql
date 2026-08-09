-- =================================================================
-- 392 — Quem delibera na demanda do Padrão é só quem está na lista
--
-- Sintoma: uma demanda criada para o professor avaliar CEO e Conselho
-- aparecia cobrando nota DELES. Ninguém pediu isso.
--
-- Causa: a 368 trouxe a lista de avaliadores por demanda, mas manteve um
-- ramo de compatibilidade — demanda SEM lista continua valendo a régua
-- antiga, "CEO e conselheiros dão nota, admin fora". Toda demanda anterior
-- à 368 cai nesse ramo, e é o ramo que ignora a vontade de quem monta a
-- pauta. O resultado é o oposto do que a 368 queria: o professor escolhe
-- os avaliadores e, se a lista estiver vazia, o sistema escolhe por ele.
--
-- Decisão: o ramo legado sai. Sem lista, ninguém dá nota — e liberar exige
-- lista, então "sem lista" deixa de ser um estado que chega ao aluno.
-- Deliberar vira ato designado, nunca presumido: há demanda em que o
-- Conselho julga e há demanda em que ele é julgado, e só quem publica a
-- pauta sabe qual é qual.
--
-- Verificado antes de tirar a compatibilidade (2026-08-08, nos 4 projetos):
-- 1 demanda no total, em rascunho, e ZERO notas em `ciclo_tarefa_avaliacoes`.
-- O ramo legado não protege nota nenhuma — não há o que preservar.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Guard da nota: lista, e só ─────────────────────────────────
-- Cópia da versão vigente (368, md5 7233bb9d… nos 4 projetos) sem o ELSE
-- legado.
CREATE OR REPLACE FUNCTION public._assert_pode_avaliar_ciclo_tarefa(p_participante_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_filial text;
  v_tarefa uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT filial INTO v_filial FROM user_profiles WHERE id = auth.uid();

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

  -- `COALESCE(..., false)`: guard que testa NOT de expressão NULL não
  -- barra ninguém — o IF simplesmente não dispara.
  IF NOT COALESCE((
    SELECT true FROM ciclo_tarefa_avaliadores
     WHERE tarefa_id = v_tarefa AND user_profile_id = auth.uid() AND ativo = true
  ), false) THEN
    RAISE EXCEPTION 'Você não foi designado para dar nota nesta demanda'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_pode_avaliar_ciclo_tarefa(uuid) FROM public, anon;

-- ── 2. Liberar exige avaliador, e o aviso diz quem é ──────────────
-- Cópia da 361 (md5 fda149cf… nos 4 projetos) com duas mudanças: a
-- exigência de lista e o texto do aviso.
--
-- O aviso dizia "N participante(s) aguardando o conselho" para a Matriz
-- inteira. Com avaliador por demanda isso é falso metade das vezes — e é
-- justamente a frase que fazia CEO e conselheiro entenderem que tinham de
-- deliberar numa demanda em que eram os avaliados.
CREATE OR REPLACE FUNCTION public.liberar_ciclo_tarefa(p_tarefa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text; v_nome text; v_n_part int; v_n_aval int; v_quem text;
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

  -- Sem avaliador designado a demanda nasce sem quem a julgue: participante
  -- cobrado por ninguém, e nota que nunca chega.
  SELECT COUNT(*), string_agg(up.nome, ', ' ORDER BY up.nome)
    INTO v_n_aval, v_quem
    FROM ciclo_tarefa_avaliadores a
    JOIN user_profiles up ON up.id = a.user_profile_id
   WHERE a.tarefa_id = p_tarefa_id AND a.ativo = true;
  IF COALESCE(v_n_aval, 0) = 0 THEN
    RAISE EXCEPTION 'Defina quem dá nota nesta demanda antes de liberar'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE ciclo_tarefas
     SET status = 'aberta', liberada_em = now(), liberada_por = auth.uid()
   WHERE id = p_tarefa_id;

  -- Aviso pra Matriz, nomeando quem de fato delibera.
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  VALUES (
    'all', 'info',
    'Demanda do ciclo liberada',
    format('"%s" está liberada — %s participante(s) aguardando nota de: %s.', v_nome, v_n_part, v_quem),
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

COMMIT;
