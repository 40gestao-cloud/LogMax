-- =================================================================
-- Evidências de vendas online para ciclos de avaliação
-- =================================================================
-- Colaboradores enviam comprovantes (prints de vendas online) durante
-- um ciclo aberto; avaliadores veem as imagens ao pontuar o avaliado.
--
-- ⚠️  BUCKET MANUAL: criar bucket "evidencias-avaliacao" no Supabase
--     Dashboard (Storage > New bucket) com:
--       - Public bucket: true
--       - Allowed MIME types: image/jpeg, image/png, image/webp
--       - Max upload size: 120 KB (122 880 bytes)
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.evidencias_avaliacao (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id       uuid        NOT NULL REFERENCES public.ciclos_avaliacao(id) ON DELETE CASCADE,
  colaborador_id uuid        NOT NULL REFERENCES public.user_profiles(id)    ON DELETE CASCADE,
  imagem_url     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidencias_ciclo_colab
  ON public.evidencias_avaliacao (ciclo_id, colaborador_id);

ALTER TABLE public.evidencias_avaliacao ENABLE ROW LEVEL SECURITY;

-- Leitura: próprio colaborador, admin/CEO, RH, gerente do setor
CREATE POLICY "evidencias_read" ON public.evidencias_avaliacao
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR colaborador_id = auth.uid()
    OR ('rh' = ANY(auth_user_setores()))
    OR (
      auth_user_role() = 'gerente'
      AND colaborador_id IN (
        SELECT id FROM public.user_profiles
         WHERE setor = ANY(auth_user_setores())
      )
    )
  );

-- Insert: só o próprio colaborador, ciclo deve estar aberto
CREATE POLICY "evidencias_insert" ON public.evidencias_avaliacao
  FOR INSERT TO authenticated
  WITH CHECK (
    colaborador_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ciclos_avaliacao
       WHERE id = ciclo_id AND status = 'Aberto'
    )
  );

-- Delete: próprio colaborador (ciclo aberto) ou admin/CEO
CREATE POLICY "evidencias_delete" ON public.evidencias_avaliacao
  FOR DELETE TO authenticated
  USING (
    auth_is_admin()
    OR (
      colaborador_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.ciclos_avaliacao
         WHERE id = ciclo_id AND status = 'Aberto'
      )
    )
  );

COMMIT;
