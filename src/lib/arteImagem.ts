// Upload da arte promocional — bucket `arte-imagens` (migr. 539).
//
// Irmão de `produtoImagem.ts`, e de propósito: o pedido foi "a imagem com
// qualidade, como está em Cadastro de Produtos". Mesmos formatos, mesmo teto
// de 800 KB depois da recompressão, mesmo aviso de resolução baixa.
//
// A diferença é o destino. A foto do produto aparece no card do PDV e do
// Catálogo; a arte aparece no carrossel da TELA DE LOGIN, que ocupa mais
// espaço na tela e é a primeira coisa que alguém de fora vê. Por isso o lado
// maior sobe para 1920 px e a régua de resolução mínima é mais alta — peça de
// campanha esticada num banner grande fica pior do que miniatura borrada.

import { supabase } from './supabase';
import { resizeImage, extFromMime, lerDimensoesImagem, MAX_INPUT_BYTES, MAX_INPUT_LABEL } from './imageResize';

export const ARTE_IMAGEM_BUCKET = 'arte-imagens';
export const ARTE_IMAGEM_MAX_BYTES = MAX_INPUT_BYTES;
export const ARTE_IMAGEM_MAX_LABEL = MAX_INPUT_LABEL;
export const ARTE_IMAGEM_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';

// Espelha o `file_size_limit` do bucket (migr. 539). `uploadImagemArte` repete
// a recompressão com qualidade menor até caber aqui.
export const ARTE_IMAGEM_OUTPUT_MAX_BYTES = 800 * 1024;
export const ARTE_IMAGEM_OUTPUT_MAX_LABEL = '800 KB';

// Mais alta que a do produto (600): a arte é exibida grande no carrossel.
export const ARTE_IMAGEM_RES_MINIMA = 800;
export const ARTE_IMAGEM_RES_IDEAL = 1200;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface ValidacaoArte {
  ok: boolean;
  motivo: string;
  ext: string;
}

export function validarImagemArte(file: File): ValidacaoArte {
  const nome = file.name.toLowerCase();
  const rawExt = nome.includes('.') ? nome.split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt)) {
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG ou WEBP.', ext: '' };
  }
  if (file.size > ARTE_IMAGEM_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `Arquivo com ${mb} MB — máx. ${ARTE_IMAGEM_MAX_LABEL}. Exporte a arte em resolução menor antes de enviar.`,
      ext: '',
    };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'jpg' };
}

// Aviso, não bloqueio: o resize nunca amplia, então pixel que não veio na
// origem não aparece — mas travar o upload por isso deixaria o aluno sem
// caminho no meio da aula.
export async function avaliarResolucaoArte(file: File): Promise<string | null> {
  const dim = await lerDimensoesImagem(file);
  if (!dim) return null;
  const menorLado = Math.min(dim.width, dim.height);
  if (menorLado >= ARTE_IMAGEM_RES_MINIMA) return null;
  return `Arte de ${dim.width}×${dim.height} px — resolução baixa. Ela vai aparecer borrada no carrossel da tela de login; o ideal é pelo menos ${ARTE_IMAGEM_RES_IDEAL} px no menor lado.`;
}

export function extrairPathDaArte(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${ARTE_IMAGEM_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

/** A URL é nossa (bucket) ou é link externo colado pelo aluno? */
export function ehArteHospedada(url: string | null | undefined): boolean {
  return extrairPathDaArte(url) !== null;
}

export async function uploadImagemArte(file: File, promocaoId?: string | null): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const validacao = validarImagemArte(file);
  if (!validacao.ok) throw new Error(validacao.motivo);

  const optimized = await resizeImage(file, {
    // 1920 e não 1600 do produto: o carrossel do login usa a imagem grande.
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 0.88,
    maxBytes: ARTE_IMAGEM_OUTPUT_MAX_BYTES,
  });
  const ext = extFromMime(optimized.type) || validacao.ext;

  const slug = promocaoId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${slug}/arte-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase
    .storage
    .from(ARTE_IMAGEM_BUCKET)
    .upload(path, optimized, {
      contentType: optimized.type || `image/${ext}`,
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) throw new Error(`Falha ao enviar a arte: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(ARTE_IMAGEM_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Arte enviada, mas a URL pública não foi gerada.');
  return pub.publicUrl;
}

// Best-effort: a coluna já foi reescrita, o arquivo velho é só bytes parados.
// Só remove o que é nosso — link externo não tem o que apagar.
export async function removerArteAntiga(urlAntiga: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPathDaArte(urlAntiga);
  if (!path) return;
  const { error } = await supabase.storage.from(ARTE_IMAGEM_BUCKET).remove([path]);
  if (error) console.warn('[arteImagem] falha ao remover arte antiga:', error.message);
}
