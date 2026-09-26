import { supabase } from './supabase';
import { resizeImage, extFromMime, lerDimensoesImagem, MAX_INPUT_BYTES, MAX_INPUT_LABEL } from './imageResize';

export const PRODUTO_IMAGEM_BUCKET = 'produto-imagens';
// Teto bruto de entrada (compatibilidade com imports antigos). Depois do
// resize client-side o arquivo real gravado no bucket fica abaixo de
// PRODUTO_IMAGEM_OUTPUT_MAX_BYTES.
export const PRODUTO_IMAGEM_MAX_BYTES = MAX_INPUT_BYTES;
export const PRODUTO_IMAGEM_MAX_LABEL = MAX_INPUT_LABEL;
export const PRODUTO_IMAGEM_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';
// Teto real do arquivo já comprimido — espelha o file_size_limit do bucket
// (migration 248_20260724_produto_imagem_qualidade.sql). uploadImagemProduto
// repete o resize com qualidade/dimensão menores até caber aqui. Subiu de
// 100 KB → 800 KB em 2026-07-24 pra fotos boas na Vitrine Pública.
export const PRODUTO_IMAGEM_OUTPUT_MAX_BYTES = 800 * 1024;
export const PRODUTO_IMAGEM_OUTPUT_MAX_LABEL = '800 KB';
// Até 3 imagens por produto: capa (slot 1, coluna imagem_url) + 2 extras.
export const PRODUTO_IMAGEM_MAX_SLOTS = 3;

// Miniatura irmã de cada foto, gravada no mesmo upload: `img1-123.webp` ganha
// `img1-123.thumb.webp` ao lado. Existe porque o card mostra ~200 px e baixava a
// original de 1600 px — 42 capas somavam 8 MB numa página do Catálogo. O plano
// Free da Supabase não tem transformação de imagem (`/render/image`), então a
// versão pequena precisa existir como arquivo.
//
// Não há coluna nova: a URL da miniatura sai da URL da foto por convenção.
// Foto antiga sem miniatura cai na original pelo onError do componente.
export const PRODUTO_MINIATURA_LADO = 480;
const SUFIXO_MINIATURA = '.thumb.webp';

export function urlMiniatura(url: string | null | undefined): string | null {
  if (!url || !url.includes(`/object/public/${PRODUTO_IMAGEM_BUCKET}/`)) return null;
  const semQuery = url.split('?')[0];
  if (semQuery.endsWith(SUFIXO_MINIATURA)) return semQuery;
  const ponto = semQuery.lastIndexOf('.');
  if (ponto <= semQuery.lastIndexOf('/')) return null;
  return semQuery.slice(0, ponto) + SUFIXO_MINIATURA;
}

// Path é único (leva Date.now()), então o arquivo nunca muda sob o mesmo
// endereço: pode ficar um ano no cache do navegador. Era 3600 — cada aluno
// baixava tudo de novo a cada hora.
const CACHE_IMUTAVEL = '31536000';

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
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `Imagem com ${mb} MB — máx. ${PRODUTO_IMAGEM_MAX_LABEL}. Reduza antes de enviar.`,
      ext: '',
    };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'jpg' };
}

// Abaixo desse menor lado (px) a foto aparece esticada no card do Catálogo e
// principalmente na Vitrine Pública. Não bloqueia o upload — só avisa, porque
// o resize nunca amplia: pixel que não veio na origem não tem como aparecer.
export const PRODUTO_IMAGEM_RES_MINIMA = 600;
export const PRODUTO_IMAGEM_RES_IDEAL = 1000;

// Devolve o texto do aviso de baixa resolução, ou null se a imagem estiver boa
// (ou se não der pra ler as dimensões — nesse caso não atrapalha o upload).
export async function avaliarResolucaoImagem(file: File): Promise<string | null> {
  const dim = await lerDimensoesImagem(file);
  if (!dim) return null;
  const menorLado = Math.min(dim.width, dim.height);
  if (menorLado >= PRODUTO_IMAGEM_RES_MINIMA) return null;
  return `Imagem de ${dim.width}×${dim.height} px — resolução baixa. Ela vai aparecer borrada no Catálogo e na Vitrine; o ideal é pelo menos ${PRODUTO_IMAGEM_RES_IDEAL} px no menor lado.`;
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
// estável; cadastros novos usam um UUID temporário. A imagem passa por
// resize+recompressão client-side antes de subir (WebP, máx 1024x1024,
// reduzindo qualidade/dimensão até caber em PRODUTO_IMAGEM_OUTPUT_MAX_BYTES).
// `slot` (1-3) distingue capa e imagens extras no path do bucket.
export async function uploadImagemProduto(
  file: File,
  produtoId?: string | null,
  slot: number = 1,
): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const validacao = validarImagemProduto(file);
  if (!validacao.ok) throw new Error(validacao.motivo);

  const optimized = await resizeImage(file, {
    // 1600 px cobre bem o card do PDV/Catálogo e ainda dá zoom decente
    // na Vitrine Pública sem estourar o teto de 800 KB.
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.88,
    maxBytes: PRODUTO_IMAGEM_OUTPUT_MAX_BYTES,
  });
  const ext = extFromMime(optimized.type) || validacao.ext;

  const slug = produtoId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${slug}/img${slot}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase
    .storage
    .from(PRODUTO_IMAGEM_BUCKET)
    .upload(path, optimized, {
      contentType: optimized.type || `image/${ext}`,
      cacheControl: CACHE_IMUTAVEL,
      upsert: false,
    });
  if (upErr) throw new Error(`Falha ao enviar imagem: ${upErr.message}`);

  // Best-effort: sem miniatura a tela usa a original, só mais devagar.
  try {
    const mini = await resizeImage(optimized as File, {
      maxWidth: PRODUTO_MINIATURA_LADO,
      maxHeight: PRODUTO_MINIATURA_LADO,
      quality: 0.8,
      outputMime: 'image/webp',
      maxBytes: 80 * 1024,
    });
    const pathMini = path.slice(0, path.lastIndexOf('.')) + SUFIXO_MINIATURA;
    await supabase.storage.from(PRODUTO_IMAGEM_BUCKET).upload(pathMini, mini, {
      contentType: 'image/webp', cacheControl: CACHE_IMUTAVEL, upsert: true,
    });
  } catch (e) {
    console.warn('[produtoImagem] miniatura não gerada:', (e as Error).message);
  }

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
  const mini = urlMiniatura(urlAntiga);
  const pathMini = mini ? extrairPathDoBucket(mini) : null;
  const { error } = await supabase.storage.from(PRODUTO_IMAGEM_BUCKET).remove(pathMini ? [path, pathMini] : [path]);
  if (error) {
    console.warn('[produtoImagem] falha ao remover imagem antiga:', error.message);
  }
}
