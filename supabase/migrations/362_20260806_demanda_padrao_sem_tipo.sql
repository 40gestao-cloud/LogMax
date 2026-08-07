-- =================================================================
-- 362 — Demanda do ciclo Padrão deixa de herdar os tipos da Competição
--
-- O que estava errado:
--   A 361 reaproveitou os 7 tipos da Competição do Conselho
--   (`tarefa_apresentacao`, `tarefa_rh`, `tarefa_marketing`…) no CHECK
--   de `ciclo_tarefas.tipo`. Na tela, criar demanda no Padrão abria um
--   select com a pauta da Competição — categoria que o ciclo Padrão não
--   usa e que só confunde quem publica. Padrão e Competição são trilhos
--   separados de propósito (a nota daqui não toca o placar); a régua de
--   tipos não devia ser compartilhada.
--
-- O que muda:
--   Entra o valor `demanda_padrao` no CHECK e no guard da RPC. A tela
--   passa a criar toda demanda do Padrão com esse tipo e some com o
--   select. Os 7 antigos continuam ACEITOS — demanda já criada não pode
--   virar linha inválida, e a listagem segue mostrando a categoria dela.
--   A Competição do Conselho (`matriz_tarefas`) não é tocada.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. CHECK do tipo aceita `demanda_padrao` ──────────────────────
-- O CHECK nasceu sem nome na 361, então o Postgres batizou de
-- `ciclo_tarefas_tipo_check`. Recriar com nome explícito para a próxima
-- migração não ter que adivinhar.
ALTER TABLE public.ciclo_tarefas
  DROP CONSTRAINT IF EXISTS ciclo_tarefas_tipo_check;
ALTER TABLE public.ciclo_tarefas
  DROP CONSTRAINT IF EXISTS ciclo_tarefas_tipo_valido;

ALTER TABLE public.ciclo_tarefas
  ADD CONSTRAINT ciclo_tarefas_tipo_valido CHECK (tipo IN (
    'demanda_padrao',
    -- Legado da 361: aceito para não invalidar demanda já publicada.
    'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
    'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica'
  ));

-- ── 2. RPC de criação: mesmo conjunto do CHECK ────────────────────
-- Assinatura idêntica à da 361 — CREATE OR REPLACE, sem DROP, para não
-- derrubar os GRANTs nem criar sobrecarga que o PostgREST recusaria.
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
    'demanda_padrao',
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

COMMIT;

NOTIFY pgrst, 'reload schema';
