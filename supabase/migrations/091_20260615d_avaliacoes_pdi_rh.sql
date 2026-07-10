-- ============================================================================
-- Avaliações + PDI: setor RH ganha leitura e gestão de PDI cross-setor
-- ============================================================================
-- Decisão de 2026-06-15: todo o setor RH (gerente OU colaborador com 'rh'
-- em setor primário ou em `setores_extras`) deve enxergar avaliações de
-- TODOS os setores e poder propor itens de PDI em qualquer uma. Antes só
-- admin/CEO tinham essa visão cross-setor — gerente RH via só do RH.
--
-- Motivo didático: RH no mundo real consolida avaliações da empresa toda
-- e desenha planos de desenvolvimento. Travar isso no admin/CEO obriga
-- aluno-CEO a fazer o trabalho do RH.
--
-- Por que só leitura+PDI, sem editar/excluir avaliação alheia: RH não é
-- avaliador. Mantemos `avaliacoes_modify` e `avaliacoes_delete` como estão
-- (só admin/CEO). RH consolida e propõe; quem altera a nota original é
-- o avaliador ou o admin/CEO.
--
-- Idempotente. Frente 3 do plano de refino [[project-refinamento-logmax]].
-- ============================================================================

BEGIN;

-- ─── avaliacoes_read: adiciona cláusula RH ─────────────────────────
DROP POLICY IF EXISTS "avaliacoes_read" ON avaliacoes;

CREATE POLICY "avaliacoes_read" ON avaliacoes
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR avaliador_id = auth.uid()
    OR avaliado_id  = auth.uid()
    OR (
      auth_user_role() = 'gerente'
      AND avaliado_id IN (
        SELECT id FROM user_profiles
         WHERE setor = ANY(auth_user_setores())
      )
    )
    -- NOVO: qualquer usuário do RH (gerente ou colaborador) lê tudo.
    OR ('rh' = ANY(auth_user_setores()))
  );

-- ─── pdi_read / pdi_insert / pdi_update / pdi_delete: incluir RH ───
DROP POLICY IF EXISTS "pdi_read"   ON pdi_itens;
DROP POLICY IF EXISTS "pdi_insert" ON pdi_itens;
DROP POLICY IF EXISTS "pdi_update" ON pdi_itens;
DROP POLICY IF EXISTS "pdi_delete" ON pdi_itens;

-- PDI segue visibilidade da avaliação. Com a nova cláusula em
-- `avaliacoes_read` o EXISTS continuaria fechando — mas duplicamos a
-- regra aqui pra clareza (RH abre PDI direto sem depender de pedidos
-- inter-tabela complicados de auditar).
CREATE POLICY "pdi_read" ON pdi_itens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (
           auth_is_admin()
           OR a.avaliador_id = auth.uid()
           OR a.avaliado_id  = auth.uid()
           OR (
             auth_user_role() = 'gerente'
             AND a.avaliado_id IN (
               SELECT id FROM user_profiles
                WHERE setor = ANY(auth_user_setores())
             )
           )
           OR ('rh' = ANY(auth_user_setores()))
         )
    )
  );

-- RH pode adicionar item de PDI a qualquer avaliação que enxerga.
-- Aqui não restringimos ao avaliador — RH é justamente quem propõe
-- ações de desenvolvimento sem ter sido avaliador.
CREATE POLICY "pdi_insert" ON pdi_itens
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (
           auth_is_admin()
           OR a.avaliador_id = auth.uid()
           OR ('rh' = ANY(auth_user_setores()))
         )
    )
  );

CREATE POLICY "pdi_update" ON pdi_itens
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (
           auth_is_admin()
           OR a.avaliador_id = auth.uid()
           OR ('rh' = ANY(auth_user_setores()))
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (
           auth_is_admin()
           OR a.avaliador_id = auth.uid()
           OR ('rh' = ANY(auth_user_setores()))
         )
    )
  );

CREATE POLICY "pdi_delete" ON pdi_itens
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (
           auth_is_admin()
           OR a.avaliador_id = auth.uid()
           OR ('rh' = ANY(auth_user_setores()))
         )
    )
  );

COMMIT;

-- ============================================================================
-- VERIFICAÇÃO
--   -- logado como colaborador RH, deve retornar > 0 com avaliações de outros setores:
--   SELECT count(*) FROM avaliacoes;
--   SELECT count(*) FROM pdi_itens;
-- ============================================================================
