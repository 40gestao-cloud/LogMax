-- =================================================================
-- LogMax — RH por filial (P0 da auditoria RBAC 2026-07-13)
-- =================================================================
-- Régua canônica ([[project_rbac_matriz_filial]]): colaborador vê só o
-- próprio setor da própria filial. Setor RH não pode atravessar filiais.
--
-- Estado antes: coluna `filial` já existia em funcionarios (135),
-- ponto_eletronico (144), ferias/folha_pagamento/afastamentos (138)
-- — mas as policies continuavam `USING(auth_in_setor('rh'))` sem
-- filtro por filial (010) ou `USING(true)` (afastamentos, 085).
-- Consequência: RH da SuperMax lia folha/ponto/férias de MaxLook/TechMax.
--
-- Esta migration:
--   1. Adiciona `filial` em beneficios e treinamentos (por decisão do
--      usuário: cada filial mantém o próprio catálogo).
--   2. Reescreve as policies das 7 tabelas RH com padrão:
--        RH/gerente/admin da filial → opera tudo da filial
--        Colaborador dono → lê o próprio registro (via user_profiles.
--        funcionario_id) em folha/ferias/ponto/afastamentos.
--        Colaborador da filial → lê catálogo (beneficios/treinamentos).
--
-- RPCs impactadas: recalcular_folha_do_ponto é SECURITY DEFINER, ignora
-- RLS — não precisa mudar. Trigger trg_ponto_filial (144) já propaga
-- filial no INSERT em ponto_eletronico automaticamente.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Coluna filial em beneficios e treinamentos
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.beneficios
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_beneficios_filial
  ON public.beneficios (filial);

ALTER TABLE public.treinamentos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

CREATE INDEX IF NOT EXISTS idx_treinamentos_filial
  ON public.treinamentos (filial);

-- ═══════════════════════════════════════════════════════════════════
-- 2. funcionarios
--    RH/gerente/admin da filial operam; colaborador vê o próprio.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "rh_all"        ON public.funcionarios;
DROP POLICY IF EXISTS "rh_filial_all" ON public.funcionarios;
DROP POLICY IF EXISTS "func_self"     ON public.funcionarios;

CREATE POLICY "rh_filial_all" ON public.funcionarios FOR ALL TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "func_self" ON public.funcionarios FOR SELECT TO authenticated
  USING (
    id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════════
-- 3. folha_pagamento
--    RH/gerente/admin da filial operam; colaborador lê a própria.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "rh_all"          ON public.folha_pagamento;
DROP POLICY IF EXISTS "folha_rh_all"    ON public.folha_pagamento;
DROP POLICY IF EXISTS "folha_self_read" ON public.folha_pagamento;

CREATE POLICY "folha_rh_all" ON public.folha_pagamento FOR ALL TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "folha_self_read" ON public.folha_pagamento FOR SELECT TO authenticated
  USING (
    funcionario_id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════════
-- 4. ferias
--    RH/gerente/admin da filial operam; colaborador lê e SOLICITA
--    (INSERT) as próprias.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "rh_all"           ON public.ferias;
DROP POLICY IF EXISTS "ferias_rh_all"    ON public.ferias;
DROP POLICY IF EXISTS "ferias_self_read" ON public.ferias;
DROP POLICY IF EXISTS "ferias_self_ins"  ON public.ferias;

CREATE POLICY "ferias_rh_all" ON public.ferias FOR ALL TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "ferias_self_read" ON public.ferias FOR SELECT TO authenticated
  USING (
    funcionario_id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- Colaborador SOLICITA (INSERT) somente ferias próprias e em status
-- 'Solicitada' — nunca cria já aprovada.
CREATE POLICY "ferias_self_ins" ON public.ferias FOR INSERT TO authenticated
  WITH CHECK (
    funcionario_id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
    AND COALESCE(status, 'Solicitada') = 'Solicitada'
  );

-- ═══════════════════════════════════════════════════════════════════
-- 5. ponto_eletronico
--    RH/gerente/admin da filial operam; colaborador vê e bate o próprio
--    ponto (self-punch mantido do 010).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "ponto_select"        ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_insert"        ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_modify"        ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_delete"        ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_rh_select"     ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_self_select"   ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_rh_insert"     ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_self_insert"   ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_rh_update"     ON public.ponto_eletronico;
DROP POLICY IF EXISTS "ponto_rh_delete"     ON public.ponto_eletronico;

CREATE POLICY "ponto_rh_select" ON public.ponto_eletronico FOR SELECT TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "ponto_self_select" ON public.ponto_eletronico FOR SELECT TO authenticated
  USING (
    funcionario_id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "ponto_rh_insert" ON public.ponto_eletronico FOR INSERT TO authenticated
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "ponto_self_insert" ON public.ponto_eletronico FOR INSERT TO authenticated
  WITH CHECK (
    funcionario_id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "ponto_rh_update" ON public.ponto_eletronico FOR UPDATE TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "ponto_rh_delete" ON public.ponto_eletronico FOR DELETE TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 6. afastamentos
--    Remove USING(true) da 085. RH/gerente/admin da filial escrevem;
--    colaborador lê os próprios.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "afastamentos_read"      ON public.afastamentos;
DROP POLICY IF EXISTS "afastamentos_insert"    ON public.afastamentos;
DROP POLICY IF EXISTS "afastamentos_update"    ON public.afastamentos;
DROP POLICY IF EXISTS "afastamentos_delete"    ON public.afastamentos;
DROP POLICY IF EXISTS "afast_rh_all"           ON public.afastamentos;
DROP POLICY IF EXISTS "afast_self_read"        ON public.afastamentos;

CREATE POLICY "afast_rh_all" ON public.afastamentos FOR ALL TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

CREATE POLICY "afast_self_read" ON public.afastamentos FOR SELECT TO authenticated
  USING (
    funcionario_id = (SELECT funcionario_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════════
-- 7. beneficios (catálogo por filial)
--    RH/gerente/admin da filial escrevem; qualquer autenticado da
--    filial vê (colaborador precisa saber quais benefícios existem).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "rh_all"          ON public.beneficios;
DROP POLICY IF EXISTS "benef_rh_write"  ON public.beneficios;
DROP POLICY IF EXISTS "benef_read"      ON public.beneficios;

CREATE POLICY "benef_read" ON public.beneficios FOR SELECT TO authenticated
  USING (auth_pode_filial(filial));

CREATE POLICY "benef_rh_write" ON public.beneficios FOR ALL TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

-- ═══════════════════════════════════════════════════════════════════
-- 8. treinamentos (catálogo por filial)
--    RH/gerente/admin da filial escrevem; qualquer autenticado da
--    filial vê (colaborador precisa poder se inscrever).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "rh_all"          ON public.treinamentos;
DROP POLICY IF EXISTS "trein_rh_write"  ON public.treinamentos;
DROP POLICY IF EXISTS "trein_read"      ON public.treinamentos;

CREATE POLICY "trein_read" ON public.treinamentos FOR SELECT TO authenticated
  USING (auth_pode_filial(filial));

CREATE POLICY "trein_rh_write" ON public.treinamentos FOR ALL TO authenticated
  USING (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('rh') OR auth_gerente_da(filial))
    AND auth_pode_filial(filial)
  );

COMMIT;
