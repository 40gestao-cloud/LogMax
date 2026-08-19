// PDF do mapa de pendências (Modo Aula → Pendências, migr. 477).
//
// O documento é feito para ser IMPRESSO E ENTREGUE à unidade, então a ordem
// das partes segue a de quem vai agir, não a de quem programou:
//
//   1. o painel de números — apurado pelo SQL, é o que se confere;
//   2. a leitura da IA — rotulada como leitura, para ninguém confundir
//      opinião com apuração (mesma separação da Conferência, migr. 472);
//   3. a tabela do que está parado, com quem tem a caneta em cada linha.
//
// A leitura da IA vem DEPOIS dos números de propósito. Se abrisse o relatório,
// o texto viraria a manchete — e a manchete tem que ser o que é verificável.
//
// Mesmo padrão visual dos outros exports (paleta Premium, import dinâmico de
// jsPDF/autoTable, rodapé com paginação).

import { entregarPdf, type PdfDestino } from './maxShowUpload';
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';

export type PendenciaLinha = {
  area: string;
  etapa: string;
  documento: string;
  /** Id do documento na tabela de origem. Serve de chave na lista da tela. */
  documento_id: string;
  filial: string | null;
  onde: string;
  acao: string;
  responsavel: string;
  responsavel_papel: string;
  solicitante: string | null;
  valor: number | null;
  vencimento: string | null;
  dias_parado: number;
  gravidade: string;
};

export type PendenciaLeitura = {
  resumo: string;
  prioridades: { titulo: string; porque: string; quem: string }[];
  padroes: string[];
} | null;

export type PendenciasRelatorio = {
  filial: string | null;
  geradoEm: string;
  linhas: PendenciaLinha[];
  leitura: PendenciaLeitura;
  modeloIA: string;
  /** Quantas linhas a IA leu, quando leu menos que o total. */
  lidasPelaIA: number | null;
};

const BRL = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ROTULO_GRAVIDADE: Record<string, string> = {
  alta: 'Urgente', media: 'Atenção', baixa: 'Na fila',
};

export async function exportPendenciasPDF(
  rel: PendenciasRelatorio,
  filename: string,
  destino: PdfDestino = 'download',
  profile?: { id: string } | null,
  showToast?: (msg: string, tone?: 'success' | 'error' | 'info') => void,
) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const escopo = rel.filial ?? 'Todas as unidades';

  // ─── Cabeçalho ────────────────────────────────────────────────────
  doc.setFillColor(...BLACK);
  doc.rect(0, 0, pageWidth, 30, 'F');
  doc.setFillColor(...GOLD);
  doc.rect(0, 30, pageWidth, 1.2, 'F');
  doc.setTextColor(...GOLD);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', margin, 15);
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY_SOFT);
  doc.setFont('helvetica', 'normal');
  doc.text('O que está parado', margin, 22);
  doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text(escopo, pageWidth - margin, 15, { align: 'right' });
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(rel.geradoEm, pageWidth - margin, 22, { align: 'right' });

  let cursorY = 42;

  // ─── 1. Painel de números (apuração) ──────────────────────────────
  const urgentes = rel.linhas.filter(l => l.gravidade === 'alta').length;
  const atencao  = rel.linhas.filter(l => l.gravidade === 'media').length;
  const soma     = rel.linhas.reduce((t, l) => t + (Number(l.valor) || 0), 0);
  const maisAntiga = rel.linhas.reduce((m, l) => Math.max(m, l.dias_parado || 0), 0);

  const cards: [string, string][] = [
    ['Paradas', String(rel.linhas.length)],
    ['Urgentes', String(urgentes)],
    ['Atenção', String(atencao)],
    ['Valor envolvido', BRL(soma)],
    ['Parada há mais tempo', `${maisAntiga} dia(s)`],
  ];

  const cardW = (pageWidth - margin * 2 - 4 * 3) / 5;
  cards.forEach(([rotulo, valor], i) => {
    const x = margin + i * (cardW + 3);
    doc.setFillColor(...GOLD_TINT);
    doc.rect(x, cursorY, cardW, 16, 'F');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY_MID);
    doc.setFont('helvetica', 'normal');
    doc.text(rotulo.toUpperCase(), x + 2, cursorY + 5);
    doc.setFontSize(valor.length > 12 ? 8 : 11);
    doc.setTextColor(...GRAY_INK);
    doc.setFont('helvetica', 'bold');
    doc.text(valor, x + 2, cursorY + 12);
  });
  cursorY += 24;

  // ─── 2. Leitura da IA (opinião, e rotulada como tal) ──────────────
  if (rel.leitura && (rel.leitura.resumo || rel.leitura.prioridades.length)) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY_INK);
    doc.text('Leitura da IA — por onde começar', margin, cursorY);
    cursorY += 4;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_MID);
    const nota = rel.lidasPelaIA != null && rel.lidasPelaIA < rel.linhas.length
      ? `Opinião gerada por ${rel.modeloIA} sobre ${rel.lidasPelaIA} das ${rel.linhas.length} pendências — os números acima são do sistema.`
      : `Opinião gerada por ${rel.modeloIA}. Os números acima são apurados pelo sistema, não por ela.`;
    doc.text(doc.splitTextToSize(nota, pageWidth - margin * 2), margin, cursorY + 3);
    cursorY += 10;

    if (rel.leitura.resumo) {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY_INK);
      const linhas = doc.splitTextToSize(rel.leitura.resumo, pageWidth - margin * 2);
      doc.text(linhas, margin, cursorY);
      cursorY += linhas.length * 4 + 4;
    }

    rel.leitura.prioridades.forEach((p, i) => {
      if (cursorY > pageHeight - 40) { doc.addPage(); cursorY = 20; }
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...GRAY_INK);
      const tit = doc.splitTextToSize(`${i + 1}. ${p.titulo}`, pageWidth - margin * 2);
      doc.text(tit, margin, cursorY);
      cursorY += tit.length * 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...GRAY_MID);
      if (p.porque) {
        const por = doc.splitTextToSize(p.porque, pageWidth - margin * 2 - 4);
        doc.text(por, margin + 4, cursorY);
        cursorY += por.length * 3.6;
      }
      if (p.quem) {
        const quem = doc.splitTextToSize(`Quem age: ${p.quem}`, pageWidth - margin * 2 - 4);
        doc.text(quem, margin + 4, cursorY);
        cursorY += quem.length * 3.6;
      }
      cursorY += 3;
    });

    if (rel.leitura.padroes.length) {
      if (cursorY > pageHeight - 40) { doc.addPage(); cursorY = 20; }
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...GRAY_INK);
      doc.text('O que se repete', margin, cursorY);
      cursorY += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...GRAY_MID);
      rel.leitura.padroes.forEach(t => {
        const l = doc.splitTextToSize(`• ${t}`, pageWidth - margin * 2);
        doc.text(l, margin, cursorY);
        cursorY += l.length * 3.6 + 1;
      });
      cursorY += 4;
    }
  }

  // ─── 3. A lista, que é o que se confere ───────────────────────────
  if (cursorY > pageHeight - 50) { doc.addPage(); cursorY = 20; }
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GRAY_INK);
  doc.text('O que está parado, item a item', margin, cursorY);
  cursorY += 3;

  autoTable(doc, {
    startY: cursorY + 2,
    head: [['', 'Onde está parado', 'Documento', 'Unid.', 'Dias', 'Valor', 'Quem decide']],
    body: rel.linhas.map(l => [
      ROTULO_GRAVIDADE[l.gravidade] ?? l.gravidade,
      `${l.etapa}\n${l.onde} · ${l.acao}`,
      l.documento + (l.vencimento ? `\nvence ${l.vencimento.split('-').reverse().join('/')}` : ''),
      l.filial ?? '—',
      String(l.dias_parado),
      BRL(l.valor),
      `${l.responsavel}\n(${l.responsavel_papel})`,
    ]),
    theme: 'grid',
    styles: { fontSize: 6.8, cellPadding: 1.6, textColor: GRAY_INK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: BLACK, textColor: GOLD, fontSize: 7, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GOLD_TINT },
    columnStyles: {
      0: { cellWidth: 15, fontStyle: 'bold' },
      1: { cellWidth: 52 },
      2: { cellWidth: 30 },
      3: { cellWidth: 16 },
      4: { cellWidth: 10, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 'auto' },
    },
    // Urgente em vermelho só na coluna do rótulo: pintar a linha inteira
    // deixaria a tabela ilegível quando quase tudo está urgente.
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0) {
        const g = rel.linhas[data.row.index]?.gravidade;
        if (g === 'alta') data.cell.styles.textColor = [190, 30, 30];
        else if (g === 'media') data.cell.styles.textColor = [170, 120, 0];
      }
    },
    margin: { left: margin, right: margin },
  });

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_MID);
    doc.text(`LogMax · O que está parado · ${escopo}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Pendências — ${escopo}`);
}
