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
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';
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
  /** Professor removeu linha à mão depois de sortear — a semente deixa de reproduzir ESTA folha. */
  ajustadoAMao = false,
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
  doc.setTextColor(...GRAY_SOFT);
  doc.setFont('helvetica', 'normal');
  doc.text('CATÁLOGO — SORTEIO DE CADASTRO', margin, 21);
  doc.setFontSize(10);
  doc.setTextColor(240, 240, 240);
  doc.text(nichos, margin, 27);

  doc.setFontSize(8);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(`Gerado em: ${todayBR().split('-').reverse().join('/')}`, pageWidth - margin, 27, { align: 'right' });

  let cursorY = 40;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY_INK);
  doc.text(`${itens.length} produto(s) sorteado(s). Marque, cadastre em Cadastros > Produtos e anote código e preço.`, margin, cursorY);

  // A semente é o que permite reimprimir a folha perdida. Se o professor tirou
  // linhas depois de sortear, ela reproduz o sorteio ORIGINAL — outra folha.
  // Dizer isso na cara do documento é mais barato que descobrir na aula.
  if (ajustadoAMao) {
    cursorY += 5;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_MID);
    doc.text('Lista ajustada à mão após o sorteio — a semente reproduz o sorteio original, não esta folha.', margin, cursorY);
    doc.setFont('helvetica', 'normal');
  }

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
    // A4 retrato com margem 14 dos dois lados = 182 mm úteis. As oito colunas
    // fixas somam 162 e sobram 20 para "Preço" — as duas últimas são campos
    // que o ALUNO preenche à caneta, então precisam de espaço de escrita, não
    // do resto que sobrou. Uma versão anterior somava 176 de largura fixa e
    // espremia "Preço" em 6 mm.
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 8, halign: 'right' },
      2: { cellWidth: 46 },
      3: { cellWidth: 24 },
      4: { cellWidth: 28 },
      5: { cellWidth: 16 },
      6: { cellWidth: 11 },
      7: { cellWidth: 21 },
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
    doc.text(`LogMax · Sorteio de catálogo · semente ${semente}${ajustadoAMao ? ' (ajustada)' : ''}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Sorteio de catálogo — ${nichos}`);
}
