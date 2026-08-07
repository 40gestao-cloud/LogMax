-- =================================================================
-- 365 — Contador do conselho para de mostrar "46/40".
--
-- A 364 tirou o desligado do placar e o front tirou do DENOMINADOR
-- ("participantes avaliáveis"). O NUMERADOR continuou vindo de
-- `progresso_avaliacao_matriz`, que conta toda nota de tarefa do
-- avaliador — inclusive as dadas em quem foi desligado depois. Resultado
-- na tela: 46 notas dadas de 40 possíveis, que faz o conselheiro achar
-- que avaliou mais gente do que existe.
--
-- Medido no LogMax-ERP: Bismarck 46→40, kevila 46→40, Yan 22→19,
-- Supervisão 18→17. Zero notas órfãs e zero em participante removido —
-- o desligado era a única fonte da diferença.
--
-- Correção sem apagar nada. A alternativa seria soft-deletar as 16 notas
-- dos desligados, mas elas são o registro de que o conselho avaliou
-- aquelas pessoas ENQUANTO ainda estavam na filial, já não afetam o
-- placar (364), e apagá-las quebraria a volta caso um desligamento seja
-- desfeito. Aqui, desfazer o desligamento devolve tudo sozinho.
--
-- O JOIN com participantes também alinha dois casos que hoje não
-- ocorrem mas inflariam o mesmo contador: nota órfã (item_id sem
-- participante) e nota em participante removido da tarefa. O
-- denominador do front conta participante ativo — o numerador passa a
-- contar sobre a mesma base.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.progresso_avaliacao_matriz(p_competicao_id uuid)
RETURNS TABLE (avaliador_id uuid, nome text, role text, notas_dadas int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  SELECT up.role INTO v_role
    FROM user_profiles up
   WHERE up.id = auth.uid() AND up.filial = 'Matriz'
     AND (up.role IN ('admin','ceo','conselheiro') OR (up.role = 'gerente' AND up.is_conselheiro = true));
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Apenas a Matriz vê o progresso da avaliação' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT up.id,
         up.nome,
         up.role,
         (SELECT COUNT(*)::int
            FROM avaliacoes_matriz am
            -- INNER de propósito: nota sem participante não tem par no
            -- denominador, então não pode entrar no numerador.
            JOIN matriz_tarefa_participantes p ON p.id = am.item_id
           WHERE am.avaliador_id  = up.id
             AND am.competicao_id = p_competicao_id
             AND am.ativo         = true
             AND am.nota IS NOT NULL
             AND am.item_tipo LIKE 'tarefa\_%'
             AND p.ativo = true
             -- COALESCE: funcionario_id NULL devolveria NULL e a nota
             -- sumiria da contagem em vez de contar.
             AND NOT COALESCE(public._funcionario_desligado(p.funcionario_id), false)
         )
    FROM user_profiles up
   WHERE up.filial = 'Matriz'
     AND (up.role IN ('ceo','conselheiro') OR (up.role = 'gerente' AND up.is_conselheiro = true))
   ORDER BY up.nome;
END;
$$;

REVOKE ALL ON FUNCTION public.progresso_avaliacao_matriz(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.progresso_avaliacao_matriz(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
