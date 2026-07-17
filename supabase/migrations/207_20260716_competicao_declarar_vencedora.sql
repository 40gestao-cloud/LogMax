-- =================================================================
-- Fase 2 — Encerramento de competição inter-filiais.
--
-- Contexto:
--   Fase 1 abriu competições e calcula o placar em tempo real. Fase 2
--   fecha o ciclo: análise IA (via /api/ai-competicao) grava
--   competicoes_matriz.analise_ia, votação usa competicao_votos, e
--   esta RPC encerra formalmente.
--
-- Regras da RPC declarar_vencedora:
--   - Só admin/CEO/conselheiro (mesma pool de eleitores).
--   - Competição precisa estar em 'aguardando_encerramento' ou
--     'em_andamento' (permite encerrar antecipado se admin quiser).
--   - Precisa de pelo menos 1 voto registrado (sanity).
--   - Congela placar via calcular_placar_competicao pra placar_snapshot.
--   - Marca status='encerrada' e grava vencedora.
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.declarar_vencedora(
  p_competicao_id uuid,
  p_vencedora     text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp        competicoes_matriz;
  v_role        text := auth_user_role();
  v_conselheiro boolean;
  v_snapshot    jsonb;
  v_votos       int;
BEGIN
  -- Gate: mesmo grupo de eleitores.
  SELECT (is_conselheiro = true) INTO v_conselheiro
    FROM user_profiles WHERE id = auth.uid();
  IF NOT (auth_is_admin() OR v_role = 'conselheiro'
          OR (v_role = 'gerente' AND v_conselheiro = true)) THEN
    RAISE EXCEPTION 'Sem permissão para declarar vencedora' USING ERRCODE = '42501';
  END IF;

  IF p_vencedora NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Filial inválida: %', p_vencedora USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_comp FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.status = 'encerrada' THEN
    RAISE EXCEPTION 'Competição já encerrada' USING ERRCODE = 'P0001';
  END IF;

  -- Precisa ao menos 1 voto (sanity — impede encerrar sem qualquer discussão).
  SELECT COUNT(*) INTO v_votos FROM competicao_votos WHERE competicao_id = p_competicao_id;
  IF v_votos = 0 THEN
    RAISE EXCEPTION 'Nenhum voto registrado — colete ao menos 1 voto antes de declarar'
      USING ERRCODE = 'P0001';
  END IF;

  -- Congela placar do momento da declaração.
  v_snapshot := calcular_placar_competicao(p_competicao_id);

  UPDATE competicoes_matriz
     SET status          = 'encerrada',
         vencedora       = p_vencedora,
         placar_snapshot = v_snapshot,
         encerrada_por   = auth.uid(),
         updated_at      = now()
   WHERE id = p_competicao_id;

  RETURN jsonb_build_object(
    'competicao_id', p_competicao_id,
    'vencedora',     p_vencedora,
    'snapshot',      v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.declarar_vencedora(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.declarar_vencedora(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
