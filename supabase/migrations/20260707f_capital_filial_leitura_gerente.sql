-- capital_filial: abre leitura para gerente e setor financeiro.
-- Escrita continua restrita a admin/CEO/conselheiro.

BEGIN;

DROP POLICY IF EXISTS capital_filial_select ON public.capital_filial;
CREATE POLICY capital_filial_select ON public.capital_filial
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin','ceo','conselheiro','gerente')
           OR (p.role = 'gerente' AND p.is_conselheiro = true)
           OR p.setor = 'financeiro'
           OR 'financeiro' = ANY(p.setores_extras)
         )
    )
  );

COMMIT;
