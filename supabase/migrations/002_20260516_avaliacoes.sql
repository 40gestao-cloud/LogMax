-- =================================================================
-- LogMax — Módulo de Avaliações de Desempenho (Etapa 1)
-- =================================================================
-- Pré-requisito: hardening RLS (20260516_rls_hardening.sql) + CEO fix
-- (20260516_rls_ceo_role.sql) aplicados — usa auth_is_admin() e
-- auth_user_setor() já criados.
--
-- 4 tabelas: ciclos_avaliacao, avaliacoes, criterios_avaliacao,
-- feedbacks_avaliacao. Decisões do operador:
--   - Feedback anônimo (default true; configurável por ciclo)
--   - Só admin/CEO abre/fecha ciclos
--   - Escala 1-5
--   - Vínculo gerente→colaborador via user_profiles.setor
--
-- 1 RPC: criar_avaliacao (transacional — insere avaliação + N critérios)
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Schemas
-- ─────────────────────────────────────────────

CREATE TABLE ciclos_avaliacao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             text NOT NULL,
  data_inicio      date NOT NULL,
  data_fim         date NOT NULL,
  status           text NOT NULL DEFAULT 'Aberto',
  feedback_anonimo boolean NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  CONSTRAINT chk_ciclo_status CHECK (status IN ('Aberto', 'Fechado')),
  CONSTRAINT chk_ciclo_periodo CHECK (data_fim >= data_inicio)
);

CREATE TABLE avaliacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id     uuid NOT NULL REFERENCES ciclos_avaliacao(id) ON DELETE CASCADE,
  avaliador_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  avaliado_id  uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  tipo         text NOT NULL,
  observacao   text,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT chk_aval_tipo CHECK (tipo IN ('ceo_gerente', 'gerente_colaborador', 'feedback_colaborador')),
  CONSTRAINT chk_aval_distinct CHECK (avaliador_id <> avaliado_id),
  CONSTRAINT unq_avaliacao UNIQUE (ciclo_id, avaliador_id, avaliado_id, tipo)
);

CREATE INDEX idx_avaliacoes_ciclo     ON avaliacoes(ciclo_id);
CREATE INDEX idx_avaliacoes_avaliado  ON avaliacoes(avaliado_id);
CREATE INDEX idx_avaliacoes_avaliador ON avaliacoes(avaliador_id);

CREATE TABLE criterios_avaliacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_id  uuid NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
  categoria     text NOT NULL,
  criterio      text NOT NULL,
  nota          smallint NOT NULL,
  CONSTRAINT chk_crit_categoria CHECK (categoria IN ('tecnica', 'comportamental', 'socioemocional')),
  CONSTRAINT chk_crit_nota      CHECK (nota BETWEEN 1 AND 5)
);

CREATE INDEX idx_criterios_avaliacao ON criterios_avaliacao(avaliacao_id);

CREATE TABLE feedbacks_avaliacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_id  uuid NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
  texto         text NOT NULL,
  anonimo       boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_feedbacks_avaliacao ON feedbacks_avaliacao(avaliacao_id);

-- ─────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────

ALTER TABLE ciclos_avaliacao     ENABLE ROW LEVEL SECURITY;
ALTER TABLE avaliacoes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE criterios_avaliacao  ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedbacks_avaliacao  ENABLE ROW LEVEL SECURITY;

-- Ciclos: todos veem; só admin/CEO escreve
CREATE POLICY "ciclos_read" ON ciclos_avaliacao
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ciclos_write" ON ciclos_avaliacao
  FOR ALL TO authenticated
  USING (auth_is_admin())
  WITH CHECK (auth_is_admin());

-- Avaliações: avaliador, avaliado, gerente do setor do avaliado, admin/CEO
CREATE POLICY "avaliacoes_read" ON avaliacoes
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR avaliador_id = auth.uid()
    OR avaliado_id = auth.uid()
    OR (
      auth_user_role() = 'gerente'
      AND avaliado_id IN (SELECT id FROM user_profiles WHERE setor = auth_user_setor())
    )
  );

CREATE POLICY "avaliacoes_insert" ON avaliacoes
  FOR INSERT TO authenticated
  WITH CHECK (avaliador_id = auth.uid());

CREATE POLICY "avaliacoes_modify" ON avaliacoes
  FOR UPDATE TO authenticated
  USING (auth_is_admin())
  WITH CHECK (auth_is_admin());

CREATE POLICY "avaliacoes_delete" ON avaliacoes
  FOR DELETE TO authenticated
  USING (auth_is_admin());

-- Critérios: herdam visibilidade da avaliação (RLS dela cobre)
CREATE POLICY "criterios_read" ON criterios_avaliacao
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM avaliacoes a WHERE a.id = criterios_avaliacao.avaliacao_id));

CREATE POLICY "criterios_insert" ON criterios_avaliacao
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM avaliacoes a
      WHERE a.id = criterios_avaliacao.avaliacao_id
        AND a.avaliador_id = auth.uid()
    )
  );

-- Feedbacks: idem. Anonimato é mostrado/escondido pelo frontend
-- (auth.uid() ainda pode estar associado em logs, mas a UI esconde).
CREATE POLICY "feedbacks_read" ON feedbacks_avaliacao
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM avaliacoes a WHERE a.id = feedbacks_avaliacao.avaliacao_id));

CREATE POLICY "feedbacks_insert" ON feedbacks_avaliacao
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM avaliacoes a
      WHERE a.id = feedbacks_avaliacao.avaliacao_id
        AND a.avaliador_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- 3. RPC: criar_avaliacao (transacional)
-- ─────────────────────────────────────────────
-- Insere 1 avaliação + N critérios numa única transação.
-- Roll back automático em caso de violação de constraint (escala,
-- categoria, UNIQUE de avaliação, distinct avaliador/avaliado).

CREATE OR REPLACE FUNCTION criar_avaliacao(
  p_ciclo_id     uuid,
  p_avaliado_id  uuid,
  p_tipo         text,
  p_observacao   text,
  p_criterios    jsonb  -- [{categoria, criterio, nota}, ...]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER  -- mantém RLS do avaliador (auth.uid())
SET search_path = public
AS $$
DECLARE
  v_avaliacao_id uuid;
  v_criterio     jsonb;
BEGIN
  -- Insere a avaliação (RLS exige avaliador_id = auth.uid())
  INSERT INTO avaliacoes (ciclo_id, avaliador_id, avaliado_id, tipo, observacao)
  VALUES (p_ciclo_id, auth.uid(), p_avaliado_id, p_tipo, p_observacao)
  RETURNING id INTO v_avaliacao_id;

  -- Insere todos os critérios
  FOR v_criterio IN SELECT * FROM jsonb_array_elements(p_criterios) LOOP
    INSERT INTO criterios_avaliacao (avaliacao_id, categoria, criterio, nota)
    VALUES (
      v_avaliacao_id,
      v_criterio->>'categoria',
      v_criterio->>'criterio',
      (v_criterio->>'nota')::smallint
    );
  END LOOP;

  RETURN v_avaliacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION criar_avaliacao(uuid, uuid, text, text, jsonb) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
-- Como admin/CEO logado:
--   INSERT INTO ciclos_avaliacao (nome, data_inicio, data_fim)
--     VALUES ('Teste 2026', '2026-01-01', '2026-12-31');
--   SELECT count(*) FROM ciclos_avaliacao; -- 1
-- =================================================================
