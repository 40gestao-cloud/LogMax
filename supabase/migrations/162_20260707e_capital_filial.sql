-- =================================================================
-- Capital por filial (modo Matriz)
-- =================================================================
-- Histório de aportes de capital por filial.
-- O valor corrente de cada filial é o registro mais recente.
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.capital_filial (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial              text NOT NULL CHECK (filial IN ('SuperMax','MaxLook','TechMax')),
  valor               numeric(15,2) NOT NULL CHECK (valor >= 0),
  registrado_por      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  registrado_por_nome text,
  observacao          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capital_filial_filial_idx ON public.capital_filial (filial, created_at DESC);

ALTER TABLE public.capital_filial ENABLE ROW LEVEL SECURITY;

-- Leitura: admin/CEO/conselheiro
DROP POLICY IF EXISTS capital_filial_select ON public.capital_filial;
CREATE POLICY capital_filial_select ON public.capital_filial
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (p.role IN ('admin','ceo','conselheiro')
              OR (p.role = 'gerente' AND p.is_conselheiro = true))
    )
  );

-- Inserção: admin/CEO/conselheiro
DROP POLICY IF EXISTS capital_filial_insert ON public.capital_filial;
CREATE POLICY capital_filial_insert ON public.capital_filial
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (p.role IN ('admin','ceo','conselheiro')
              OR (p.role = 'gerente' AND p.is_conselheiro = true))
    )
  );

-- Exclusão de registros: apenas admin/CEO
DROP POLICY IF EXISTS capital_filial_delete ON public.capital_filial;
CREATE POLICY capital_filial_delete ON public.capital_filial
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('admin','ceo')
    )
  );

COMMIT;
