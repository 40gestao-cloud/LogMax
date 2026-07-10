import { supabase } from './supabase';
import { resizeImage, extFromMime, MAX_INPUT_BYTES, MAX_INPUT_LABEL } from './imageResize';

export const PERFIL_FOTO_BUCKET = 'perfil-fotos';
// Teto bruto de entrada. Depois do resize a foto vira ~20-40 KB WebP 512x512.
export const PERFIL_FOTO_MAX_BYTES = MAX_INPUT_BYTES;
export const PERFIL_FOTO_MAX_LABEL = MAX_INPUT_LABEL;
export const PERFIL_FOTO_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface ValidacaoFoto {
  ok: boolean;
  motivo: string;
  ext: string;
}

export function validarFotoPerfil(file: File): ValidacaoFoto {
  const nome = file.name.toLowerCase();
  const rawExt = nome.includes('.') ? nome.split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt)) {
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG ou WEBP.', ext: '' };
  }
  if (file.size > PERFIL_FOTO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `Imagem com ${mb} MB — máx. ${PERFIL_FOTO_MAX_LABEL}. Reduza antes de enviar.`,
      ext: '',
    };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'jpg' };
}

export function extrairPathDoBucket(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${PERFIL_FOTO_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

// Upload + retorno da URL pública. userId é o dono da foto — usado como
// prefixo do path pra agrupar e facilitar limpeza futura. A imagem passa
// por resize+recompressão (WebP, máx 512x512) antes de subir.
export async function uploadFotoPerfil(file: File, userId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const validacao = validarFotoPerfil(file);
  if (!validacao.ok) throw new Error(validacao.motivo);

  const optimized = await resizeImage(file, { maxWidth: 512, maxHeight: 512 });
  const ext = extFromMime(optimized.type) || validacao.ext;

  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase
    .storage
    .from(PERFIL_FOTO_BUCKET)
    .upload(path, optimized, {
      contentType: optimized.type || `image/${ext}`,
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) throw new Error(`Falha ao enviar foto: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(PERFIL_FOTO_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Foto enviada, mas a URL pública não foi gerada.');
  return pub.publicUrl;
}

export async function removerFotoPerfilAntiga(urlAntiga: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPathDoBucket(urlAntiga);
  if (!path) return;
  const { error } = await supabase.storage.from(PERFIL_FOTO_BUCKET).remove([path]);
  if (error) {
    console.warn('[perfilFoto] falha ao remover foto antiga:', error.message);
  }
}
