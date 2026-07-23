-- =================================================================
-- Ciclo da Avaliação das Filiais nasce da Competição do Conselho.
--
-- Antes: admin criava um ciclo em Padrão com filial='Matriz' e o
-- AvaliacaoFilialPanel usava esse ciclo pra registrar as notas dos
-- 7 eixos. Duas fontes de verdade (ciclo Matriz + competição) que
-- precisavam ser alinhadas manualmente — datas, abertura, fecho.
--
-- Agora: cada `competicoes_matriz` nasce com um ciclo Matriz próprio
-- (criado por trigger). Enquanto a competição está `em_andamento` ou
-- `aguardando_encerramento`, o ciclo fica `Aberto`. Quando a
-- competição vira `encerrada`, o ciclo fecha junto. Deletar a
-- competição cascateia via FK (ON DELETE CASCADE) e apaga o ciclo.
--
-- Backfill: pra cada competição ativa sem ciclo, cria um agora.
-- Ciclos Matriz órfãos criados manualmente no Padrão continuam
-- existindo (não mexemos neles) — o AvaliacaoFilialPanel só olha o
-- ciclo amarrado à competição corrente.
--
-- Idempotente (IF NOT EXISTS + CREATE OR REPLACE).
-- =================================================================

BEGIN;

-- 1. Nova coluna: competicoes_matriz.ciclo_id ────────────────────
ALTER TABLE public.competicoes_matriz
  ADD COLUMN IF NOT EXISTS ciclo_id uuid
    REFERENCES public.ciclos_avaliacao(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comp_ciclo ON public.competicoes_matriz(ciclo_id);

-- 2. Trigger BEFORE INSERT: cria o ciclo Matriz junto ────────────
CREATE OR REPLACE FUNCTION public.competicao_criar_ciclo_matriz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ciclo_id uuid;
BEGIN
  IF NEW.ciclo_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO ciclos_avaliacao (nome, data_inicio, data_fim, status, feedback_anonimo, filial)
  VALUES (
    'Competição — ' || NEW.nome,
    NEW.data_inicio,
    NEW.data_fim,
    'Aberto',
    false,
    'Matriz'
  )
  RETURNING id INTO v_ciclo_id;

  NEW.ciclo_id := v_ciclo_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comp_criar_ciclo ON public.competicoes_matriz;
CREATE TRIGGER trg_comp_criar_ciclo
  BEFORE INSERT ON public.competicoes_matriz
  FOR EACH ROW
  EXECUTE FUNCTION public.competicao_criar_ciclo_matriz();

-- 3. Trigger AFTER UPDATE: sincroniza status do ciclo ────────────
-- Fecha o ciclo quando competição encerra; reabre se voltar pra
-- em_andamento (raro, mas mantém coerência). Datas também seguem.
CREATE OR REPLACE FUNCTION public.competicao_sync_ciclo_matriz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ciclo_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.data_inicio IS DISTINCT FROM OLD.data_inicio
     OR NEW.data_fim IS DISTINCT FROM OLD.data_fim
     OR NEW.nome IS DISTINCT FROM OLD.nome
  THEN
    UPDATE ciclos_avaliacao
       SET nome        = 'Competição — ' || NEW.nome,
           data_inicio = NEW.data_inicio,
           data_fim    = NEW.data_fim,
           status      = CASE WHEN NEW.status = 'encerrada' THEN 'Fechado' ELSE 'Aberto' END
     WHERE id = NEW.ciclo_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comp_sync_ciclo ON public.competicoes_matriz;
CREATE TRIGGER trg_comp_sync_ciclo
  AFTER UPDATE ON public.competicoes_matriz
  FOR EACH ROW
  EXECUTE FUNCTION public.competicao_sync_ciclo_matriz();

-- 4. Backfill: competições sem ciclo ganham um agora ─────────────
DO $$
DECLARE
  r record;
  v_ciclo_id uuid;
BEGIN
  FOR r IN
    SELECT id, nome, data_inicio, data_fim, status
      FROM competicoes_matriz
     WHERE ciclo_id IS NULL
       AND ativo = true
  LOOP
    INSERT INTO ciclos_avaliacao (nome, data_inicio, data_fim, status, feedback_anonimo, filial)
    VALUES (
      'Competição — ' || r.nome,
      r.data_inicio,
      r.data_fim,
      CASE WHEN r.status = 'encerrada' THEN 'Fechado' ELSE 'Aberto' END,
      false,
      'Matriz'
    )
    RETURNING id INTO v_ciclo_id;

    UPDATE competicoes_matriz SET ciclo_id = v_ciclo_id WHERE id = r.id;
  END LOOP;
END $$;

-- 5. excluir_competicao_matriz também remove o ciclo ─────────────
-- A migração 229 fez hard delete de avaliacoes_matriz/votos/tarefas
-- mas não sabia do ciclo. Agora deleta também: ON DELETE CASCADE em
-- avaliacoes (via ciclos_avaliacao) limpa tudo em uma tacada.
CREATE OR REPLACE FUNCTION public.excluir_competicao_matriz(
  p_competicao_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existe boolean;
  v_ciclo  uuid;
BEGIN
  IF auth_user_role() NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO pode excluir competição' USING ERRCODE = '42501';
  END IF;

  SELECT true, ciclo_id INTO v_existe, v_ciclo
    FROM competicoes_matriz WHERE id = p_competicao_id;
  IF v_existe IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM avaliacoes_matriz  WHERE competicao_id = p_competicao_id;
  DELETE FROM competicao_votos   WHERE competicao_id = p_competicao_id;
  DELETE FROM matriz_tarefas     WHERE competicao_id = p_competicao_id;
  DELETE FROM competicoes_matriz WHERE id = p_competicao_id;

  IF v_ciclo IS NOT NULL THEN
    DELETE FROM ciclos_avaliacao WHERE id = v_ciclo;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_competicao_matriz(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
