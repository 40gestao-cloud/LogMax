-- =================================================================
-- 346 — Filial volta a ver a média que seus participantes tiraram.
--
-- Regressão silenciosa desde a 234 (2026-07-22):
--   `DemandasView` (tela da filial) lê `avaliacoes_matriz_agregado`
--   pra mostrar a média por participante. Só que a 234 — corretamente —
--   fechou o SELECT de `avaliacoes_matriz` para fora da Matriz, e a view
--   é security_invoker (259): sem linha na base, a view devolve vazio.
--   Ninguém reclamou porque a tela não dá erro, só mostra "sem nota".
--   Verificado no banco: usuário de filial não passa em nenhum ramo da
--   policy, retorno zerado.
--
-- Correção: RPC SECURITY DEFINER que entrega SÓ o agregado — média e
-- quantidade — sem avaliador_id, sem comentário, sem decisão. A tabela
-- segue fechada; o que sai daqui é o resultado, não o voto.
--
-- Regras:
--   • Só tarefa ENCERRADA. Média de tarefa em avaliação é resultado
--     parcial, e ainda por cima colide com o voto selado da 345.
--   • Nota de admin fora da conta (regra da 240).
--   • Filial vê só os próprios participantes; Matriz vê todos.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.media_participantes_competicao(p_competicao_id uuid)
RETURNS TABLE (
  item_id        uuid,
  filial_avaliada text,
  media_nota     numeric,
  n_notas        int
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_filial text;
BEGIN
  SELECT up.filial INTO v_filial FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT am.item_id,
         am.filial_avaliada,
         ROUND(AVG(am.nota), 2)               AS media_nota,
         COUNT(*) FILTER (WHERE am.nota IS NOT NULL)::int AS n_notas
    FROM avaliacoes_matriz am
    JOIN user_profiles up ON up.id = am.avaliador_id
    JOIN matriz_tarefa_participantes p ON p.id = am.item_id
    JOIN matriz_tarefas t ON t.id = p.tarefa_id
   WHERE am.competicao_id = p_competicao_id
     AND am.ativo = true
     AND am.nota IS NOT NULL
     AND am.item_tipo LIKE 'tarefa\_%'
     AND up.role <> 'admin'
     AND t.ativo = true
     AND t.status = 'encerrada'          -- só resultado fechado
     AND (v_filial = 'Matriz' OR am.filial_avaliada = v_filial)
   GROUP BY am.item_id, am.filial_avaliada;
END;
$$;

-- `REVOKE ... FROM public` NÃO basta: o Supabase tem ALTER DEFAULT PRIVILEGES
-- concedendo EXECUTE a anon/authenticated em toda função nova do schema, e esse
-- grant é explícito, não vem de PUBLIC. Sem revogar anon nominalmente, a RPC
-- nasce chamável com a anon key (visível no F12) — foi assim que as RPCs das
-- migrações 343/345 escaparam da varredura da 260.
REVOKE ALL ON FUNCTION public.media_participantes_competicao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.media_participantes_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
