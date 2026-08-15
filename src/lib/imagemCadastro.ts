import { supabase } from './supabase';

// Upload de imagem de cadastro, comum a categoria, fornecedor e serviço.
// Nasceu como `categoriaImagem.ts`, atendendo só as categorias; quando
// fornecedor e serviço passaram a ter imagem, copiar o arquivo três vezes
// significaria três limites de tamanho e três listas de MIME para manter em
// sincronia com as policies do storage. O bucket virou parâmetro.

export const CATEGORIA_IMAGEM_BUCKET = 'categoria-imagens';
/** Logo de fornecedor e imagem de serviço dividem o mesmo bucket (migr. 429). */
export const CADASTRO_IMAGEM_BUCKET  = 'cadastro-imagens';

export const IMAGEM_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
export const IMAGEM_ACCEPT    = 'image/jpeg,image/jpg,image/png,image/webp';

const ALLOWED_MIME = new Set(['image/jpeg','image/jpg','image/png','image/webp']);
const ALLOWED_EXT  = new Set(['jpg','jpeg','png','webp']);

export function validarImagem(file: File): { ok: boolean; motivo: string; ext: string } {
  // SVG excluído intencionalmente (risco XSS se Content-Type mudar no storage).
  // O texto de erro dizia "use JPG, PNG, WEBP ou SVG" e mandava o usuário tentar
  // de novo exatamente com o formato que o bucket recusa.
  const rawExt = file.name.toLowerCase().includes('.')
    ? file.name.toLowerCase().split('.').pop()! : '';
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.has(rawExt))
    return { ok: false, motivo: 'Formato inválido. Use JPG, PNG ou WEBP.', ext: '' };
  if (file.size > IMAGEM_MAX_BYTES) {
    return { ok: false, motivo: `Imagem com ${(file.size/1024).toFixed(0)} KB — limite é 1 MB.`, ext: '' };
  }
  return { ok: true, motivo: '', ext: ALLOWED_EXT.has(rawExt) ? rawExt : 'jpg' };
}

function extrairPath(bucket: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

export async function uploadImagem(bucket: string, file: File, itemId?: string | null): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  const v = validarImagem(file);
  if (!v.ok) throw new Error(v.motivo);
  const slug = itemId ?? crypto.randomUUID();
  const path = `${slug}/${Date.now()}.${v.ext}`;
  const { error } = await supabase.storage.from(bucket)
    .upload(path, file, { contentType: file.type || `image/${v.ext}`, cacheControl: '3600', upsert: false });
  if (error) throw new Error(`Falha ao enviar imagem: ${error.message}`);
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Imagem enviada, mas URL pública não gerada.');
  return pub.publicUrl;
}

export async function removerImagem(bucket: string, urlAntiga: string | null | undefined): Promise<void> {
  if (!supabase) return;
  const path = extrairPath(bucket, urlAntiga);
  if (!path) return;
  await supabase.storage.from(bucket).remove([path]);
}

// ── Identidade visual sem upload ──────────────────────────────────────────────
// Nem todo fornecedor vai ter logo, e um quadrado cinza igual em todos os cards
// não identifica nada. Iniciais + cor derivada do nome dão a cada cadastro um
// bloco distinto de graça — e estável, porque a cor sai de um hash do texto e
// não de um sorteio a cada render.

const PALETA_MONOGRAMA = [
  '#D4AF37','#22c55e','#3b82f6','#06b6d4','#8b5cf6',
  '#ec4899','#ef4444','#f97316','#f59e0b','#14b8a6',
];

export function corDoNome(nome: string | null | undefined): string {
  const s = (nome ?? '').trim();
  if (!s) return '#6b7280';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETA_MONOGRAMA[h % PALETA_MONOGRAMA.length];
}

export function iniciaisDoNome(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  // Ignora conectivos ("Casa de Carnes do Zé" → CC, não CD).
  const uteis = partes.filter(p => !['de','da','do','das','dos','e'].includes(p.toLowerCase()));
  const base = uteis.length > 0 ? uteis : partes;
  return (base[0][0] + (base[1]?.[0] ?? '')).toUpperCase();
}
