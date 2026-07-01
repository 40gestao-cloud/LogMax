import { supabase } from './supabase';

export const CATEGORIA_IMAGEM_BUCKET   = 'categoria-imagens';
export const CATEGORIA_IMAGEM_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
export const CATEGORIA_IMAGEM_ACCEPT    = 'image/jpeg,image/jpg,image/png,image/webp,image/svg+xml';

const ALLOWED_MIME = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/svg+xml']);
const ALLOWED_EXT  = new Set(['jpg','jpeg','png','webp','svg']);

export function validarImagemCategoria(file: File): { ok: boolean; motivo: string; ext: string } {
  const rawExt = file.name.toLowerCase().includes('.')
    ? file.name.toLowerCase().split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt))
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG, WEBP ou SVG.', ext: '' };
  if (file.size > CATEGORIA_IMAGEM_MAX_BYTES) {
    return { ok: false, motivo: `Imagem com ${(file.size/1024).toFixed(0)} KB — limite é 1 MB.`, ext: '' };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'jpg' };
}

function extrairPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${CATEGORIA_IMAGEM_BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

export async function uploadImagemCategoria(file: File, itemId?: string | null): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const v = validarImagemCategoria(file);
  if (!v.ok) throw new Error(v.motivo);
  const slug = itemId ?? crypto.randomUUID();
  const path = `${slug}/${Date.now()}.${v.ext}`;
  const { error } = await supabase.storage.from(CATEGORIA_IMAGEM_BUCKET)
    .upload(path, file, { contentType: file.type || `image/${v.ext}`, cacheControl: '3600', upsert: false });
  if (error) throw new Error(`Falha ao enviar imagem: ${error.message}`);
  const { data: pub } = supabase.storage.from(CATEGORIA_IMAGEM_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Imagem enviada, mas URL pública não gerada.');
  return pub.publicUrl;
}

export async function removerImagemCategoria(urlAntiga: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPath(urlAntiga);
  if (!path) return;
  await supabase.storage.from(CATEGORIA_IMAGEM_BUCKET).remove([path]);
}
