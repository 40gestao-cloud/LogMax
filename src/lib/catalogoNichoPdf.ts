// PDF do sorteio de catálogo (Matriz → Conteúdo).
//
// É a folha de trabalho que o aluno usa para cadastrar em Cadastros >
// Produtos: nome, marca, categoria e conteúdo já vêm impressos; código e
// preço ficam em branco de propósito, porque é o aluno quem gera o código
// (botão "Gerar") e decide o preço — o PDF não escreve em `produtos`.
//
// A semente do sorteio vai no rodapé: mesmo sorteio pode ser reproduzido via
// `sortear({ ...opts, semente })` se o professor perder a folha e pedir de
// novo (ver `sorteioCatalogo.ts`).
//
// Mesmo padrão visual dos demais exports (paleta Premium, import dinâmico de
// jsPDF/autoTable, rodapé com paginação).

import { entregarPdf, type PdfDestino } from './maxShowUpload';
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GOLD_TINT } from './pdfPalette';
import { formatarConteudo } from './unidades';
import { todayBR } from './dates';
import type { ItemSorteado } from './sorteioCatalogo';

export async function exportSorteioCatalogoPDF(
  itens: ItemSorteado[],
  semente: number,
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

  const nichos = [...new Set(itens.map(i => i.nicho))].join(' · ') || '—';

  // ─── Cabeçalho premium ────────────────────────────────────────────
  doc.setFillColor(...BLACK);
  doc.rect(0, 0, pageWidth, 30, 'F');
  doc.setFillColor(...GOLD);
  doc.rect(0, 30, pageWidth, 1.2, 'F');
  doc.setTextColor(...GOLD);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', margin, 15);
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY_MID);
  doc.setFont('helvetica', 'normal');
  doc.text('CATÁLOGO — SORTEIO DE CADASTRO', margin, 21);
  doc.setFontSize(10);
  doc.setTextColor(240, 240, 240);
  doc.text(nichos, margin, 27);

  doc.setFontSize(8);
  doc.setTextColor(...GRAY_MID);
  doc.text(`Gerado em: ${todayBR().split('-').reverse().join('/')}`, pageWidth - margin, 27, { align: 'right' });

  const cursorY = 40;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY_INK);
  doc.text(`${itens.length} produto(s) sorteado(s). Marque, cadastre em Cadastros > Produtos e anote código e preço.`, margin, cursorY);

  autoTable(doc, {
    startY: cursorY + 5,
    head: [['', 'Nº', 'Produto', 'Marca', 'Categoria', 'Conteúdo', 'Unid.', 'Código gerado', 'Preço']],
    body: itens.map((i, idx) => [
      '',
      String(idx + 1),
      i.nome,
      i.marca,
      i.categoria,
      formatarConteudo(i.peso, i.pesoUnidade) || '—',
      i.unidade,
      '',
      '',
    ]),
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, textColor: GRAY_INK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: BLACK, textColor: GOLD, fontSize: 7.5, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GOLD_TINT },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 8, halign: 'right' },
      2: { cellWidth: 48 },
      3: { cellWidth: 26 },
      4: { cellWidth: 32 },
      5: { cellWidth: 20 },
      6: { cellWidth: 12 },
      7: { cellWidth: 22 },
      8: { cellWidth: 'auto' },
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
    doc.text(`LogMax · Sorteio de catálogo · semente ${semente}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Sorteio de catálogo — ${nichos}`);
}
