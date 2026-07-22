-- =================================================================
-- Simplificação profunda do placar de Competição entre Filiais.
--
-- Antes: 7 dimensões (marketing/vendas/compras/rh/cadastros/financeiro/matriz)
-- com pesos configuráveis, ranking 3-2-1 × peso. Como "Dados das Filiais" foi
-- retirado da Central, 6 dimensões nunca recebem julgamento — só `matriz`
-- (Tarefas da Matriz) pontua. Sistema todo virou peso morto.
--
-- Depois: placar = média × 10 das notas do conselho em Tarefas da Matriz por
-- filial (do participante). Sem pesos, sem ranking 3-2-1. Pura média. Pódio
-- ordena as 3 filiais direto pela média.
--
-- Impacto:
--   - Drop `atualizar_pesos_competicao(uuid, jsonb)`
--   - `criar_competicao(text, date, date)` — sem `p_pesos`. Preenche a coluna
--     `pesos` com `{"matriz": 100}` só pra satisfazer NOT NULL histórico.
--   - `calcular_placar_competicao(uuid)` retorna forma nova:
--     { competicao, por_filial: { SuperMax:{media,n}, MaxLook:{...}, TechMax:{...} } }
--   - Coluna `pesos` fica no schema (histórico + placar_snapshot antigos íntegros)
--     mas some da UI.
-- =================================================================

BEGIN;

-- 1. Remove RPC de atualização de pesos ─────────────────────────────
DROP FUNCTION IF EXISTS public.atualizar_pesos_competicao(uuid, jsonb);

-- 2. criar_competicao — sem p_pesos ─────────────────────────────────
-- Antes: p_pesos jsonb obrigatório, validação de soma=100.
-- Depois: preenche pesos='{"matriz":100}' internamente pra preservar NOT NULL
-- da coluna (schema histórico).
DROP FUNCTION IF EXISTS public.criar_competicao(text, date, date, jsonb);

CREATE OR REPLACE FUNCTION public.criar_competicao(
  p_nome        text,
  p_data_inicio date,
  p_data_fim    date
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT auth_is_admin() THEN
    RAISE EXCEPTION 'Apenas admin/CEO cria competição' USING ERRCODE = '42501';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'Data fim anterior ao início' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competicoes_matriz (nome, data_inicio, data_fim, pesos, criado_por)
  VALUES (p_nome, p_data_inicio, p_data_fim, '{"matriz": 100}'::jsonb, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe competição em andamento — encerre a atual antes'
      USING ERRCODE = 'P0001';
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_competicao(text, date, date) TO authenticated;

-- 3. calcular_placar_competicao — só por_filial ─────────────────────
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp   competicoes_matriz;
  v_result jsonb;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial
  ),
  notas AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo LIKE 'tarefa\_%'), 0) AS media,
      COALESCE((SELECT COUNT(*)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo LIKE 'tarefa\_%'), 0) AS n
    FROM filiais f
  )
  SELECT jsonb_object_agg(filial, jsonb_build_object('media', media, 'n', n))
    INTO v_result
    FROM notas;

  RETURN jsonb_build_object(
    'competicao', jsonb_build_object(
      'id', v_comp.id, 'nome', v_comp.nome,
      'data_inicio', v_comp.data_inicio, 'data_fim', v_comp.data_fim,
      'status', v_comp.status, 'vencedora', v_comp.vencedora
    ),
    'por_filial', COALESCE(v_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
