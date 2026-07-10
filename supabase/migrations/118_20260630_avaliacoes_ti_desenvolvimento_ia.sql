-- =================================================================
-- LogMax — TI & Desenvolvimento com IA passa a poder avaliar
-- participantes do treinamento (CEO/gerente/colaborador)
-- =================================================================
-- Reaproveita a infra de avaliacoes/criterios_avaliacao (módulo
-- Avaliações) em vez de criar um sistema paralelo. Diferença: essa
-- avaliação não pertence a um ciclo_avaliacao (não é semestral/anual,
-- é pontual por treinamento), então ciclo_id vira opcional e ganha
-- um par desenvolvimento_ia_id para o novo tipo 'ti_dev_ia'.
--
-- Pré-requisitos: 20260516_avaliacoes.sql, 20260618c_avaliacoes_*.sql,
-- 20260612d_dev_ia_ti_only_auxiliares_abertos.sql aplicados.
-- Idempotente ([[feedback_migration_nao_aplicada]]).
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Schema: ciclo_id opcional + vínculo com desenvolvimentos_ia
-- ─────────────────────────────────────────────

ALTER TABLE avaliacoes ALTER COLUMN ciclo_id DROP NOT NULL;

ALTER TABLE avaliacoes
  ADD COLUMN IF NOT EXISTS desenvolvimento_ia_id uuid REFERENCES desenvolvimentos_ia(id) ON DELETE CASCADE;

ALTER TABLE avaliacoes DROP CONSTRAINT IF EXISTS chk_aval_tipo;
ALTER TABLE avaliacoes
  ADD CONSTRAINT chk_aval_tipo
  CHECK (tipo IN ('ceo_gerente', 'gerente_colaborador', 'feedback_colaborador', 'ti_dev_ia'));

-- Cada avaliação pertence a exatamente um "contexto": ciclo OU treinamento.
ALTER TABLE avaliacoes DROP CONSTRAINT IF EXISTS chk_aval_contexto;
ALTER TABLE avaliacoes
  ADD CONSTRAINT chk_aval_contexto
  CHECK (
    (tipo = 'ti_dev_ia' AND ciclo_id IS NULL AND desenvolvimento_ia_id IS NOT NULL)
    OR
    (tipo <> 'ti_dev_ia' AND ciclo_id IS NOT NULL AND desenvolvimento_ia_id IS NULL)
  );

-- A UNIQUE original (ciclo_id, avaliador_id, avaliado_id, tipo) não
-- protege duplicidade quando ciclo_id é NULL (NULL <> NULL no Postgres).
-- Substituída por dois índices parciais, um por contexto.
ALTER TABLE avaliacoes DROP CONSTRAINT IF EXISTS unq_avaliacao;
DROP INDEX IF EXISTS unq_avaliacao_ciclo;
DROP INDEX IF EXISTS unq_avaliacao_dev_ia;

CREATE UNIQUE INDEX unq_avaliacao_ciclo ON avaliacoes(ciclo_id, avaliador_id, avaliado_id, tipo)
  WHERE ciclo_id IS NOT NULL;

CREATE UNIQUE INDEX unq_avaliacao_dev_ia ON avaliacoes(desenvolvimento_ia_id, avaliador_id, avaliado_id)
  WHERE desenvolvimento_ia_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_avaliacoes_dev_ia ON avaliacoes(desenvolvimento_ia_id);

-- ─────────────────────────────────────────────
-- 2. RLS: quem pode inserir avaliação tipo 'ti_dev_ia'
-- ─────────────────────────────────────────────
-- Só TI (setor primário ou extra) ou admin/CEO avaliam. Alvo pode ser
-- QUALQUER CEO/gerente/colaborador ligado ao treinamento — seja como
-- auxiliar selecionado, seja como "demais" (todo mundo que não é
-- auxiliar) — exceto admin e o próprio criador do treinamento.
-- Não checa mais pertencimento ao array `auxiliares`: essa lista hoje
-- só decide em qual seção da UI a pessoa aparece (Auxiliares vs Demais),
-- não quem é avaliável.

DROP POLICY IF EXISTS "avaliacoes_insert" ON avaliacoes;
CREATE POLICY "avaliacoes_insert" ON avaliacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    avaliador_id = auth.uid()
    AND (
      tipo <> 'ti_dev_ia'
      OR (
        (auth_is_admin() OR auth_in_setor('ti'))
        AND EXISTS (
          SELECT 1 FROM desenvolvimentos_ia d
          WHERE d.id = avaliacoes.desenvolvimento_ia_id
            AND (d.criador_id IS NULL OR d.criador_id <> avaliacoes.avaliado_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = avaliacoes.avaliado_id AND up.role = 'admin'
        )
      )
    )
  );

-- ─────────────────────────────────────────────
-- 3. RPC: criar_avaliacao_ti_dev_ia (transacional)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION criar_avaliacao_ti_dev_ia(
  p_desenvolvimento_ia_id uuid,
  p_avaliado_id           uuid,
  p_observacao            text,
  p_criterios             jsonb  -- [{categoria, criterio, nota}, ...]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER  -- mantém RLS do avaliador (auth.uid()) e a checagem de auxiliar
SET search_path = public
AS $$
DECLARE
  v_avaliacao_id uuid;
  v_criterio     jsonb;
BEGIN
  INSERT INTO avaliacoes (ciclo_id, avaliador_id, avaliado_id, tipo, observacao, desenvolvimento_ia_id)
  VALUES (NULL, auth.uid(), p_avaliado_id, 'ti_dev_ia', p_observacao, p_desenvolvimento_ia_id)
  RETURNING id INTO v_avaliacao_id;

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

GRANT EXECUTE ON FUNCTION criar_avaliacao_ti_dev_ia(uuid, uuid, text, jsonb) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Como TI, tendo um treinamento concluído com auxiliar X:
--   SELECT criar_avaliacao_ti_dev_ia(
--     '<desenvolvimento_ia_id>', '<id do auxiliar>', 'Foi muito bem',
--     '[{"categoria":"tecnica","criterio":"Domínio técnico","nota":8}]'::jsonb
--   );
--   SELECT * FROM avaliacoes WHERE tipo = 'ti_dev_ia';
--   -- Repetir a mesma chamada deve falhar com unq_avaliacao_dev_ia.
-- =================================================================
