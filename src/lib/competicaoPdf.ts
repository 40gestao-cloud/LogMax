// Export PDF do resultado da Competição entre Filiais (pódio, votação do
// conselho e vencedora). Placar é a média das notas 0-10 do conselho nas
// Tarefas da Matriz por filial do participante. Mesmo padrão dos outros
// exports do projeto: jsPDF + autoTable em dynamic import pra não inflar
// o bundle.
import { entregarPdf, type PdfDestino } from './maxShowUpload';
import { GOLD, GOLD_DARK, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';

const fmtDataBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');

const markdownToPlainBlocks = (md: string): { bold: boolean; text: string }[] => {
  return md
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const semMarcadores = line
        .replace(/^#{1,3}\s+/, '')
        .replace(/^[-*]\s+/, '• ')
        .replace(/\*\*(.+?)\*\*/g, '$1');
      return { bold: /^#{1,3}\s/.test(line), text: semMarcadores };
    });
};

export type CompeticaoResultadoPDF = {
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: 'em_andamento' | 'aguardando_encerramento' | 'encerrada';
  vencedora: string | null;
  analise_ia: string | null;
};

export type VotoPDF = {
  voto: 'aceita' | 'rejeita';
  filial_escolhida: string | null;
  comentario: string | null;
};

export type PodioLinhaPDF = { filial: string; media: number; n: number };

export async function exportCompeticaoResultadoPDF(
  competicao: CompeticaoResultadoPDF,
  podio: PodioLinhaPDF[],
  votos: VotoPDF[],
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
  const textWidth = pageWidth - margin * 2;

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
  doc.text('COMPETIÇÃO ENTRE FILIAIS — RESULTADO', margin, 21);
  doc.setFontSize(10);
  doc.setTextColor(240, 240, 240);
  doc.text(`${competicao.nome}`, margin, 27);

  doc.setFontSize(8);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 27, { align: 'right' });

  let cursorY = 44;

  const statusLabel = competicao.status === 'em_andamento'
    ? 'Em andamento'
    : competicao.status === 'aguardando_encerramento'
    ? 'Aguardando encerramento'
    : 'Encerrada';
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY_INK);
  doc.text(
    `Período: ${fmtDataBR(competicao.data_inicio)} a ${fmtDataBR(competicao.data_fim)}   ·   Status: ${statusLabel}`,
    margin, cursorY,
  );
  cursorY += 9;

  // ─── Pódio ──────────────────────────────────────────────────────
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text('Pódio', margin, cursorY);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(margin, cursorY + 1.5, margin + 20, cursorY + 1.5);
  cursorY += 7;

  autoTable(doc, {
    startY: cursorY,
    head: [['Posição', 'Filial', 'Notas', 'Média (0-10)']],
    body: podio.map((p, i) => [
      `${i + 1}º`,
      p.filial,
      String(p.n),
      p.n === 0 ? '—' : (p.media / 10).toFixed(1),
    ]),
    theme: 'grid',
    headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { textColor: GRAY_INK, fontSize: 9 },
    alternateRowStyles: { fillColor: GOLD_TINT },
    columnStyles: { 3: { halign: 'center', fontStyle: 'bold' } },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc as any).lastAutoTable.finalY + 8;

  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 15) { doc.addPage(); cursorY = 20; }
  };

  // ─── Votação do conselho ────────────────────────────────────────
  if (votos.length > 0) {
    ensureSpace(20);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BLACK);
    doc.text('Votação do conselho', margin, cursorY);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(margin, cursorY + 1.5, margin + 32, cursorY + 1.5);
    cursorY += 7;

    const aceita = votos.filter(v => v.voto === 'aceita').length;
    const rejeita = votos.filter(v => v.voto === 'rejeita').length;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_INK);
    doc.text(`Aceita: ${aceita}   ·   Rejeita: ${rejeita}   ·   Total de votos: ${votos.length}`, margin, cursorY);
    cursorY += 6;

    autoTable(doc, {
      startY: cursorY,
      head: [['Voto', 'Filial sugerida', 'Comentário']],
      body: votos.map(v => [
        v.voto === 'aceita' ? 'Aceita o placar' : 'Rejeita',
        v.filial_escolhida ?? '—',
        v.comentario ?? '—',
      ]),
      theme: 'grid',
      headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { textColor: GRAY_INK, fontSize: 8.5 },
      alternateRowStyles: { fillColor: GOLD_TINT },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  }

  // ─── Vencedora declarada ────────────────────────────────────────
  if (competicao.status === 'encerrada' && competicao.vencedora) {
    ensureSpace(16);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BLACK);
    doc.text('Vencedora declarada', margin, cursorY);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(margin, cursorY + 1.5, margin + 32, cursorY + 1.5);
    cursorY += 8;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GOLD_DARK);
    doc.text(`🏆 ${competicao.vencedora}`, margin, cursorY);
    cursorY += 10;
  }

  // ─── Análise IA ─────────────────────────────────────────────────
  if (competicao.analise_ia) {
    ensureSpace(16);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BLACK);
    doc.text('Análise IA', margin, cursorY);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(margin, cursorY + 1.5, margin + 22, cursorY + 1.5);
    cursorY += 7;

    const blocks = markdownToPlainBlocks(competicao.analise_ia);
    for (const b of blocks) {
      doc.setFontSize(b.bold ? 10 : 9);
      doc.setFont('helvetica', b.bold ? 'bold' : 'normal');
      doc.setTextColor(b.bold ? 40 : 60, b.bold ? 40 : 60, b.bold ? 40 : 60);
      const lines = doc.splitTextToSize(b.text, textWidth);
      for (const l of lines) {
        ensureSpace(6);
        doc.text(l, margin, cursorY);
        cursorY += 4.5;
      }
      cursorY += 1;
    }
  }

  // Footer: página em todas as páginas.
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_MID);
    doc.text(`LogMax · Competição entre Filiais · ${competicao.nome}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Competição — ${competicao.nome}`);
}
