-- =================================================================
-- Avaliações: `criar_avaliacao` passa a bloquear ciclo fechado.
--
-- Contexto:
--   A RPC original (20260516_avaliacoes.sql) insere em `avaliacoes`
--   sem checar o status do ciclo. O frontend só mostra "A Fazer" no
--   ciclo aberto, então o caminho normal não bate aqui — mas qualquer
--   chamada manual à RPC com `p_ciclo_id` de ciclo fechado passa.
--
--   Operação precisa que ciclo fechado = imutável (mesma semântica
--   que `atualizar_avaliacao` já implementa em 20260526b).
--
-- Mudança:
--   - Antes do INSERT, lê `ciclos_avaliacao.status` e levanta
--     exceção se != 'Aberto'.
--   - Resto da função idêntico ao original (mesmo INSERT + loop
--     em jsonb_array_elements).
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION criar_avaliacao(
  p_ciclo_id     uuid,
  p_avaliado_id  uuid,
  p_tipo         text,
  p_observacao   text,
  p_criterios    jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER  -- mantém RLS do avaliador (auth.uid())
SET search_path = public
AS $$
DECLARE
  v_avaliacao_id uuid;
  v_criterio     jsonb;
  v_ciclo_status text;
BEGIN
  -- Bloqueia inserts em ciclo não-Aberto. NULL = ciclo inexistente.
  SELECT status INTO v_ciclo_status
    FROM ciclos_avaliacao WHERE id = p_ciclo_id;
  IF v_ciclo_status IS NULL THEN
    RAISE EXCEPTION 'Ciclo não encontrado';
  END IF;
  IF v_ciclo_status <> 'Aberto' THEN
    RAISE EXCEPTION 'Ciclo fechado — não aceita novas avaliações';
  END IF;

  -- Insere a avaliação (RLS exige avaliador_id = auth.uid())
  INSERT INTO avaliacoes (ciclo_id, avaliador_id, avaliado_id, tipo, observacao)
  VALUES (p_ciclo_id, auth.uid(), p_avaliado_id, p_tipo, p_observacao)
  RETURNING id INTO v_avaliacao_id;

  -- Insere todos os critérios
  FOR v_criterio IN SELECT * FROM jsonb_array_elements(p_criterios) LOOP
    INSERT INTO criterios_avaliacao (avaliacao_id, categoria, criterio, nota)
    VALUES (
      v_avaliacao_id,
      v_criterio->>'categoria',
      v_criterio->>'criterio',
      (v_criterio->>'nota')::smallint
    );
  END LOOP;

  RETURN v_avaliacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION criar_avaliacao(uuid, uuid, text, text, jsonb) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Como usuário autenticado, com ciclo X fechado:
--   SELECT criar_avaliacao('<ciclo-fechado-id>', '<avaliado>', 'ceo_gerente',
--                          'obs', '[]'::jsonb);
--   -- → ERROR: Ciclo fechado — não aceita novas avaliações
-- =================================================================
