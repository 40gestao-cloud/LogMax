-- =================================================================
-- 344 — avaliar_item_matriz deixa de confiar no cliente para decidir
--       QUAL filial recebe a nota.
--
-- Furo fechado (auditoria do placar, 2026-08-04):
--   `filial_avaliada` era gravada direto de `p_filial_avaliada`, um
--   parâmetro que vem do navegador. O placar do Top 3 agrupa por essa
--   coluna. Ou seja: um conselheiro com o F12 aberto podia dar nota a
--   um participante da TechMax mandando p_filial_avaliada='SuperMax'
--   e inflar a média da filial que quisesse — sem nenhuma pista na UI,
--   já que a tela sempre manda a filial certa.
--
--   Segundo furo: nada amarrava o participante à competição. p_item_id
--   e p_competicao_id eram independentes, então dava pra lançar nota de
--   participante de uma competição antiga dentro da competição atual.
--
-- Dados: auditados nas turmas antes desta migração — 0 linhas com
--   filial divergente e 0 notas cruzadas entre competições. O furo
--   estava aberto mas não foi usado; nada a corrigir no histórico.
--
-- Correção (só para item_tipo 'tarefa_%', que é o que pesa no placar):
--   • filial_avaliada passa a ser LIDA do participante no banco;
--     p_filial_avaliada é ignorado nesses tipos.
--   • valida que a tarefa do participante pertence a p_competicao_id.
--   Demais tipos (arte/promoção/campanha/etc.) seguem usando o
--   parâmetro — não entram no cálculo do Top 3.
--
-- Assinatura idêntica à da migr. 246 → CREATE OR REPLACE substitui a
-- função no lugar, sem DROP e sem risco de sobrecarga duplicada.
-- Idempotente.
-- =================================================================

BEGIN;

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
  v_filial      text;      -- filial do AVALIADOR (tem que ser Matriz)
  v_is_cons     boolean;
  v_id          uuid;
  v_tstatus     text;
  v_filial_item text;      -- filial do AVALIADO, lida do banco
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

  -- Tarefa da Matriz: filial e competição vêm do banco, não do cliente.
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
    IF v_tstatus = 'encerrada' THEN
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

COMMIT;

NOTIFY pgrst, 'reload schema';
