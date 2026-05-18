import { supabase } from './supabase';

export const PRODUTO_IMAGEM_BUCKET = 'produto-imagens';
export const PRODUTO_IMAGEM_MAX_BYTES = 120 * 1024; // 120 KB
export const PRODUTO_IMAGEM_MAX_LABEL = '120 KB';
export const PRODUTO_IMAGEM_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface ValidacaoImagem {
  ok: boolean;
  motivo: string;
  ext: string;
}

export function validarImagemProduto(file: File): ValidacaoImagem {
  const nome = file.name.toLowerCase();
  const rawExt = nome.includes('.') ? nome.split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt)) {
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG ou WEBP.', ext: '' };
  }
  if (file.size > PRODUTO_IMAGEM_MAX_BYTES) {
    const kb = (file.size / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `Imagem com ${kb} KB — o limite é ${PRODUTO_IMAGEM_MAX_LABEL}. Reduza/comprima e tente de novo.`,
      ext: '',
    };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'jpg' };
}

// Extrai o "caminho dentro do bucket" de uma URL pública. Retorna null se a
// URL não pertencer ao bucket de produtos (não tenta apagar nada que não
// seja nosso).
export function extrairPathDoBucket(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${PRODUTO_IMAGEM_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

// Upload + retorno da URL pública. `produtoId` quando disponível dá um path
// estável; cadastros novos usam um UUID temporário.
export async function uploadImagemProduto(
  file: File,
  produtoId?: string | null,
): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const validacao = validarImagemProduto(file);
  if (!validacao.ok) throw new Error(validacao.motivo);

  const slug = produtoId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${slug}/${Date.now()}.${validacao.ext}`;

  const { error: upErr } = await supabase
    .storage
    .from(PRODUTO_IMAGEM_BUCKET)
    .upload(path, file, {
      contentType: file.type || `image/${validacao.ext}`,
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) throw new Error(`Falha ao enviar imagem: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(PRODUTO_IMAGEM_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Imagem enviada, mas a URL pública não foi gerada.');
  return pub.publicUrl;
}

// Remove imagem antiga do bucket. Best-effort — erros são apenas logados
// (a referência na coluna já foi reescrita).
export async function removerImagemAntiga(urlAntiga: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPathDoBucket(urlAntiga);
  if (!path) return;
  const { error } = await supabase.storage.from(PRODUTO_IMAGEM_BUCKET).remove([path]);
  if (error) {
    console.warn('[produtoImagem] falha ao remover imagem antiga:', error.message);
  }
}
