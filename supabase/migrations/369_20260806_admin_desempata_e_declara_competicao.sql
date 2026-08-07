-- =================================================================
-- 369 — Admin desempata a votação e é quem declara a vencedora
--
-- Duas mudanças na mesma régua: o que o admin pode fazer no fecho da
-- Competição do Conselho.
--
-- (A) DESEMPATE
--
-- Buraco: o conselho vota "aceita" ou "rejeita" o placar, e o quórum é
-- maioria simples. Com número PAR de eleitores — hoje 1 CEO + 3
-- conselheiros — dá empate: 2×2 e a competição trava. Ninguém tinha
-- poder de desempate, e a RLS `voto_write` recusa admin nominalmente.
--
-- Regra: em empate, e só em empate, o admin da Matriz registra um voto.
-- É voto de minerva — entra na contagem como qualquer outro e resolve o
-- 2×2 em 3×2. Fora do empate o admin continua sem votar: ele modera a
-- competição, não participa do julgamento.
--
-- O empate é medido SÓ entre os eleitores do conselho, nunca contando o
-- voto do próprio admin. Se contasse, o voto dele desfaria o empate e a
-- policy passaria a recusar o UPDATE dele mesmo — ele não conseguiria
-- corrigir o próprio voto.
--
-- (B) DECLARAÇÃO DA VENCEDORA
--
-- Era `auth_is_admin() OR conselheiro OR gerente-conselheiro` — ou seja,
-- qualquer eleitor fechava a competição, inclusive quem acabara de votar
-- vencido. Passa a ser role = 'admin', e só. Quem julga é o conselho;
-- quem homologa o julgamento é a Administração.
--
-- `auth_is_admin()` não serve para isso: ela é ampla e devolve true para
-- CEO e conselheiro. O gate tem que olhar a role nominalmente.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. "Esta competição está empatada?" ───────────────────────────
CREATE OR REPLACE FUNCTION public._competicao_empatada(p_competicao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH conselho AS (
    SELECT v.voto
      FROM public.competicao_votos v
      JOIN public.user_profiles up ON up.id = v.votante_id
     WHERE v.competicao_id = p_competicao_id
       AND up.filial = 'Matriz'
       AND (up.role IN ('ceo','conselheiro')
            OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro,false)))
  )
  SELECT
    -- Empate só existe depois de todo o conselho votar. Antes disso, 1×1
    -- com dois votos por vir não é empate, é votação pela metade.
    COUNT(*) = public.contar_votantes_matriz()
    AND COUNT(*) FILTER (WHERE voto = 'aceita')
      = COUNT(*) FILTER (WHERE voto = 'rejeita')
    AND COUNT(*) > 0
  FROM conselho;
$$;

COMMENT ON FUNCTION public._competicao_empatada(uuid) IS
  'True quando todo o conselho votou e aceita = rejeita. Ignora o voto do admin de proposito: o desempate nao pode se anular.';

-- Função nova nasce com EXECUTE para PUBLIC; revogar `anon` nominalmente
-- é obrigatório (ver migr. 347).
REVOKE ALL ON FUNCTION public._competicao_empatada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._competicao_empatada(uuid) TO authenticated;

-- ── 2. RLS: admin entra na votação só no empate ───────────────────
-- `auth_user_role() = 'admin'` e não `auth_is_admin()`: o segundo inclui
-- conselheiro e gerente-conselheiro, que já votam pela régua normal.
DROP POLICY IF EXISTS voto_write ON public.competicao_votos;
CREATE POLICY voto_write ON public.competicao_votos
  FOR INSERT TO authenticated
  WITH CHECK (
    votante_id = auth.uid()
    AND (
      auth_user_role() = ANY (ARRAY['ceo','conselheiro'])
      OR (auth_user_role() = 'gerente' AND EXISTS (
            SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_conselheiro = true))
      OR (auth_user_role() = 'admin'
          AND public._competicao_empatada(competicao_id))
    )
  );

DROP POLICY IF EXISTS voto_update ON public.competicao_votos;
CREATE POLICY voto_update ON public.competicao_votos
  FOR UPDATE TO authenticated
  USING (
    votante_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.competicoes_matriz c
       WHERE c.id = competicao_votos.competicao_id
         AND c.status = 'aguardando_encerramento'
    )
  )
  WITH CHECK (
    votante_id = auth.uid()
    AND (
      auth_user_role() = ANY (ARRAY['ceo','conselheiro'])
      OR (auth_user_role() = 'gerente' AND EXISTS (
            SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid() AND is_conselheiro = true))
      OR (auth_user_role() = 'admin'
          AND public._competicao_empatada(competicao_id))
    )
  );

-- ── 3. Declarar vencedora vira exclusividade do admin ─────────────
-- Corpo copiado do estado vigente no banco; só o gate muda.
CREATE OR REPLACE FUNCTION public.declarar_vencedora(
  p_competicao_id uuid,
  p_vencedora     text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp     competicoes_matriz;
  v_snapshot jsonb;
  v_votos    int;
BEGIN
  -- Quem julga é o conselho; quem homologa é a Administração. `auth_is_admin()`
  -- não serve aqui: devolve true para CEO e conselheiro também.
  IF auth_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas a Administração declara a vencedora'
      USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.declarar_vencedora(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declarar_vencedora(uuid,text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
