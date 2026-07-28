// PDF das Demandas do Conselho (Filiais → Demandas → aba Conselho).
// Espelha os cards da tela: um bloco por tarefa, na mesma ordem (data asc),
// com tipo, título, data, descrição completa, nota da filial e participantes.
//
// Mesmo padrão visual dos demais exports (paleta Premium em pdfPalette,
// dynamic import de jsPDF/autoTable, rodapé com paginação).

import { entregarPdf, type PdfDestino } from './maxShowUpload';
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';

export type DemandaPdfParticipante = { nome: string; media: number | null };
export type DemandaPdfTarefa = {
  tipoLabel: string;
  nome: string;
  data: string;
  descricao: string | null;
  mediaFilial: number | null;
  participantes: DemandaPdfParticipante[];
  outrasFiliais: { filial: string; total: number }[];
};
export type DemandasRelatorio = {
  competicaoNome: string;
  competicaoStatus: string;
  dataInicio: string;
  dataFim: string;
  filial: string | null;
  tarefas: DemandaPdfTarefa[];
};

const fmtDataBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtMedia = (v: number | null) => (v == null ? '—' : v.toFixed(1));

export async function exportDemandasPDF(
  rel: DemandasRelatorio,
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
  doc.text(
    `DEMANDAS DO CONSELHO${rel.filial ? ` — ${rel.filial.toUpperCase()}` : ''}`,
    margin, 21,
  );
  doc.setFontSize(10);
  doc.setTextColor(240, 240, 240);
  doc.text(
    `${rel.competicaoNome}  ·  ${fmtDataBR(rel.dataInicio)} a ${fmtDataBR(rel.dataFim)}  ·  ${rel.competicaoStatus}`,
    margin, 27,
  );

  doc.setFontSize(8);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 27, { align: 'right' });

  let cursorY = 44;
  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 15) { doc.addPage(); cursorY = 20; }
  };

  if (rel.tarefas.length === 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_MID);
    doc.text('Nenhuma tarefa criada nesta competição ainda.', margin, cursorY);
  }

  for (const t of rel.tarefas) {
    // Faixa do tipo — equivalente ao chip colorido no topo do card.
    ensureSpace(30);
    doc.setFillColor(...BLACK);
    doc.rect(margin, cursorY - 5, pageWidth - margin * 2, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GOLD);
    doc.text(t.tipoLabel.toUpperCase(), margin + 2.5, cursorY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_SOFT);
    doc.text(fmtDataBR(t.data), pageWidth - margin - 2.5, cursorY, { align: 'right' });
    cursorY += 9;

    // Título + nota da filial na mesma linha.
    const notaTxt = t.mediaFilial != null ? `Sua nota: ${t.mediaFilial.toFixed(1)}/10` : '';
    const larguraNota = notaTxt ? doc.getTextWidth(notaTxt) + 4 : 0;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY_INK);
    const tituloLinhas = doc.splitTextToSize(t.nome, pageWidth - margin * 2 - larguraNota);
    for (const l of tituloLinhas) {
      ensureSpace(6);
      doc.text(l, margin, cursorY);
      cursorY += 5;
    }
    if (notaTxt) {
      doc.setFontSize(10);
      doc.setTextColor(...GOLD);
      doc.text(notaTxt, pageWidth - margin, cursorY - 5, { align: 'right' });
    }
    cursorY += 1;

    // Descrição completa — o ponto do relatório.
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (t.descricao && t.descricao.trim()) {
      doc.setTextColor(...GRAY_INK);
      const linhas = doc.splitTextToSize(t.descricao.trim(), pageWidth - margin * 2);
      for (const l of linhas) {
        ensureSpace(5);
        doc.text(l, margin, cursorY);
        cursorY += 4.2;
      }
    } else {
      ensureSpace(5);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(...GRAY_MID);
      doc.text('Sem descrição.', margin, cursorY);
      doc.setFont('helvetica', 'normal');
      cursorY += 4.2;
    }
    cursorY += 3;

    if (t.participantes.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [[rel.filial ? `Participantes — ${rel.filial}` : 'Participantes', 'Nota média']],
        body: t.participantes.map(p => [p.nome, fmtMedia(p.media)]),
        theme: 'grid',
        headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { textColor: GRAY_INK, fontSize: 8 },
        alternateRowStyles: { fillColor: GOLD_TINT },
        margin: { left: margin, right: margin },
        columnStyles: { 1: { cellWidth: 26, halign: 'center' } },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 4;
    }

    if (t.outrasFiliais.length > 0) {
      ensureSpace(6);
      doc.setFontSize(7.5);
      doc.setTextColor(...GRAY_MID);
      doc.text(
        `Outras filiais: ${t.outrasFiliais.map(o => `${o.filial} x${o.total}`).join('   ')}`,
        margin, cursorY,
      );
      cursorY += 4;
    }

    cursorY += 5;
  }

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_MID);
    doc.text(`LogMax · Demandas do Conselho · ${rel.competicaoNome}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Demandas do Conselho — ${rel.competicaoNome}`);
}
