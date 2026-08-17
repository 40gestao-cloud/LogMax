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

/**
 * EAN-13 de uso interno da loja, para produto sem código do fabricante — roupa
 * sem etiqueta, seminovo, item a granel.
 *
 * Prefixo 2 é o que a GS1 reserva para isso: não colide com código de
 * fabricante nenhum. Gêmea de `ean13_interno()` no banco (migr. 443), que é
 * quem gera o das variantes abertas pela grade.
 */
export function gerarEanInterno(): string {
  let base = '2';
  for (let i = 0; i < 11; i++) base += Math.floor(Math.random() * 10);
  return base + calcEan13Checksum(base);
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
  /**
   * Tamanho/cor da variante (migr. 445). Sem isto as 6 etiquetas de uma grade
   * saem idênticas — mesmo nome, mesmo preço — e quem etiqueta a arara não tem
   * como saber qual adesivo é do P e qual é do GG.
   */
  variante?: string | null;
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

  // Sub-linha: variante + código interno + preço.
  const metaParts: string[] = [];
  if (opts.variante) metaParts.push(opts.variante);
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

// Desenha grid 2×4 de etiquetas EAN-13 em um doc jsPDF existente.
// Produtos sem EAN válido são silenciosamente omitidos. Retorna a quantidade
// de etiquetas desenhadas. Quando `startOnNewPage`, força addPage() antes da
// primeira etiqueta (use quando o doc já tem conteúdo prévio na página atual).
export function drawEtiquetasGridOnDoc(
  doc: any,
  produtos: Array<{ nome?: string | null; ean?: string | null; codigo?: string | null; preco?: number | null; variante?: string | null }>,
  opts: { titulo?: string; startOnNewPage?: boolean } = {},
): number {
  const items = produtos
    .map(p => ({ ...p, norm: normalizeEan13(p.ean) }))
    .filter(p => p.norm.valid);
  if (items.length === 0) return 0;

  const W = 210;
  const margin = 8;
  const cols = 2, rows = 4;
  const slotW = (W - margin * 2) / cols;
  const slotH = (297 - margin * 2 - 12) / rows; // 12mm reservado para cabeçalho
  const perPage = cols * rows;
  const titulo = opts.titulo ?? 'Catálogo PDV — etiquetas EAN-13';
  const totalPages = Math.ceil(items.length / perPage);

  const drawHeader = (pageIdx: number) => {
    doc.setFillColor(10, 10, 10);
    doc.rect(0, 0, W, 10, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('LogMax', margin, 6.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(titulo, W / 2, 6.5, { align: 'center' });
    doc.setTextColor(140, 140, 140);
    doc.text(`Página ${pageIdx + 1}/${totalPages}`, W - margin, 6.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  const drawSlot = (x: number, y: number, item: typeof items[number]) => {
    const ean = item.norm.value;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.rect(x, y, slotW, slotH);

    if (item.nome) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      const nome = item.nome.length > 38 ? item.nome.slice(0, 37) + '…' : item.nome;
      doc.text(nome, x + slotW / 2, y + 5, { align: 'center' });
    }

    const metaParts: string[] = [];
    if (item.variante) metaParts.push(item.variante);
    if (item.codigo) metaParts.push(item.codigo);
    if (item.preco != null) metaParts.push(fmtBRL(Number(item.preco)));
    if (metaParts.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(metaParts.join('   ·   '), x + slotW / 2, y + 10, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    }

    const pattern = encodeEan13(ean);
    const moduleWidth = 0.35;
    const totalBarsWidth = pattern.length * moduleWidth;
    const barHeight = 18;
    const guardOverhang = 1.5;
    const barX = x + (slotW - totalBarsWidth) / 2;
    const barY = y + 14;

    doc.setFillColor(0, 0, 0);
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '1') {
        const h = isGuardModule(i) ? barHeight + guardOverhang : barHeight;
        doc.rect(barX + i * moduleWidth, barY, moduleWidth, h, 'F');
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const textY = barY + barHeight + guardOverhang + 2.5;
    doc.text(ean[0], barX - 1.2, textY, { align: 'right' });
    for (let i = 0; i < 6; i++) {
      const dx = barX + (3 + i * 7 + 3.5) * moduleWidth;
      doc.text(ean[i + 1], dx, textY, { align: 'center' });
    }
    for (let i = 0; i < 6; i++) {
      const dx = barX + (50 + i * 7 + 3.5) * moduleWidth;
      doc.text(ean[i + 7], dx, textY, { align: 'center' });
    }
  };

  items.forEach((item, idx) => {
    if (idx === 0) {
      if (opts.startOnNewPage) doc.addPage();
    } else if (idx % perPage === 0) {
      doc.addPage();
    }
    if (idx % perPage === 0) drawHeader(Math.floor(idx / perPage));
    const inPage = idx % perPage;
    const col = inPage % cols;
    const row = Math.floor(inPage / cols);
    const x = margin + col * slotW;
    const y = margin + 12 + row * slotH;
    drawSlot(x, y, item);
  });

  return items.length;
}

// Catálogo em PDF — uma página A4 contendo várias etiquetas em grid 2×4
// (8 produtos por página). Cada slot mostra nome, preço, código EAN-13
// numérico e a etiqueta visual com as barras. Produtos sem EAN válido
// são silenciosamente omitidos (não há etiqueta a renderizar).
export async function downloadCatalogoEan13Pdf(opts: {
  produtos: Array<{ nome?: string | null; ean?: string | null; codigo?: string | null; preco?: number | null; variante?: string | null }>;
  filename?: string;
  titulo?: string;
}) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const n = drawEtiquetasGridOnDoc(doc, opts.produtos, {
    titulo: opts.titulo ?? 'Catálogo PDV — etiquetas EAN-13',
    startOnNewPage: false,
  });
  if (n === 0) throw new Error('Nenhum produto com EAN-13 válido para gerar etiquetas.');
  const safe = (opts.filename || 'logmax-catalogo-pdv').replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`${safe}.pdf`);
}
