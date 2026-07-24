-- ─────────────────────────────────────────────────────────────────────
-- MaxAI Briefing na Competição de Conselho
-- ─────────────────────────────────────────────────────────────────────
-- Admin/CEO abre uma tarefa (ex: Apresentação Profissional) e pede pra
-- IA propor sub-tarefas nos outros 6 tipos que ajudem a alcançar a
-- tarefa principal. Ao aprovar cada sugestão, criar_matriz_tarefa é
-- chamada com p_origem='briefing_ia' pra rastrear a origem.
--
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────

-- Coluna de rastreio: NULL = criada manualmente; 'briefing_ia' = veio
-- de sugestão aprovada da IA. Aberta a mais valores no futuro (não
-- constrain enum, pra não travar migrações).
ALTER TABLE public.matriz_tarefas
  ADD COLUMN IF NOT EXISTS origem text;

CREATE INDEX IF NOT EXISTS matriz_tarefas_origem_idx
  ON public.matriz_tarefas (origem)
  WHERE origem IS NOT NULL;

-- Estende criar_matriz_tarefa aceitando origem opcional.
-- Corpo idêntico ao 226, só adiciona p_origem + insere na coluna.
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
     OR NOT (v_role IN ('admin','ceo','conselheiro') OR (v_role='gerente' AND v_cons))
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

  INSERT INTO matriz_tarefas (competicao_id, tipo, nome, descricao, data, criado_por, origem)
  VALUES (p_competicao_id, p_tipo, p_nome, NULLIF(p_descricao,''), p_data, v_user, NULLIF(p_origem,''))
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

GRANT EXECUTE ON FUNCTION public.criar_matriz_tarefa(uuid, text, text, text, date, jsonb, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
