-- Frequência de Trabalho: inclui conselheiro nas políticas RLS de leitura e escrita.
-- Conselheiro (role='conselheiro' ou gerente com is_conselheiro=true) precisa
-- registrar frequência como parte da supervisão multi-setor.

BEGIN;

-- SELECT
DROP POLICY IF EXISTS frequencia_select ON public.frequencia_trabalho;
CREATE POLICY frequencia_select ON public.frequencia_trabalho
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
       WHERE u.id = auth.uid()
         AND (
           u.role IN ('admin','ceo','conselheiro')
           OR (u.role = 'gerente' AND u.is_conselheiro = true)
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
           u.role IN ('admin','ceo','conselheiro')
           OR (u.role = 'gerente' AND u.is_conselheiro = true)
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
           u.role IN ('admin','ceo','conselheiro')
           OR (u.role = 'gerente' AND u.is_conselheiro = true)
           OR u.setor = 'rh'
           OR 'rh' = ANY(u.setores_extras)
         )
    )
  );

COMMIT;
