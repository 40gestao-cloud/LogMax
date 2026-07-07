-- =================================================================
-- Requerimentos: filial cria, Matriz analisa e responde
-- =================================================================
-- Fluxo: Pendente → Em Análise → Aprovado / Negado
-- Upload: imagem ou PDF (bucket requerimentos-arquivos, 5 MB max)
-- =================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.requerimentos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo              text NOT NULL,
  descricao           text,
  arquivo_url         text,
  arquivo_tipo        text CHECK (arquivo_tipo IN ('imagem','pdf')),
  status              text NOT NULL DEFAULT 'Pendente'
                      CHECK (status IN ('Pendente','Em Análise','Aprovado','Negado')),
  criado_por          uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  criado_por_nome     text,
  filial              text,
  resposta            text,
  respondido_por_nome text,
  respondido_em       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS requerimentos_filial_idx  ON public.requerimentos (filial, created_at DESC);
CREATE INDEX IF NOT EXISTS requerimentos_criador_idx ON public.requerimentos (criado_por, created_at DESC);

ALTER TABLE public.requerimentos ENABLE ROW LEVEL SECURITY;

-- SELECT: próprios OU gerente da mesma filial OU admin/CEO/conselheiro
DROP POLICY IF EXISTS requerimentos_select ON public.requerimentos;
CREATE POLICY requerimentos_select ON public.requerimentos
  FOR SELECT TO authenticated
  USING (
    criado_por = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin','ceo','conselheiro')
           OR (p.role = 'gerente' AND p.is_conselheiro = true)
           OR (p.role = 'gerente' AND p.filial = requerimentos.filial)
         )
    )
  );

-- INSERT: qualquer autenticado (colaborador e gerente criam)
DROP POLICY IF EXISTS requerimentos_insert ON public.requerimentos;
CREATE POLICY requerimentos_insert ON public.requerimentos
  FOR INSERT TO authenticated
  WITH CHECK (criado_por = auth.uid());

-- UPDATE (resposta/status): admin/CEO/conselheiro via Matriz
DROP POLICY IF EXISTS requerimentos_update ON public.requerimentos;
CREATE POLICY requerimentos_update ON public.requerimentos
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (p.role IN ('admin','ceo','conselheiro')
              OR (p.role = 'gerente' AND p.is_conselheiro = true))
    )
  );

-- DELETE: admin/CEO apenas
DROP POLICY IF EXISTS requerimentos_delete ON public.requerimentos;
CREATE POLICY requerimentos_delete ON public.requerimentos
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('admin','ceo')
    )
  );

-- Bucket: criar manualmente no Supabase → "requerimentos-arquivos", público, 5 MB max
-- Tipos aceitos: image/jpeg, image/png, image/webp, application/pdf

COMMIT;
