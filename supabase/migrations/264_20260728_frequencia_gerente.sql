-- Frequência de Trabalho: gerente (qualquer setor) passa a registrar frequência.
--
-- Motivo operacional: quando o colaborador de RH falta, o registro de frequência
-- não pode parar. O gerente da unidade cobre a lacuna. A UI já liberava o gerente
-- (canEdit em FrequenciaTrabalhoView + role='gerente' vê todos os módulos da
-- filial em App.tsx), mas a RLS de 161_20260707d só aceitava gerente COM
-- is_conselheiro=true — quem não era conselheiro batia em erro silencioso.
--
-- Substitui as policies de 161_20260707d_frequencia_rls_conselheiro.sql.
-- Idempotente: pode reaplicar.

BEGIN;

-- ── frequencia_trabalho ─────────────────────────────────────────────────────

-- SELECT
DROP POLICY IF EXISTS frequencia_select ON public.frequencia_trabalho;
CREATE POLICY frequencia_select ON public.frequencia_trabalho
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
       WHERE u.id = auth.uid()
         AND (
           u.role IN ('admin','ceo','conselheiro','gerente')
           OR u.setor = 'rh'
           OR 'rh' = ANY(u.setores_extras)
         )
    )
  );

-- INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS frequencia_write ON public.frequencia_trabalho;
CREATE POLICY frequencia_write ON public.frequencia_trabalho
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
       WHERE u.id = auth.uid()
         AND (
           u.role IN ('admin','ceo','conselheiro','gerente')
           OR u.setor = 'rh'
           OR 'rh' = ANY(u.setores_extras)
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
       WHERE u.id = auth.uid()
         AND (
           u.role IN ('admin','ceo','conselheiro','gerente')
           OR u.setor = 'rh'
           OR 'rh' = ANY(u.setores_extras)
         )
    )
  );

-- ── justificativas_falta ────────────────────────────────────────────────────
-- Sem enxergar a justificativa que o colaborador enviou, o gerente registra
-- falta às cegas. Abre o SELECT para quem já pode lançar frequência.
-- Substitui justfalta_select de 114_20260627_justificativas_falta.sql.
DROP POLICY IF EXISTS "justfalta_select" ON public.justificativas_falta;
CREATE POLICY "justfalta_select" ON public.justificativas_falta
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR funcionario_id = auth.uid()
    OR criado_por = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles u
       WHERE u.id = auth.uid()
         AND (
           u.role = 'gerente'
           OR u.setor = 'rh'
           OR 'rh' = ANY(u.setores_extras)
         )
    )
  );

COMMIT;

-- PostgREST precisa recarregar o schema cache depois de mexer em policies.
NOTIFY pgrst, 'reload schema';
