import { supabase } from './supabase';

// Anexo de documento fiscal (nota / recibo). Aceita PDF ou imagem —
// diferente de logos, NÃO passa por resize; o PDF fica intacto pra
// leitura. Bucket público, limite 2MB (bate com a migration 223).

export const NOTA_ANEXO_BUCKET     = 'nota-anexos';
export const NOTA_ANEXO_MAX_BYTES  = 2 * 1024 * 1024;
export const NOTA_ANEXO_MAX_LABEL  = '2 MB';
export const NOTA_ANEXO_ACCEPT     = 'application/pdf,image/jpeg,image/jpg,image/png,image/webp';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXT  = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

export function validarAnexoNota(file: File): { ok: boolean; motivo: string; ext: string } {
  const nome   = file.name.toLowerCase();
  const rawExt = nome.includes('.') ? nome.split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt))
    return { ok: false, motivo: 'Formato inválido. Use PDF, JPG, PNG ou WEBP.', ext: '' };
  if (file.size > NOTA_ANEXO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(2);
    return { ok: false, motivo: `Anexo com ${mb} MB — máx. ${NOTA_ANEXO_MAX_LABEL}. Comprima o PDF ou reduza a imagem antes.`, ext: '' };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : (file.type === 'application/pdf' ? 'pdf' : 'jpg') };
}

function extrairPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${NOTA_ANEXO_BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

export async function uploadAnexoNota(
  file: File,
  filial: string,
  notaId?: string | null,
): Promise<{ url: string; nome: string; tamanho: number }> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const v = validarAnexoNota(file);
  if (!v.ok) throw new Error(v.motivo);
  const slugFilial = filial.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'sem-filial';
  const slug = notaId ?? (crypto.randomUUID?.() ?? `${Date.now()}`);
  const path = `${slugFilial}/${slug}/${Date.now()}.${v.ext}`;
  const { error } = await supabase.storage.from(NOTA_ANEXO_BUCKET).upload(path, file, {
    contentType: file.type || `application/${v.ext}`,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(`Falha ao enviar anexo: ${error.message}`);
  const { data: pub } = supabase.storage.from(NOTA_ANEXO_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Anexo enviado mas URL pública não gerada.');
  return { url: pub.publicUrl, nome: file.name, tamanho: file.size };
}

export async function removerAnexoNota(url: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPath(url);
  if (!path) return;
  const { error } = await supabase.storage.from(NOTA_ANEXO_BUCKET).remove([path]);
  if (error) console.warn('[notaAnexo] falha ao remover:', error.message);
}

export function formatarTamanhoAnexo(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
