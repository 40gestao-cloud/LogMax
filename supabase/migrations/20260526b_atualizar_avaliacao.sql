-- =================================================================
-- Avaliações: RPC `atualizar_avaliacao` — corrige notas e observação
-- de uma avaliação já criada.
--
-- Regras:
--   - admin/CEO podem editar QUALQUER avaliação (correção gerencial).
--   - gerente/colaborador só editam AS PRÓPRIAS (avaliador_id = auth.uid()).
--   - Só permitido enquanto o ciclo está 'Aberto'. Ciclo 'Fechado' congela.
--   - Transacional: troca observação + recria critérios do zero numa
--     única transação (DELETE + N INSERTs).
--
-- SECURITY DEFINER porque criterios_avaliacao não tem policy UPDATE/DELETE
-- (RLS atual só libera INSERT pelo avaliador). A função faz toda a
-- autorização manualmente via auth.uid() + user_profiles.role.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION atualizar_avaliacao(
  p_avaliacao_id uuid,
  p_observacao   text,
  p_criterios    jsonb  -- [{categoria, criterio, nota}, ...]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid;
  v_user_role    text;
  v_avaliador_id uuid;
  v_ciclo_id     uuid;
  v_ciclo_status text;
  v_criterio     jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT role INTO v_user_role FROM user_profiles WHERE id = v_user_id;
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Perfil de usuário não encontrado';
  END IF;

  SELECT avaliador_id, ciclo_id INTO v_avaliador_id, v_ciclo_id
    FROM avaliacoes WHERE id = p_avaliacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliação não encontrada';
  END IF;

  -- Autorização: admin/CEO podem qualquer; demais só as próprias.
  IF v_user_role NOT IN ('admin', 'ceo') AND v_avaliador_id <> v_user_id THEN
    RAISE EXCEPTION 'Sem permissão pra editar esta avaliação';
  END IF;

  -- Ciclo precisa estar aberto.
  SELECT status INTO v_ciclo_status FROM ciclos_avaliacao WHERE id = v_ciclo_id;
  IF v_ciclo_status <> 'Aberto' THEN
    RAISE EXCEPTION 'Ciclo fechado — edição não permitida';
  END IF;

  -- Atualiza observação.
  UPDATE avaliacoes SET observacao = p_observacao WHERE id = p_avaliacao_id;

  -- Sobrescreve critérios (DELETE + INSERT garante consistência com a
  -- estrutura enviada, sem precisar fazer diff campo a campo).
  DELETE FROM criterios_avaliacao WHERE avaliacao_id = p_avaliacao_id;
  FOR v_criterio IN SELECT * FROM jsonb_array_elements(p_criterios) LOOP
    INSERT INTO criterios_avaliacao (avaliacao_id, categoria, criterio, nota)
    VALUES (
      p_avaliacao_id,
      v_criterio->>'categoria',
      v_criterio->>'criterio',
      (v_criterio->>'nota')::smallint
    );
  END LOOP;

  RETURN p_avaliacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION atualizar_avaliacao(uuid, text, jsonb) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como gerente que avaliou colaborador X:
--   SELECT atualizar_avaliacao(
--     '<id-da-avaliacao>',
--     'Observação corrigida',
--     '[{"categoria":"tecnica","criterio":"Domínio técnico","nota":4}, ...]'::jsonb
--   );
--   -- como gerente tentando editar avaliação de outro gerente:
--   -- → ERROR: Sem permissão pra editar esta avaliação
--   -- ciclo fechado:
--   -- → ERROR: Ciclo fechado — edição não permitida
-- =================================================================
