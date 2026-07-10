import { supabase } from './supabase';
import { resizeImage, extFromMime, MAX_INPUT_BYTES, MAX_INPUT_LABEL } from './imageResize';

export const FILIAL_LOGO_BUCKET  = 'filial-logos';
// Teto bruto de entrada. Raster passa por resize (WebP 512x512).
// SVG passa direto — canvas não faz sentido pra vetor.
export const FILIAL_LOGO_MAX_BYTES = MAX_INPUT_BYTES;
export const FILIAL_LOGO_MAX_LABEL = MAX_INPUT_LABEL;
export const FILIAL_LOGO_ACCEPT    = 'image/jpeg,image/jpg,image/png,image/webp,image/svg+xml';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml']);
const ALLOWED_EXT  = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg']);

export function validarLogoFilial(file: File): { ok: boolean; motivo: string; ext: string } {
  const nome   = file.name.toLowerCase();
  const rawExt = nome.includes('.') ? nome.split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt))
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG, WEBP ou SVG.', ext: '' };
  if (file.size > FILIAL_LOGO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, motivo: `Logo com ${mb} MB — máx. ${FILIAL_LOGO_MAX_LABEL}. Reduza antes de enviar.`, ext: '' };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'png' };
}

function extrairPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${FILIAL_LOGO_BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

export async function uploadLogoFilial(file: File, filialId?: string | null): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const v = validarLogoFilial(file);
  if (!v.ok) throw new Error(v.motivo);
  const optimized = await resizeImage(file, { maxWidth: 512, maxHeight: 512 });
  const ext = extFromMime(optimized.type) || v.ext;
  const slug = filialId ?? (crypto.randomUUID?.() ?? `${Date.now()}`);
  const path = `${slug}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(FILIAL_LOGO_BUCKET).upload(path, optimized, {
    contentType: optimized.type || `image/${ext}`, cacheControl: '3600', upsert: false,
  });
  if (error) throw new Error(`Falha ao enviar logo: ${error.message}`);
  const { data: pub } = supabase.storage.from(FILIAL_LOGO_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Logo enviada mas URL pública não gerada.');
  return pub.publicUrl;
}

export async function removerLogoFilial(url: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPath(url);
  if (!path) return;
  const { error } = await supabase.storage.from(FILIAL_LOGO_BUCKET).remove([path]);
  if (error) console.warn('[filialLogo] falha ao remover logo:', error.message);
}
