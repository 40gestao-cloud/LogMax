// EAN-13 — encoder em JS puro + render canvas + etiqueta PDF.
// Sem dependências novas (jspdf já no projeto).

const L_CODE = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G_CODE = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R_CODE = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

export function calcEan13Checksum(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits12[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export type NormalizedEan = { digits: string; value: string; valid: boolean; autoCompleted: boolean };

// Aceita 12 (completa checksum) ou 13 (valida checksum). Filtra não-dígitos.
export function normalizeEan13(input: string | null | undefined): NormalizedEan {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 12) {
    const value = digits + calcEan13Checksum(digits);
    return { digits, value, valid: true, autoCompleted: true };
  }
  if (digits.length === 13) {
    const ok = calcEan13Checksum(digits.slice(0, 12)) === parseInt(digits[12], 10);
    return { digits, value: digits, valid: ok, autoCompleted: false };
  }
  return { digits, value: digits, valid: false, autoCompleted: false };
}

// 95 módulos: 3 (guarda) + 42 (esq) + 5 (centro) + 42 (dir) + 3 (guarda).
export function encodeEan13(ean13: string): string {
  if (!/^\d{13}$/.test(ean13)) throw new Error('EAN-13 inválido');
  const first = parseInt(ean13[0], 10);
  const parity = PARITY[first];
  let pattern = '101';
  for (let i = 0; i < 6; i++) {
    const d = parseInt(ean13[i + 1], 10);
    pattern += parity[i] === 'L' ? L_CODE[d] : G_CODE[d];
  }
  pattern += '01010';
  for (let i = 0; i < 6; i++) {
    const d = parseInt(ean13[i + 7], 10);
    pattern += R_CODE[d];
  }
  pattern += '101';
  return pattern;
}

// Guard bars (3 começo + 5 meio + 3 fim) descem um pouco abaixo das barras de dados,
// padrão EAN para facilitar leitura/decoração.
const isGuardModule = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;

// Preview em canvas (in-form). Renderiza com devicePixelRatio para nitidez na tela.
export function drawEan13ToCanvas(
  canvas: HTMLCanvasElement,
  ean13: string,
  opts: { moduleWidth?: number; barHeight?: number; showText?: boolean; fg?: string; bg?: string } = {},
) {
  const moduleWidth = opts.moduleWidth ?? 2;
  const barHeight = opts.barHeight ?? 60;
  const showText = opts.showText ?? true;
  const fg = opts.fg ?? '#000000';
  const bg = opts.bg ?? '#ffffff';
  const quietLeft = 11;
  const quietRight = 7;
  const fontSize = 12;
  const textGap = showText ? fontSize + 2 : 0;
  const guardOverhang = showText ? Math.round(fontSize / 2) : 0;

  const pattern = encodeEan13(ean13);
  const totalModules = pattern.length + quietLeft + quietRight;
  const cssWidth = totalModules * moduleWidth;
  const cssHeight = barHeight + textGap;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.ceil(cssWidth * dpr);
  canvas.height = Math.ceil(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.fillStyle = fg;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      const h = isGuardModule(i) ? barHeight : barHeight - guardOverhang;
      ctx.fillRect((quietLeft + i) * moduleWidth, 0, moduleWidth, h);
    }
  }

  if (showText) {
    ctx.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(ean13[0], 0, cssHeight);
    ctx.textAlign = 'center';
    for (let i = 0; i < 6; i++) {
      const x = (quietLeft + 3 + i * 7 + 3.5) * moduleWidth;
      ctx.fillText(ean13[i + 1], x, cssHeight);
    }
    for (let i = 0; i < 6; i++) {
      const x = (quietLeft + 50 + i * 7 + 3.5) * moduleWidth;
      ctx.fillText(ean13[i + 7], x, cssHeight);
    }
  }
}

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Gera a etiqueta como PDF de página única (80×50 mm) — formato comum de etiqueta adesiva.
// As barras são desenhadas como rectangles vetoriais, garantindo nitidez para o leitor de código de barras.
export async function downloadEan13LabelPdf(opts: {
  ean: string;
  nome?: string;
  codigo?: string;
  preco?: number | null;
  filename?: string;
}) {
  const norm = normalizeEan13(opts.ean);
  if (!norm.valid) throw new Error('EAN-13 inválido — informe 12 ou 13 dígitos.');
  const ean = norm.value;
  const pattern = encodeEan13(ean);

  const { default: jsPDF } = await import('jspdf');

  const W = 80, H = 50;
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });

  // Cabeçalho — nome do produto (truncado se muito longo).
  if (opts.nome) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(opts.nome.length > 42 ? opts.nome.slice(0, 41) + '…' : opts.nome, W / 2, 6, { align: 'center' });
  }

  // Sub-linha: código interno + preço.
  const metaParts: string[] = [];
  if (opts.codigo) metaParts.push(opts.codigo);
  if (opts.preco != null && !Number.isNaN(opts.preco)) metaParts.push(fmtBRL(opts.preco));
  if (metaParts.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(metaParts.join('   ·   '), W / 2, 11, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  // Barras (0.4mm/módulo = ~140% do tamanho nominal; bom para leitores low-end).
  const moduleWidth = 0.4;
  const totalBarsWidth = pattern.length * moduleWidth;
  const barHeight = 22;
  const guardOverhang = 2;
  const barX = (W - totalBarsWidth) / 2;
  const barY = 15;

  doc.setFillColor(0, 0, 0);
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      const h = isGuardModule(i) ? barHeight + guardOverhang : barHeight;
      doc.rect(barX + i * moduleWidth, barY, moduleWidth, h, 'F');
    }
  }

  // Dígitos legíveis abaixo das barras (padrão EAN-13).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const textY = barY + barHeight + guardOverhang + 3;
  doc.text(ean[0], barX - 1.5, textY, { align: 'right' });
  for (let i = 0; i < 6; i++) {
    const x = barX + (3 + i * 7 + 3.5) * moduleWidth;
    doc.text(ean[i + 1], x, textY, { align: 'center' });
  }
  for (let i = 0; i < 6; i++) {
    const x = barX + (50 + i * 7 + 3.5) * moduleWidth;
    doc.text(ean[i + 7], x, textY, { align: 'center' });
  }

  const safe = (opts.filename || `etiqueta-${ean}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`${safe}.pdf`);
}
