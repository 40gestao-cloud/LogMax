-- =================================================================
-- LogMax — Notas Recebidas: anexo do documento (PDF/imagem)
-- =================================================================
-- Estende `notas_recebidas` pra guardar o arquivo escaneado/PDF da nota
-- ou recibo original — sem o documento a prestação de contas fica sem
-- comprovação. Matriz consegue baixar/visualizar a partir da aba
-- "Prestação de Contas" no MatrizCapitalView.
--
-- Storage: bucket público `nota-anexos` (ambiente educacional, sem dado
-- sensível real). Limite 2MB, aceita PDF/JPG/PNG/WEBP — os anexos são
-- lidos, não editados; PDF é o formato mais comum de NF/recibo.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Colunas de anexo ──────────────────────────────────────────
ALTER TABLE public.notas_recebidas
  ADD COLUMN IF NOT EXISTS anexo_url      text,
  ADD COLUMN IF NOT EXISTS anexo_nome     text,
  ADD COLUMN IF NOT EXISTS anexo_tamanho  integer;  -- em bytes

-- ─── 2. Bucket público (mesmo padrão de filial-logos) ─────────────
-- 2 MB de teto; aceita PDF + imagens. Servidor bloqueia por MIME
-- allowlist, front repete a validação pra UX (msg amigável antes do
-- upload). Idempotente via ON CONFLICT.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nota-anexos', 'nota-anexos', true, 2097152,
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 3. Policies do bucket ────────────────────────────────────────
-- Padrão canônico de bucket público: SELECT aberto (público), INSERT/
-- UPDATE/DELETE só autenticado — a checagem fina de "quem pode escrever
-- nota da filial X" já roda no RLS de notas_recebidas.
DROP POLICY IF EXISTS "nota_anexos_read" ON storage.objects;
CREATE POLICY "nota_anexos_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'nota-anexos');

DROP POLICY IF EXISTS "nota_anexos_write" ON storage.objects;
CREATE POLICY "nota_anexos_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nota-anexos');

DROP POLICY IF EXISTS "nota_anexos_update" ON storage.objects;
CREATE POLICY "nota_anexos_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'nota-anexos') WITH CHECK (bucket_id = 'nota-anexos');

DROP POLICY IF EXISTS "nota_anexos_delete" ON storage.objects;
CREATE POLICY "nota_anexos_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nota-anexos');

COMMIT;
