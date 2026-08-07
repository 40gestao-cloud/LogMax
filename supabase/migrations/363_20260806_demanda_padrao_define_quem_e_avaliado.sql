-- =================================================================
-- 363 — A demanda do Padrão passa a definir QUEM é avaliado no ciclo
--
-- Dois buracos, mesma raiz — a demanda e a avaliação do ciclo Padrão não
-- se conhecem:
--
--   1. Abrir um ciclo Matriz já enchia a tela de pendências com TODA a
--      empresa, varrendo `user_profiles` por role. A pauta que a Matriz
--      publica não tinha voz nenhuma sobre isso.
--   2. O seletor de participantes da Nova Demanda só enxergava
--      `funcionarios` das 3 filiais operacionais — CEO e conselheiros,
--      que são da Matriz, não podiam ser postos numa demanda.
--
-- O que muda aqui (só o elo; a dinâmica de nota fica igual):
--   • `ciclo_tarefa_participantes.user_profile_id` — o participante passa
--     a apontar para quem loga e é avaliado, não só para a ficha de RH.
--     `funcionario_id` continua onde está, preenchido quando existe.
--   • `filial` aceita 'Matriz'.
--   • As RPCs de criar/atualizar leem `user_profile_id` do payload.
--   • Backfill: participante antigo herda o `user_profile_id` da ficha.
--
-- O que NÃO muda: `avaliacoes_matriz`, os tipos de avaliação, o placar,
-- o pódio e as RPCs de nota. O front só usa esta coluna para filtrar a
-- lista de pendências — nada é apagado nem recalculado.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Elo com quem é avaliado ────────────────────────────────────
ALTER TABLE public.ciclo_tarefa_participantes
  ADD COLUMN IF NOT EXISTS user_profile_id uuid
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Participante da Matriz (CEO, conselheiro) não tem por que passar pela
-- ficha de RH — o CHECK original só previa as 3 filiais operacionais.
ALTER TABLE public.ciclo_tarefa_participantes
  DROP CONSTRAINT IF EXISTS ciclo_tarefa_participantes_filial_check;
ALTER TABLE public.ciclo_tarefa_participantes
  DROP CONSTRAINT IF EXISTS ciclo_tarefa_part_filial_valida;
ALTER TABLE public.ciclo_tarefa_participantes
  ADD CONSTRAINT ciclo_tarefa_part_filial_valida
    CHECK (filial IN ('SuperMax','MaxLook','TechMax','Matriz'));

-- Partial UNIQUE separado: a mesma pessoa não entra 2× na mesma demanda.
-- Precisa de `WHERE ativo = true` senão o removido trava a re-inclusão,
-- mesma pegadinha do índice de `funcionario_id` na 361.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ciclo_tarefa_part_profile
  ON public.ciclo_tarefa_participantes (tarefa_id, user_profile_id)
  WHERE ativo = true AND user_profile_id IS NOT NULL;

-- Backfill: demanda já criada continua valendo para o filtro do roster.
UPDATE public.ciclo_tarefa_participantes p
   SET user_profile_id = f.user_profile_id
  FROM public.funcionarios f
 WHERE p.funcionario_id = f.id
   AND p.user_profile_id IS NULL
   AND f.user_profile_id IS NOT NULL;

-- ── 2. criar_ciclo_tarefa: aceita user_profile_id no payload ──────
-- Assinatura idêntica à da 361/362 — CREATE OR REPLACE, sem DROP.
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
    INSERT INTO ciclo_tarefa_participantes
      (tarefa_id, funcionario_id, user_profile_id, nome_snapshot, filial)
    VALUES (
      v_tarefa,
      NULLIF(v_p->>'funcionario_id','')::uuid,
      NULLIF(v_p->>'user_profile_id','')::uuid,
      COALESCE(v_p->>'nome',''),
      v_p->>'filial'
    );
  END LOOP;

  RETURN v_tarefa;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_ciclo_tarefa(uuid,text,text,text,date,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.criar_ciclo_tarefa(uuid,text,text,text,date,jsonb) TO authenticated;

-- ── 3. atualizar_ciclo_tarefa: casa por perfil, com fallback ──────
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
      v_prof uuid := NULLIF(v_p->>'user_profile_id','')::uuid;
      v_id   uuid;
    BEGIN
      -- Casa primeiro por perfil: é a identidade que o front manda agora.
      -- O ramo por funcionário fica para participante criado antes da 363,
      -- que pode ter ficha e não ter perfil.
      IF v_prof IS NOT NULL THEN
        UPDATE ciclo_tarefa_participantes
           SET ativo = true, nome_snapshot = COALESCE(v_p->>'nome', nome_snapshot),
               filial = v_p->>'filial',
               funcionario_id = COALESCE(v_func, funcionario_id)
         WHERE tarefa_id = p_tarefa_id AND user_profile_id = v_prof
         RETURNING id INTO v_id;
      END IF;

      IF v_id IS NULL AND v_func IS NOT NULL THEN
        UPDATE ciclo_tarefa_participantes
           SET ativo = true, nome_snapshot = COALESCE(v_p->>'nome', nome_snapshot),
               filial = v_p->>'filial',
               user_profile_id = COALESCE(v_prof, user_profile_id)
         WHERE tarefa_id = p_tarefa_id AND funcionario_id = v_func
         RETURNING id INTO v_id;
      END IF;

      IF v_id IS NULL THEN
        INSERT INTO ciclo_tarefa_participantes
          (tarefa_id, funcionario_id, user_profile_id, nome_snapshot, filial)
        VALUES (p_tarefa_id, v_func, v_prof, COALESCE(v_p->>'nome',''), v_p->>'filial')
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

COMMIT;

NOTIFY pgrst, 'reload schema';
