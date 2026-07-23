-- =================================================================
-- Competição excluída (hard ou soft) apaga o ciclo Matriz vinculado.
--
-- Contexto:
--   A migr. 238 criou `competicoes_matriz.ciclo_id → ciclos_avaliacao`
--   com ON DELETE SET NULL — quer dizer: se o CICLO some, a competição
--   perde a referência. O caminho inverso não é coberto. Se alguém
--   apaga a competição direto (fora da RPC excluir_competicao_matriz)
--   ou só marca `ativo=false`, o ciclo continua no banco, marcado como
--   'Aberto' com filial 'Matriz'. O filtro `ciclosCompeticaoIds` da
--   AvaliacoesView deixa de esconder (competição não existe mais na
--   query), e o ciclo volta a aparecer no Padrão como se fosse um
--   ciclo Matriz solto — editável, excluível.
--
-- Fix:
--   1) AFTER DELETE em competicoes_matriz → DELETE do ciclo se ainda
--      existir. Cobre hard delete direto na tabela.
--   2) A sync trigger do 238 já fecha o ciclo quando status vira
--      'encerrada'; estendida aqui pra também apagar quando `ativo`
--      passa de true→false (soft delete).
--
-- Idempotente (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).
-- =================================================================

BEGIN;

-- 1. AFTER DELETE em competicoes_matriz ──────────────────────────
CREATE OR REPLACE FUNCTION public.competicao_apaga_ciclo_matriz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.ciclo_id IS NOT NULL THEN
    DELETE FROM ciclos_avaliacao WHERE id = OLD.ciclo_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_comp_apaga_ciclo ON public.competicoes_matriz;
CREATE TRIGGER trg_comp_apaga_ciclo
  AFTER DELETE ON public.competicoes_matriz
  FOR EACH ROW
  EXECUTE FUNCTION public.competicao_apaga_ciclo_matriz();

-- 2. Sync trigger cobre soft delete (ativo true → false) ─────────
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

  -- Soft delete: apaga o ciclo. `ciclosCompeticaoIds` no frontend
  -- só olha competições existentes (via ciclo_id NOT NULL); depois
  -- do soft delete o ciclo não seria escondido — melhor sumir.
  IF OLD.ativo = true AND NEW.ativo = false THEN
    DELETE FROM ciclos_avaliacao WHERE id = NEW.ciclo_id;
    NEW.ciclo_id := NULL;
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

-- Sync roda BEFORE agora (precisa alterar NEW.ciclo_id no soft delete).
DROP TRIGGER IF EXISTS trg_comp_sync_ciclo ON public.competicoes_matriz;
CREATE TRIGGER trg_comp_sync_ciclo
  BEFORE UPDATE ON public.competicoes_matriz
  FOR EACH ROW
  EXECUTE FUNCTION public.competicao_sync_ciclo_matriz();

-- 3. Limpeza de órfãos existentes ────────────────────────────────
-- Ciclos 'Competição — ...' cujo dono não existe mais.
DELETE FROM ciclos_avaliacao
 WHERE filial = 'Matriz'
   AND nome LIKE 'Competição — %'
   AND id NOT IN (
     SELECT ciclo_id FROM competicoes_matriz WHERE ciclo_id IS NOT NULL
   );

NOTIFY pgrst, 'reload schema';

COMMIT;
