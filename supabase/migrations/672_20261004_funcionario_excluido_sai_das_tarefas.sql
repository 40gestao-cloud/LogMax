-- 672_20261004_funcionario_excluido_sai_das_tarefas.sql
--
-- Excluir em Funcionários é soft-delete (`funcionarios.ativo = false`) e não
-- cascateava: a pessoa seguia escalada nas Tarefas da Matriz e nas Demandas
-- do Ciclo, aparecendo na Central como "sem nota" e entrando na cobrança de
-- avaliação. Achado em 2026-10-04 com Tomas Cauan Costa (ERP), excluído em
-- 26/09 e ainda em duas tarefas da competição 002 e uma demanda do ciclo; a
-- varredura nas 4 turmas achou mais 6 (Aprendiz e Contabilidade).
--
-- Regra (decisão do usuário): funcionário excluído SAI de toda tarefa e
-- demanda que ainda não encerrou, e as notas dadas a ele ali saem junto.
-- Tarefa ENCERRADA fica como está — é resultado publicado; o placar de
-- competição declarada é o snapshot congelado (372/373) e não muda.
--
-- Mesmo gesto do botão "remover participante" (`remover_matriz_participante`):
-- participante `ativo = false` e notas `ativo = false`. Nada é apagado aqui.
-- O destino do histórico (ponto, folha etc.) é outra decisão, tratada à parte.
--
-- Frequência já ignorava o excluído (`_frequencia_competicao` filtra
-- `fn.ativo = true`), então o placar de frequência não muda.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public._tirar_funcionario_das_tarefas(p_funcionario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_part_m  int;
  v_notas_m int;
  v_part_c  int;
  v_notas_c int;
BEGIN
  -- Tarefas da Matriz (competição) ainda não encerradas.
  UPDATE avaliacoes_matriz am
     SET ativo = false
    FROM matriz_tarefa_participantes p
    JOIN matriz_tarefas t ON t.id = p.tarefa_id
   WHERE am.item_id = p.id
     AND am.item_tipo LIKE 'tarefa\_%'
     AND am.ativo = true
     AND p.funcionario_id = p_funcionario_id
     AND p.ativo = true
     AND t.status <> 'encerrada';
  GET DIAGNOSTICS v_notas_m = ROW_COUNT;

  UPDATE matriz_tarefa_participantes p
     SET ativo = false
    FROM matriz_tarefas t
   WHERE t.id = p.tarefa_id
     AND p.funcionario_id = p_funcionario_id
     AND p.ativo = true
     AND t.status <> 'encerrada';
  GET DIAGNOSTICS v_part_m = ROW_COUNT;

  -- Demandas do Ciclo (Padrão) ainda não encerradas.
  UPDATE ciclo_tarefa_avaliacoes a
     SET ativo = false
    FROM ciclo_tarefa_participantes p
    JOIN ciclo_tarefas t ON t.id = p.tarefa_id
   WHERE a.participante_id = p.id
     AND a.ativo = true
     AND p.funcionario_id = p_funcionario_id
     AND p.ativo = true
     AND t.status <> 'encerrada';
  GET DIAGNOSTICS v_notas_c = ROW_COUNT;

  UPDATE ciclo_tarefa_participantes p
     SET ativo = false
    FROM ciclo_tarefas t
   WHERE t.id = p.tarefa_id
     AND p.funcionario_id = p_funcionario_id
     AND p.ativo = true
     AND t.status <> 'encerrada';
  GET DIAGNOSTICS v_part_c = ROW_COUNT;

  RETURN jsonb_build_object(
    'tarefas_matriz', v_part_m, 'notas_matriz', v_notas_m,
    'demandas_ciclo', v_part_c, 'notas_ciclo', v_notas_c
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._tirar_funcionario_das_tarefas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tirar_funcionario_das_tarefas(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_funcionario_excluido_sai_das_tarefas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._tirar_funcionario_das_tarefas(NEW.id);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_funcionario_excluido_sai_das_tarefas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_funcionario_excluido_sai_das_tarefas ON public.funcionarios;
CREATE TRIGGER trg_funcionario_excluido_sai_das_tarefas
  AFTER UPDATE OF ativo ON public.funcionarios
  FOR EACH ROW
  WHEN (OLD.ativo IS DISTINCT FROM NEW.ativo AND NEW.ativo = false)
  EXECUTE FUNCTION public.fn_funcionario_excluido_sai_das_tarefas();

-- Backfill: quem já estava excluído. Lista revisada com o usuário antes de
-- aplicar (ERP: Tomas Cauan Costa; Aprendiz: Davi Marçal, José Vitor;
-- Contabilidade: Isabele Oliveira, lara Letícia, Maria Tamires, Vicente) —
-- nenhum com nota.
SELECT public._tirar_funcionario_das_tarefas(f.id)
  FROM public.funcionarios f
 WHERE f.ativo = false;

COMMIT;
