// Resize + recompressão client-side antes do upload.
//
// Objetivo: fotos de celular (2-8 MB, 4000x3000 px) decodificadas ao vivo na
// grade do PDV/thumbs consomem muita RAM. Aqui a gente força um teto de
// dimensões e converte pra WebP (menor a mesma qualidade) — o usuário sobe
// qualquer imagem e o navegador entrega ~30-80 KB pro Supabase.
//
// SVG passa direto (canvas não faz sentido pra vetor).
// Arquivos acima de MAX_INPUT_BYTES são rejeitados antes de decodificar,
// evitando OOM no dispositivo do usuário ao criar o ImageBitmap.

// Teto bruto de entrada — acima disso nem tentamos decodificar.
// 10 MB cobre foto de celular sem ficar apertado.
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_LABEL = '10 MB';

export interface ResizeOptions {
  maxWidth?: number;
  maxHeight?: number;
  /** WebP quality entre 0 e 1. */
  quality?: number;
  /** Formato de saída. Padrão WebP (menor). Use jpeg como fallback se precisar. */
  outputMime?: 'image/webp' | 'image/jpeg';
}

const DEFAULTS: Required<ResizeOptions> = {
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 0.82,
  outputMime: 'image/webp',
};

const isSvg = (file: File): boolean =>
  file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

export function extFromMime(mime: string): string {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/svg+xml') return 'svg';
  return 'bin';
}

function renameFile(file: File, mime: string): string {
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  return `${base}.${extFromMime(mime)}`;
}

// Redimensiona `file` para caber num bounding box e recomprime em WebP.
// Nunca amplia — se a imagem já é menor que o box, só recomprime.
// Retorna o arquivo original inalterado se for SVG.
export async function resizeImage(file: File, opts?: ResizeOptions): Promise<File> {
  if (isSvg(file)) return file;

  if (file.size > MAX_INPUT_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `Imagem com ${mb} MB — máx. ${MAX_INPUT_LABEL}. Reduza antes de enviar.`,
    );
  }

  const { maxWidth, maxHeight, quality, outputMime } = { ...DEFAULTS, ...opts };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível ler a imagem. Verifique se o arquivo não está corrompido.');
  }

  const scale = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const useOffscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Navegador não suporta canvas 2D — atualize o browser.');
  }
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob: Blob = 'convertToBlob' in canvas
    ? await (canvas as OffscreenCanvas).convertToBlob({ type: outputMime, quality })
    : await new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          b => (b ? resolve(b) : reject(new Error('canvas.toBlob devolveu null'))),
          outputMime,
          quality,
        );
      });

  return new File([blob], renameFile(file, outputMime), {
    type: outputMime,
    lastModified: Date.now(),
  });
}
