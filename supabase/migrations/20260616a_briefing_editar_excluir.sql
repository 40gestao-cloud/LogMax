-- ============================================================================
-- Briefing Diário: editar/excluir briefing já aprovado com cascade nas tarefas
-- ============================================================================
-- Admin/CEO precisava de poder editar ou excluir um briefing já aprovado e
-- que essas mudanças propaguem pras tarefas derivadas (em `tarefas` e
-- `marketing_tarefas`). Antes desta migração:
--
--   - Briefing aprovado virava read-only no client; sem como corrigir um erro.
--   - Não havia link estável entre tarefas_propostas[i] e a linha em `tarefas`
--     (só `briefing_id`). Editar a 2ª tarefa de um briefing não tinha como
--     achar a linha correspondente.
--
-- Esta migração:
--   1. Adiciona `briefing_tarefa_idx int` em `tarefas` e `marketing_tarefas`
--      pra dar identificador estável (corresponde ao índice no array JSON
--      tarefas_propostas).
--   2. Backfill defensivo: liga tarefas existentes a seus briefings via
--      match por (briefing_id + modulo + titulo). Custo nulo (admin tem
--      poucos briefings históricos).
--   3. RPC `excluir_briefing_cascade(p_briefing_id)` — soft-delete o briefing
--      + hard-delete tarefas/marketing_tarefas DERIVADAS que ainda estão
--      Pendente (preserva trabalho em andamento).
--   4. RPC `editar_tarefa_briefing(p_briefing_id, p_idx, p_titulo, p_descricao,
--      p_prioridade, p_prazo_dias)` — atualiza JSON do briefing + propaga
--      pra linha derivada se status = 'Pendente'.
--   5. RPC `descartar_tarefa_briefing(p_briefing_id, p_idx)` — marca como
--      descartada no JSON + apaga linha derivada se Pendente.
--
-- Todas as RPCs são SECURITY DEFINER + checam role admin/CEO internamente.
-- Idempotente. Execute no Supabase SQL Editor.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Coluna briefing_tarefa_idx em tarefas
-- ─────────────────────────────────────────────

ALTER TABLE tarefas
  ADD COLUMN IF NOT EXISTS briefing_tarefa_idx int;

CREATE INDEX IF NOT EXISTS idx_tarefas_briefing_idx
  ON tarefas(briefing_id, briefing_tarefa_idx)
  WHERE briefing_id IS NOT NULL;

ALTER TABLE marketing_tarefas
  ADD COLUMN IF NOT EXISTS briefing_tarefa_idx int;

CREATE INDEX IF NOT EXISTS idx_mkt_tarefas_briefing_idx
  ON marketing_tarefas(briefing_id, briefing_tarefa_idx)
  WHERE briefing_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 2. Backfill: linka tarefas históricas ao índice no JSON do briefing
-- ─────────────────────────────────────────────
-- Match heurístico: mesmo (briefing_id, modulo, titulo). Se houver título
-- duplicado dentro do mesmo briefing, pega o primeiro — caso de borda raro
-- (IA não costuma gerar título idêntico no mesmo briefing). Se não casar
-- nada, fica NULL e propagação simplesmente não acontece pra aquela tarefa.

WITH mapping AS (
  SELECT DISTINCT ON (t.id)
    t.id          AS tarefa_id,
    (ord.n - 1)   AS idx
  FROM tarefas t
  JOIN briefings_diarios b ON b.id = t.briefing_id
  CROSS JOIN LATERAL jsonb_array_elements(b.tarefas_propostas) WITH ORDINALITY AS ord(elem, n)
  WHERE t.briefing_id IS NOT NULL
    AND t.briefing_tarefa_idx IS NULL
    AND ord.elem->>'titulo'  = t.titulo
    AND ord.elem->>'modulo'  = t.modulo
  ORDER BY t.id, ord.n
)
UPDATE tarefas t
   SET briefing_tarefa_idx = m.idx
  FROM mapping m
 WHERE t.id = m.tarefa_id;

WITH mapping AS (
  SELECT DISTINCT ON (t.id)
    t.id          AS tarefa_id,
    (ord.n - 1)   AS idx
  FROM marketing_tarefas t
  JOIN briefings_diarios b ON b.id = t.briefing_id
  CROSS JOIN LATERAL jsonb_array_elements(b.tarefas_propostas) WITH ORDINALITY AS ord(elem, n)
  WHERE t.briefing_id IS NOT NULL
    AND t.briefing_tarefa_idx IS NULL
    AND ord.elem->>'titulo'  = t.titulo
    AND ord.elem->>'modulo'  = 'marketing'
  ORDER BY t.id, ord.n
)
UPDATE marketing_tarefas t
   SET briefing_tarefa_idx = m.idx
  FROM mapping m
 WHERE t.id = m.tarefa_id;

-- ─────────────────────────────────────────────
-- 3. RPC: excluir_briefing_cascade
-- ─────────────────────────────────────────────
-- Cascade controlado: apaga linhas Pendentes em tarefas/marketing_tarefas
-- derivadas; preserva o que já está Em Andamento/Concluído (trabalho não
-- some por decisão administrativa). Soft-delete o briefing pra manter
-- auditoria do histórico.

CREATE OR REPLACE FUNCTION excluir_briefing_cascade(p_briefing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role             text;
  v_tarefas_apagadas int := 0;
  v_mkt_apagadas     int := 0;
  v_briefing_existe  boolean;
BEGIN
  -- RBAC: só admin/CEO.
  SELECT role INTO v_role FROM user_profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas Admin e CEO podem excluir briefings.';
  END IF;

  SELECT EXISTS(SELECT 1 FROM briefings_diarios WHERE id = p_briefing_id) INTO v_briefing_existe;
  IF NOT v_briefing_existe THEN
    RAISE EXCEPTION 'Briefing não encontrado.';
  END IF;

  WITH d AS (
    DELETE FROM tarefas
     WHERE briefing_id = p_briefing_id AND status = 'Pendente'
     RETURNING 1
  )
  SELECT count(*) FROM d INTO v_tarefas_apagadas;

  WITH d AS (
    DELETE FROM marketing_tarefas
     WHERE briefing_id = p_briefing_id AND status = 'Pendente'
     RETURNING 1
  )
  SELECT count(*) FROM d INTO v_mkt_apagadas;

  UPDATE briefings_diarios
     SET ativo = false, status = 'descartado'
   WHERE id = p_briefing_id;

  RETURN jsonb_build_object(
    'briefing_id',         p_briefing_id,
    'tarefas_apagadas',    v_tarefas_apagadas,
    'marketing_apagadas',  v_mkt_apagadas
  );
END;
$$;

REVOKE ALL ON FUNCTION excluir_briefing_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION excluir_briefing_cascade(uuid) TO authenticated;

-- ─────────────────────────────────────────────
-- 4. RPC: editar_tarefa_briefing
-- ─────────────────────────────────────────────
-- Atualiza o item p_idx do array tarefas_propostas E propaga pra linha
-- derivada em tarefas/marketing_tarefas se ainda estiver Pendente. Se a
-- tarefa derivada já está Em Andamento/Concluído, mantém intacta —
-- conserva o trabalho.
--
-- Devolve flag 'tarefa_propagada' pra UI saber se conseguiu atualizar a
-- linha derivada (false = aprovada mas usuário do setor já mexeu nela).

CREATE OR REPLACE FUNCTION editar_tarefa_briefing(
  p_briefing_id uuid,
  p_idx         int,
  p_titulo      text,
  p_descricao   text,
  p_prioridade  text,
  p_prazo_dias  int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role             text;
  v_briefing         briefings_diarios%ROWTYPE;
  v_modulo           text;
  v_prazo_iso        date;
  v_updated          int := 0;
  v_tarefas_propostas jsonb;
BEGIN
  -- RBAC
  SELECT role INTO v_role FROM user_profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas Admin e CEO podem editar tarefas do briefing.';
  END IF;

  -- Validações de entrada
  IF p_titulo IS NULL OR length(trim(p_titulo)) = 0 THEN
    RAISE EXCEPTION 'Título é obrigatório.';
  END IF;
  IF p_prioridade NOT IN ('Alta','Média','Baixa') THEN
    RAISE EXCEPTION 'Prioridade inválida.';
  END IF;
  IF p_prazo_dias < 1 OR p_prazo_dias > 14 THEN
    RAISE EXCEPTION 'Prazo deve estar entre 1 e 14 dias.';
  END IF;

  SELECT * INTO v_briefing FROM briefings_diarios WHERE id = p_briefing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Briefing não encontrado.';
  END IF;

  -- Atualiza item p_idx no JSON tarefas_propostas
  v_tarefas_propostas := (
    SELECT jsonb_agg(
      CASE
        WHEN (elem->>'_id') = ('t-' || p_idx::text) THEN
          elem
            || jsonb_build_object('titulo',     trim(p_titulo))
            || jsonb_build_object('descricao',  COALESCE(trim(p_descricao), ''))
            || jsonb_build_object('prioridade', p_prioridade)
            || jsonb_build_object('prazo_dias', p_prazo_dias)
            || jsonb_build_object('editada',    true)
        ELSE elem
      END
    )
    FROM jsonb_array_elements(v_briefing.tarefas_propostas) elem
  );

  IF v_tarefas_propostas IS NULL THEN
    RAISE EXCEPTION 'Briefing sem tarefas propostas.';
  END IF;

  UPDATE briefings_diarios
     SET tarefas_propostas = v_tarefas_propostas
   WHERE id = p_briefing_id;

  -- Descobre o módulo da tarefa pra escolher a tabela destino
  SELECT (elem->>'modulo') INTO v_modulo
  FROM jsonb_array_elements(v_briefing.tarefas_propostas) elem
  WHERE elem->>'_id' = ('t-' || p_idx::text)
  LIMIT 1;

  v_prazo_iso := v_briefing.data_referencia + (p_prazo_dias::text || ' days')::interval;

  IF v_modulo = 'marketing' THEN
    UPDATE marketing_tarefas
       SET titulo     = trim(p_titulo),
           descricao  = COALESCE(trim(p_descricao), ''),
           prioridade = p_prioridade,
           prazo      = v_prazo_iso
     WHERE briefing_id = p_briefing_id
       AND briefing_tarefa_idx = p_idx
       AND status = 'Pendente';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF v_modulo IS NOT NULL THEN
    UPDATE tarefas
       SET titulo     = trim(p_titulo),
           descricao  = COALESCE(trim(p_descricao), ''),
           prioridade = p_prioridade,
           prazo      = v_prazo_iso
     WHERE briefing_id = p_briefing_id
       AND briefing_tarefa_idx = p_idx
       AND status = 'Pendente';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'briefing_id',      p_briefing_id,
    'tarefa_idx',       p_idx,
    'modulo',           v_modulo,
    'tarefa_propagada', v_updated > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION editar_tarefa_briefing(uuid, int, text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION editar_tarefa_briefing(uuid, int, text, text, text, int) TO authenticated;

-- ─────────────────────────────────────────────
-- 5. RPC: descartar_tarefa_briefing
-- ─────────────────────────────────────────────
-- Marca como descartada=true no JSON e apaga a linha derivada (se Pendente).
-- Útil pra admin remover UMA tarefa específica de um briefing já aprovado
-- sem precisar excluir o briefing inteiro.

CREATE OR REPLACE FUNCTION descartar_tarefa_briefing(
  p_briefing_id uuid,
  p_idx         int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role              text;
  v_briefing          briefings_diarios%ROWTYPE;
  v_modulo            text;
  v_apagada           int := 0;
  v_tarefas_propostas jsonb;
BEGIN
  SELECT role INTO v_role FROM user_profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas Admin e CEO podem descartar tarefas do briefing.';
  END IF;

  SELECT * INTO v_briefing FROM briefings_diarios WHERE id = p_briefing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Briefing não encontrado.';
  END IF;

  v_tarefas_propostas := (
    SELECT jsonb_agg(
      CASE
        WHEN (elem->>'_id') = ('t-' || p_idx::text) THEN
          elem
            || jsonb_build_object('descartada', true)
            || jsonb_build_object('aprovada',   false)
        ELSE elem
      END
    )
    FROM jsonb_array_elements(v_briefing.tarefas_propostas) elem
  );

  UPDATE briefings_diarios
     SET tarefas_propostas = v_tarefas_propostas
   WHERE id = p_briefing_id;

  SELECT (elem->>'modulo') INTO v_modulo
  FROM jsonb_array_elements(v_briefing.tarefas_propostas) elem
  WHERE elem->>'_id' = ('t-' || p_idx::text)
  LIMIT 1;

  IF v_modulo = 'marketing' THEN
    WITH d AS (
      DELETE FROM marketing_tarefas
       WHERE briefing_id = p_briefing_id
         AND briefing_tarefa_idx = p_idx
         AND status = 'Pendente'
      RETURNING 1
    ) SELECT count(*) FROM d INTO v_apagada;
  ELSIF v_modulo IS NOT NULL THEN
    WITH d AS (
      DELETE FROM tarefas
       WHERE briefing_id = p_briefing_id
         AND briefing_tarefa_idx = p_idx
         AND status = 'Pendente'
      RETURNING 1
    ) SELECT count(*) FROM d INTO v_apagada;
  END IF;

  RETURN jsonb_build_object(
    'briefing_id',     p_briefing_id,
    'tarefa_idx',      p_idx,
    'modulo',          v_modulo,
    'tarefa_apagada',  v_apagada > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION descartar_tarefa_briefing(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION descartar_tarefa_briefing(uuid, int) TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFICAÇÃO
--   SELECT count(*) FROM tarefas WHERE briefing_id IS NOT NULL AND briefing_tarefa_idx IS NOT NULL;
--   SELECT excluir_briefing_cascade('00000000-0000-0000-0000-000000000000');  -- deve falhar
--   SELECT editar_tarefa_briefing('...', 0, 'Novo título', 'Nova descrição', 'Alta', 2);
-- ============================================================================
