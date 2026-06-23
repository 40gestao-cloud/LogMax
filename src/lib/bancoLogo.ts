import { supabase } from './supabase';

export const BANCO_LOGO_BUCKET = 'banco-logos';
export const BANCO_LOGO_MAX_BYTES = 120 * 1024; // 120 KB
export const BANCO_LOGO_MAX_LABEL = '120 KB';
export const BANCO_LOGO_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,image/svg+xml';

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml',
]);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg']);

export interface ValidacaoLogo {
  ok: boolean;
  motivo: string;
  ext: string;
}

export function validarLogoBanco(file: File): ValidacaoLogo {
  const nome = file.name.toLowerCase();
  const rawExt = nome.includes('.') ? nome.split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt)) {
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG, WEBP ou SVG.', ext: '' };
  }
  if (file.size > BANCO_LOGO_MAX_BYTES) {
    const kb = (file.size / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `Logo com ${kb} KB — o limite é ${BANCO_LOGO_MAX_LABEL}. Reduza/comprima e tente de novo.`,
      ext: '',
    };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'png' };
}

export function extrairPathDoBucket(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${BANCO_LOGO_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export async function uploadLogoBanco(file: File, bancoId?: string | null): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const validacao = validarLogoBanco(file);
  if (!validacao.ok) throw new Error(validacao.motivo);

  const slug = bancoId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${slug}/${Date.now()}.${validacao.ext}`;

  const { error: upErr } = await supabase
    .storage
    .from(BANCO_LOGO_BUCKET)
    .upload(path, file, {
      contentType: file.type || `image/${validacao.ext}`,
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) throw new Error(`Falha ao enviar logo: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(BANCO_LOGO_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Logo enviada, mas a URL pública não foi gerada.');
  return pub.publicUrl;
}

export async function removerLogoAntiga(urlAntiga: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPathDoBucket(urlAntiga);
  if (!path) return;
  const { error } = await supabase.storage.from(BANCO_LOGO_BUCKET).remove([path]);
  if (error) {
    console.warn('[bancoLogo] falha ao remover logo antiga:', error.message);
  }
}
