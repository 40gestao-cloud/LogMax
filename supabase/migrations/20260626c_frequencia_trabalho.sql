-- Frequência de Trabalho — registro diário de presença/falta/atraso
-- com justificativa, controlado por admin/CEO/gerente de RH.

CREATE TABLE IF NOT EXISTS public.frequencia_trabalho (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id  uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  nome_funcionario text,
  data            date NOT NULL,
  status          text NOT NULL DEFAULT 'Presente'
                  CHECK (status IN ('Presente', 'Falta', 'Presente com Atraso')),
  justificativa   text,
  registrado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  registrado_por_nome  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  ativo           boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_frequencia_func_data_ativo
  ON public.frequencia_trabalho (funcionario_id, data)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_frequencia_data
  ON public.frequencia_trabalho (data);

ALTER TABLE public.frequencia_trabalho ENABLE ROW LEVEL SECURITY;

-- SELECT: RH + admin/CEO (leitura para conferência)
CREATE POLICY frequencia_select ON public.frequencia_trabalho
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
       WHERE u.id = auth.uid()
         AND (
           u.role IN ('admin','ceo')
           OR u.setor = 'rh'
           OR 'rh' = ANY(u.setores_extras)
         )
    )
  );

-- INSERT/UPDATE: RH + admin/CEO
CREATE POLICY frequencia_write ON public.frequencia_trabalho
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
       WHERE u.id = auth.uid()
         AND (
           u.role IN ('admin','ceo')
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
           u.role IN ('admin','ceo')
           OR u.setor = 'rh'
           OR 'rh' = ANY(u.setores_extras)
         )
    )
  );

-- Trigger de auditoria (updated_at)
CREATE OR REPLACE FUNCTION public.frequencia_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frequencia_updated_at ON public.frequencia_trabalho;
CREATE TRIGGER trg_frequencia_updated_at
  BEFORE UPDATE ON public.frequencia_trabalho
  FOR EACH ROW EXECUTE FUNCTION public.frequencia_set_updated_at();
