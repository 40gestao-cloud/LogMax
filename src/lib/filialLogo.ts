import { supabase } from './supabase';

export const FILIAL_LOGO_BUCKET  = 'filial-logos';
export const FILIAL_LOGO_MAX_BYTES = 120 * 1024;
export const FILIAL_LOGO_MAX_LABEL = '120 KB';
export const FILIAL_LOGO_ACCEPT    = 'image/jpeg,image/jpg,image/png,image/webp,image/svg+xml';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml']);
const ALLOWED_EXT  = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg']);

export function validarLogoFilial(file: File): { ok: boolean; motivo: string; ext: string } {
  const nome   = file.name.toLowerCase();
  const rawExt = nome.includes('.') ? nome.split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt))
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG, WEBP ou SVG.', ext: '' };
  if (file.size > FILIAL_LOGO_MAX_BYTES) {
    const kb = (file.size / 1024).toFixed(1);
    return { ok: false, motivo: `Logo com ${kb} KB — limite é ${FILIAL_LOGO_MAX_LABEL}. Comprima e tente de novo.`, ext: '' };
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
  const slug = filialId ?? (crypto.randomUUID?.() ?? `${Date.now()}`);
  const path = `${slug}/${Date.now()}.${v.ext}`;
  const { error } = await supabase.storage.from(FILIAL_LOGO_BUCKET).upload(path, file, {
    contentType: file.type || `image/${v.ext}`, cacheControl: '3600', upsert: false,
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
