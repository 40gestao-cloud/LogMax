// =================================================================
// Max Docs — exportadores DOCX e PDF (a partir de HTML do documento)
// =================================================================
// Trabalha a partir do HTML salvo em max_docs.conteudo — assim funciona
// direto na lista sem abrir o editor. DOMParser + walker constroem uma
// arvore de Paragraph para a lib `docx`.
// PDF via iframe oculto + window.print() (0 KB extra).
// =================================================================

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, convertInchesToTwip,
} from 'docx';

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
};

const ALIGN_MAP: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};

type Ctx = {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  sub?: boolean; sup?: boolean; highlight?: string;
  color?: string; font?: string; sizeHalfPt?: number;
};

function parseStyle(style: string | undefined): Partial<Ctx> {
  if (!style) return {};
  const out: Partial<Ctx> = {};
  const decls = style.split(';');
  for (const d of decls) {
    const [k, ...rest] = d.split(':');
    if (!k || !rest.length) continue;
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'color') out.color = val.replace('#', '').slice(0, 6);
    else if (key === 'font-family') out.font = val.replace(/["']/g, '').split(',')[0].trim();
    else if (key === 'font-size') {
      const px = parseFloat(val);
      if (!Number.isNaN(px)) out.sizeHalfPt = Math.round(px * 1.5) * 2; // px→pt≈*0.75, half-points *2
    }
    else if (key === 'background-color' && val && val !== 'transparent') out.highlight = 'yellow';
  }
  return out;
}

function collectRuns(node: Node, ctx: Ctx, runs: TextRun[]) {
  if (node.nodeType === 3) { // text
    const text = node.textContent ?? '';
    if (!text) return;
    runs.push(new TextRun({
      text,
      bold: ctx.bold, italics: ctx.italic,
      underline: ctx.underline ? {} : undefined,
      strike: ctx.strike,
      subScript: ctx.sub, superScript: ctx.sup,
      color: ctx.color, font: ctx.font, size: ctx.sizeHalfPt,
      highlight: ctx.highlight,
    } as any));
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') { runs.push(new TextRun({ text: '', break: 1 })); return; }
  const next: Ctx = { ...ctx, ...parseStyle(el.getAttribute('style') || undefined) };
  if (tag === 'strong' || tag === 'b') next.bold = true;
  else if (tag === 'em' || tag === 'i') next.italic = true;
  else if (tag === 'u') next.underline = true;
  else if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true;
  else if (tag === 'sub') next.sub = true;
  else if (tag === 'sup') next.sup = true;
  else if (tag === 'mark') next.highlight = 'yellow';
  for (const child of Array.from(el.childNodes)) collectRuns(child, next, runs);
}

function blockAlign(el: HTMLElement) {
  const align = (parseStyle(el.getAttribute('style') || undefined) as any).textAlign
    ?? el.style.textAlign
    ?? el.getAttribute('data-text-align');
  return ALIGN_MAP[String(align || '').toLowerCase()] || undefined;
}

function blockLineHeight(el: HTMLElement) {
  const lh = el.style.lineHeight;
  if (!lh) return undefined;
  const n = parseFloat(lh);
  return Number.isNaN(n) ? undefined : { line: Math.round(n * 240) };
}

function paragraphsFromBlock(el: HTMLElement, listCtx?: { kind: 'bullet' | 'ordered'; level: number }): Paragraph[] {
  const tag = el.tagName.toLowerCase();
  const align = blockAlign(el);
  const spacing = blockLineHeight(el);

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    const runs: TextRun[] = [];
    collectRuns(el, {}, runs);
    return [new Paragraph({ children: runs, heading: HEADING_MAP[level], alignment: align, spacing })];
  }
  if (tag === 'p' || tag === 'div') {
    const runs: TextRun[] = [];
    collectRuns(el, {}, runs);
    return [new Paragraph({
      children: runs, alignment: align, spacing,
      ...(listCtx?.kind === 'bullet' ? { bullet: { level: listCtx.level } } : {}),
      ...(listCtx?.kind === 'ordered' ? { numbering: { reference: 'ord', level: listCtx.level } } : {}),
    })];
  }
  if (tag === 'blockquote') {
    const out: Paragraph[] = [];
    for (const child of Array.from(el.children)) {
      out.push(...paragraphsFromBlock(child as HTMLElement).map(p =>
        new Paragraph({
          children: (p as any).options?.children ?? [],
          indent: { left: convertInchesToTwip(0.5) },
          alignment: align,
        })
      ));
    }
    return out;
  }
  if (tag === 'ul' || tag === 'ol') {
    const kind = tag === 'ul' ? 'bullet' : 'ordered';
    const level = (listCtx?.level ?? -1) + 1;
    const out: Paragraph[] = [];
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      let handled = false;
      // Se o li contem apenas listas aninhadas, delega
      for (const child of Array.from(li.children)) {
        const ct = child.tagName.toLowerCase();
        if (ct === 'ul' || ct === 'ol') {
          out.push(...paragraphsFromBlock(child as HTMLElement, { kind: ct === 'ul' ? 'bullet' : 'ordered', level }));
        }
      }
      // Constroi um paragrafo com o texto direto do li (excluindo listas aninhadas ja processadas acima)
      const runs: TextRun[] = [];
      for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === 1) {
          const ct = (child as HTMLElement).tagName.toLowerCase();
          if (ct === 'ul' || ct === 'ol') continue;
          if (ct === 'p') { collectRuns(child, {}, runs); continue; }
        }
        collectRuns(child, {}, runs);
      }
      if (runs.length) {
        out.push(new Paragraph({
          children: runs,
          ...(kind === 'bullet' ? { bullet: { level } } : { numbering: { reference: 'ord', level } }),
        }));
        handled = true;
      }
      if (!handled && out.length === 0) {
        out.push(new Paragraph({ children: [new TextRun('')] }));
      }
    }
    return out;
  }
  // Elemento desconhecido: mescla runs num paragrafo unico
  const runs: TextRun[] = [];
  collectRuns(el, {}, runs);
  return runs.length ? [new Paragraph({ children: runs, alignment: align, spacing })] : [];
}

export async function exportDocx(titulo: string, html: string) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
  const body = doc.body;
  const paragraphs: Paragraph[] = [];
  for (const child of Array.from(body.children)) {
    paragraphs.push(...paragraphsFromBlock(child as HTMLElement));
  }
  const docxDoc = new Document({
    numbering: {
      config: [{
        reference: 'ord',
        levels: [0, 1, 2, 3].map(lvl => ({
          level: lvl,
          format: LevelFormat.DECIMAL,
          text: `%${lvl + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.5 * (lvl + 1)), hanging: convertInchesToTwip(0.25) } } },
        })),
      }],
    },
    sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph({})] }],
  });
  const blob = await Packer.toBlob(docxDoc);
  triggerDownload(blob, `${sanitize(titulo)}.docx`);
}

// PDF via iframe oculto: injeta o HTML com CSS de papel A4 e imprime.
// Usuario escolhe "Salvar como PDF" no dialogo de impressao do navegador.
export function exportPdf(titulo: string, html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sanitize(titulo))}</title>
    <style>
      @page { size: A4; margin: 20mm; }
      html, body { margin: 0; padding: 0; background: #fff; color: #000; }
      body { font-family: 'Calibri', 'Segoe UI', system-ui, sans-serif; font-size: 15px; line-height: 1.6; }
      h1 { font-size: 2em; font-weight: 700; margin: 0.75em 0 0.5em; line-height: 1.25; }
      h2 { font-size: 1.5em; font-weight: 700; margin: 0.75em 0 0.5em; line-height: 1.3; }
      h3 { font-size: 1.2em; font-weight: 700; margin: 0.75em 0 0.5em; line-height: 1.35; }
      p  { margin: 0 0 0.75em; }
      ul { list-style: disc; padding-left: 1.75em; margin: 0 0 0.75em; }
      ol { list-style: decimal; padding-left: 1.75em; margin: 0 0 0.75em; }
      li { margin: 0.15em 0; } li p { margin: 0; }
      blockquote { padding: 0.25em 0 0.25em 1em; margin: 0.5em 0 1em; font-style: italic; border-left: 3px solid #aaa; }
      u { text-decoration: underline; } s { text-decoration: line-through; }
      mark { background: #ffeb3b; padding: 0 0.15em; }
      code { font-family: 'Consolas', monospace; background: #eee; padding: 0.1em 0.35em; border-radius: 3px; }
    </style></head><body>${html || '<p></p>'}</body></html>`);
  doc.close();
  const cleanup = () => { setTimeout(() => iframe.remove(), 250); };
  const win = iframe.contentWindow!;
  const doPrint = () => {
    try {
      win.focus();
      win.print();
    } finally { cleanup(); }
  };
  // Espera o layout terminar
  if (doc.readyState === 'complete') doPrint();
  else win.addEventListener('load', doPrint, { once: true });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function sanitize(name: string) {
  return (name?.trim() || 'documento').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}
