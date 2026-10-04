-- 675_20261004_quem_sai_da_unidade_sai_das_tarefas_e_volta_junto.sql
--
-- Fecha duas pontas que a 672 deixou (revisão de 2026-10-04):
--
-- 1. RESTAURAR um funcionário excluído não o devolvia às tarefas: a 672 só
--    tirava. Agora o que ela tira fica anotado em
--    `funcionario_tarefas_suspensas`, e a volta (restaurar, ou readmitir)
--    reativa exatamente o que foi suspenso — participação e notas.
-- 2. DESLIGADO e EXCLUÍDO se comportavam diferente: o excluído saía das
--    tarefas e o desligado ficava listado com a etiqueta "Desligado" (sem
--    pesar — 364). Agora a régua é uma só: quem está fora da unidade
--    (`ativo = false` OU `_funcionario_desligado()`) sai de toda Tarefa da
--    Matriz e Demanda do Ciclo não encerrada; quem volta, volta junto.
--    Desligamento é recuperação, não saída do curso (355-357): por isso a
--    volta precisa existir — readmitido, o histórico dele conta de novo.
--
-- Regras da volta: só reativa o que ESTE mecanismo suspendeu (remoção manual
-- pelo gestor não é desfeita), só em tarefa ainda não encerrada, e nunca por
-- cima de uma participação/nota ativa equivalente criada nesse meio-tempo
-- (os UNIQUE parciais por `ativo = true` seguem valendo).
--
-- Tarefa ENCERRADA não é tocada nem na ida nem na volta: é resultado
-- publicado, e o placar já ignora desligado por conta própria (364).
--
-- Gatilhos: `funcionarios` (ativo, status) e `user_profiles` (desligado_em),
-- porque `_funcionario_desligado()` olha os dois marcadores e eles divergem
-- nos dados reais (355). Readmissão que limpa os dois em comandos separados
-- funciona em qualquer ordem: a volta só acontece quando ambos liberam.
--
-- Backfill: nenhum desligado está hoje em tarefa aberta nas 4 turmas
-- (conferido antes de escrever), então não há o que mover.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.funcionario_tarefas_suspensas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL,
  tabela         text NOT NULL CHECK (tabela IN (
                   'matriz_tarefa_participantes', 'avaliacoes_matriz',
                   'ciclo_tarefa_participantes', 'ciclo_tarefa_avaliacoes')),
  registro_id    uuid NOT NULL,
  suspenso_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_func_tarefas_susp_func ON public.funcionario_tarefas_suspensas (funcionario_id);

-- Tabela interna: só as funções SECURITY DEFINER abaixo mexem nela.
ALTER TABLE public.funcionario_tarefas_suspensas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.funcionario_tarefas_suspensas FROM PUBLIC, anon, authenticated;

-- ── Ida: suspende e anota ───────────────────────────────────────────────
-- Mantém o nome da 672 (o gatilho dela chamava esta função).
CREATE OR REPLACE FUNCTION public._tirar_funcionario_das_tarefas(p_funcionario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m int := 0;
  v_c int := 0;
BEGIN
  WITH alvo AS (
    SELECT p.id
      FROM matriz_tarefa_participantes p
      JOIN matriz_tarefas t ON t.id = p.tarefa_id
     WHERE p.funcionario_id = p_funcionario_id
       AND p.ativo = true
       AND t.status <> 'encerrada'
  ),
  notas AS (
    UPDATE avaliacoes_matriz am SET ativo = false
     WHERE am.ativo = true
       AND am.item_tipo LIKE 'tarefa\_%'
       AND am.item_id IN (SELECT id FROM alvo)
    RETURNING am.id
  ),
  parts AS (
    UPDATE matriz_tarefa_participantes p SET ativo = false
     WHERE p.id IN (SELECT id FROM alvo)
    RETURNING p.id
  )
  INSERT INTO funcionario_tarefas_suspensas (funcionario_id, tabela, registro_id)
  SELECT p_funcionario_id, 'avaliacoes_matriz', id FROM notas
  UNION ALL
  SELECT p_funcionario_id, 'matriz_tarefa_participantes', id FROM parts;
  GET DIAGNOSTICS v_m = ROW_COUNT;

  WITH alvo AS (
    SELECT p.id
      FROM ciclo_tarefa_participantes p
      JOIN ciclo_tarefas t ON t.id = p.tarefa_id
     WHERE p.funcionario_id = p_funcionario_id
       AND p.ativo = true
       AND t.status <> 'encerrada'
  ),
  notas AS (
    UPDATE ciclo_tarefa_avaliacoes a SET ativo = false
     WHERE a.ativo = true
       AND a.participante_id IN (SELECT id FROM alvo)
    RETURNING a.id
  ),
  parts AS (
    UPDATE ciclo_tarefa_participantes p SET ativo = false
     WHERE p.id IN (SELECT id FROM alvo)
    RETURNING p.id
  )
  INSERT INTO funcionario_tarefas_suspensas (funcionario_id, tabela, registro_id)
  SELECT p_funcionario_id, 'ciclo_tarefa_avaliacoes', id FROM notas
  UNION ALL
  SELECT p_funcionario_id, 'ciclo_tarefa_participantes', id FROM parts;
  GET DIAGNOSTICS v_c = ROW_COUNT;

  RETURN jsonb_build_object('suspensos_matriz', v_m, 'suspensos_ciclo', v_c);
END;
$function$;

-- ── Volta: reativa só o que foi suspenso, onde ainda cabe ───────────────
CREATE OR REPLACE FUNCTION public._devolver_funcionario_as_tarefas(p_funcionario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pm int := 0; v_nm int := 0; v_pc int := 0; v_nc int := 0;
BEGIN
  -- Participação primeiro: a nota só volta se o participante voltou.
  UPDATE matriz_tarefa_participantes p SET ativo = true
    FROM funcionario_tarefas_suspensas s, matriz_tarefas t
   WHERE s.funcionario_id = p_funcionario_id
     AND s.tabela = 'matriz_tarefa_participantes'
     AND p.id = s.registro_id
     AND p.ativo = false
     AND t.id = p.tarefa_id AND t.ativo = true AND t.status <> 'encerrada'
     AND NOT EXISTS (
       SELECT 1 FROM matriz_tarefa_participantes x
        WHERE x.tarefa_id = p.tarefa_id AND x.funcionario_id = p.funcionario_id AND x.ativo = true);
  GET DIAGNOSTICS v_pm = ROW_COUNT;

  UPDATE avaliacoes_matriz am SET ativo = true
    FROM funcionario_tarefas_suspensas s
   WHERE s.funcionario_id = p_funcionario_id
     AND s.tabela = 'avaliacoes_matriz'
     AND am.id = s.registro_id
     AND am.ativo = false
     AND EXISTS (SELECT 1 FROM matriz_tarefa_participantes p WHERE p.id = am.item_id AND p.ativo = true)
     AND NOT EXISTS (
       SELECT 1 FROM avaliacoes_matriz x
        WHERE x.competicao_id = am.competicao_id AND x.item_tipo = am.item_tipo
          AND x.item_id = am.item_id AND x.avaliador_id = am.avaliador_id AND x.ativo = true);
  GET DIAGNOSTICS v_nm = ROW_COUNT;

  UPDATE ciclo_tarefa_participantes p SET ativo = true
    FROM funcionario_tarefas_suspensas s, ciclo_tarefas t
   WHERE s.funcionario_id = p_funcionario_id
     AND s.tabela = 'ciclo_tarefa_participantes'
     AND p.id = s.registro_id
     AND p.ativo = false
     AND t.id = p.tarefa_id AND t.status <> 'encerrada'
     AND NOT EXISTS (
       SELECT 1 FROM ciclo_tarefa_participantes x
        WHERE x.tarefa_id = p.tarefa_id AND x.funcionario_id = p.funcionario_id AND x.ativo = true);
  GET DIAGNOSTICS v_pc = ROW_COUNT;

  UPDATE ciclo_tarefa_avaliacoes a SET ativo = true
    FROM funcionario_tarefas_suspensas s
   WHERE s.funcionario_id = p_funcionario_id
     AND s.tabela = 'ciclo_tarefa_avaliacoes'
     AND a.id = s.registro_id
     AND a.ativo = false
     AND EXISTS (SELECT 1 FROM ciclo_tarefa_participantes p WHERE p.id = a.participante_id AND p.ativo = true)
     AND NOT EXISTS (
       SELECT 1 FROM ciclo_tarefa_avaliacoes x
        WHERE x.participante_id = a.participante_id AND x.avaliador_id = a.avaliador_id AND x.ativo = true);
  GET DIAGNOSTICS v_nc = ROW_COUNT;

  -- O que não coube (tarefa encerrou, gestor reescalou) não volta depois:
  -- a anotação é da saída que acabou de ser desfeita.
  DELETE FROM funcionario_tarefas_suspensas WHERE funcionario_id = p_funcionario_id;

  RETURN jsonb_build_object('participacoes_matriz', v_pm, 'notas_matriz', v_nm,
                            'participacoes_ciclo', v_pc, 'notas_ciclo', v_nc);
END;
$function$;

-- ── Uma régua só: fora da unidade → sai; de volta → volta ────────────────
CREATE OR REPLACE FUNCTION public._sincronizar_funcionario_tarefas(p_funcionario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ativo boolean;
BEGIN
  SELECT f.ativo INTO v_ativo FROM funcionarios f WHERE f.id = p_funcionario_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT COALESCE(v_ativo, true) OR public._funcionario_desligado(p_funcionario_id) THEN
    PERFORM public._tirar_funcionario_das_tarefas(p_funcionario_id);
  ELSE
    PERFORM public._devolver_funcionario_as_tarefas(p_funcionario_id);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._tirar_funcionario_das_tarefas(uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._devolver_funcionario_as_tarefas(uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sincronizar_funcionario_tarefas(uuid)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tirar_funcionario_das_tarefas(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public._devolver_funcionario_as_tarefas(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._sincronizar_funcionario_tarefas(uuid) TO service_role;

-- Gatilho em `funcionarios`: exclusão/restauração (ativo) e desligamento/
-- readmissão (status). Substitui o da 672, que só olhava a exclusão.
CREATE OR REPLACE FUNCTION public.fn_funcionario_sincroniza_tarefas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._sincronizar_funcionario_tarefas(NEW.id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_funcionario_excluido_sai_das_tarefas ON public.funcionarios;
DROP FUNCTION IF EXISTS public.fn_funcionario_excluido_sai_das_tarefas();
DROP TRIGGER IF EXISTS trg_funcionario_sincroniza_tarefas ON public.funcionarios;
CREATE TRIGGER trg_funcionario_sincroniza_tarefas
  AFTER UPDATE OF ativo, status ON public.funcionarios
  FOR EACH ROW
  WHEN (OLD.ativo IS DISTINCT FROM NEW.ativo OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_funcionario_sincroniza_tarefas();

-- Gatilho em `user_profiles`: o outro marcador de desligamento.
CREATE OR REPLACE FUNCTION public.fn_perfil_desligado_sincroniza_tarefas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_f uuid;
BEGIN
  FOR v_f IN SELECT f.id FROM funcionarios f WHERE f.user_profile_id = NEW.id LOOP
    PERFORM public._sincronizar_funcionario_tarefas(v_f);
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_perfil_desligado_sincroniza_tarefas ON public.user_profiles;
CREATE TRIGGER trg_perfil_desligado_sincroniza_tarefas
  AFTER UPDATE OF desligado_em ON public.user_profiles
  FOR EACH ROW
  WHEN (OLD.desligado_em IS DISTINCT FROM NEW.desligado_em)
  EXECUTE FUNCTION public.fn_perfil_desligado_sincroniza_tarefas();

REVOKE ALL ON FUNCTION public.fn_funcionario_sincroniza_tarefas()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_perfil_desligado_sincroniza_tarefas() FROM PUBLIC, anon, authenticated;

COMMIT;
