// PDF da Atividade da aula.
//
// Um só gerador para os dois lados: o professor baixa antes de enviar e o
// aluno baixa o que recebeu. É o que dispensa guardar arquivo — a tabela
// `aula_atividades` guarda o roteiro em jsonb e o PDF é remontado aqui, no
// cliente, em qualquer um dos dois.
//
// Mesmo padrão visual dos demais exports (paleta Premium em pdfPalette,
// dynamic import de jsPDF/autoTable, rodapé com paginação).

import { entregarPdf, type PdfDestino } from './maxShowUpload';
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';
import type { Atividade } from './aulaAtividade';

const fmtPrazo = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Rio_Branco',
  });
};

export async function exportAtividadePDF(
  a: Atividade,
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
  const larguraUtil = pageWidth - margin * 2;

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
  doc.text('ATIVIDADE DA AULA', margin, 21);
  doc.setFontSize(10);
  doc.setTextColor(240, 240, 240);
  doc.text(a.fluxoNome, margin, 27);

  doc.setFontSize(8);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 27, { align: 'right' });

  let cursorY = 42;
  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 15) { doc.addPage(); cursorY = 20; }
  };

  /** Escreve um parágrafo quebrando linha e paginando. */
  const paragrafo = (
    texto: string,
    size: number,
    cor: [number, number, number],
    estilo: 'normal' | 'bold' | 'italic' = 'normal',
    recuo = 0,
  ) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', estilo);
    doc.setTextColor(...cor);
    for (const linha of doc.splitTextToSize(texto, larguraUtil - recuo)) {
      ensureSpace(size * 0.55);
      doc.text(linha, margin + recuo, cursorY);
      cursorY += size * 0.5;
    }
  };

  // ─── Título e objetivo ────────────────────────────────────────────
  paragrafo(a.titulo, 15, GRAY_INK, 'bold');
  cursorY += 2;

  const linhaMeta = [
    a.criador ? `Publicado por ${a.criador}` : null,
    a.expiraEm ? `Prazo: ${fmtPrazo(a.expiraEm)}` : null,
  ].filter(Boolean).join('   ·   ');
  if (linhaMeta) { paragrafo(linhaMeta, 8.5, GRAY_MID); cursorY += 2; }

  if (a.objetivo) {
    paragrafo('OBJETIVO', 8, GOLD, 'bold');
    cursorY += 1;
    paragrafo(a.objetivo, 9.5, GRAY_INK);
    cursorY += 4;
  }

  if (a.roteiro.resumo) {
    paragrafo(a.roteiro.resumo, 9, GRAY_MID, 'italic');
    cursorY += 5;
  }

  // ─── Antes de começar ─────────────────────────────────────────────
  // Vem antes das tarefas de propósito: é o que trava a turma nos primeiros
  // cinco minutos, e depois da tarefa 1 já é tarde.
  if (a.roteiro.prerequisitos.length > 0) {
    ensureSpace(24);
    autoTable(doc, {
      startY: cursorY,
      head: [['Antes de começar', 'Onde conferir']],
      body: a.roteiro.prerequisitos.map(p => [p.label, p.onde]),
      theme: 'grid',
      headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { textColor: GRAY_INK, fontSize: 8 },
      alternateRowStyles: { fillColor: GOLD_TINT },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  }

  // ─── Tarefas — o corpo do documento ───────────────────────────────
  ensureSpace(14);
  doc.setFillColor(...BLACK);
  doc.rect(margin, cursorY - 5, larguraUtil, 8, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GOLD);
  doc.text('TAREFAS', margin + 2.5, cursorY);
  cursorY += 11;

  a.roteiro.tarefas.forEach((t, i) => {
    ensureSpace(26);

    // Número + título na mesma linha; o papel logo abaixo, porque é ele que
    // diz ao aluno se a tarefa é dele ou do colega ao lado.
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY_INK);
    const numero = `${i + 1}.`;
    const larguraNumero = doc.getTextWidth(numero) + 2;
    doc.text(numero, margin, cursorY);
    const tituloLinhas = doc.splitTextToSize(
      t.titulo + (t.opcional ? '  (opcional)' : ''),
      larguraUtil - larguraNumero,
    );
    for (const linha of tituloLinhas) {
      ensureSpace(6);
      doc.text(linha, margin + larguraNumero, cursorY);
      cursorY += 5.2;
    }

    if (t.papel) {
      paragrafo(t.papel, 8.5, GOLD, 'bold', larguraNumero);
      cursorY += 1;
    }
    if (t.enunciado) {
      paragrafo(t.enunciado, 9, GRAY_INK, 'normal', larguraNumero);
      cursorY += 1;
    }
    if (t.entregavel) {
      paragrafo(`Entregar: ${t.entregavel}`, 8.5, GRAY_MID, 'normal', larguraNumero);
    }
    if (t.criterio) {
      paragrafo(`Avaliação: ${t.criterio}`, 8.5, GRAY_MID, 'italic', larguraNumero);
    }

    cursorY += 6;
  });

  // ─── A cadeia inteira, para consulta ──────────────────────────────
  // Repetição proposital com as tarefas: as tarefas dizem o que fazer, esta
  // tabela mostra a cadeia de ponta a ponta e onde a tarefa de cada um cai
  // dentro dela.
  if (a.roteiro.etapas.length > 0) {
    ensureSpace(26);
    autoTable(doc, {
      startY: cursorY,
      head: [['#', 'Etapa do fluxo', 'Quem executa', 'O que o sistema faz']],
      body: a.roteiro.etapas.map(e => [
        String(e.ordem),
        e.titulo + (e.opcional ? ' (opcional)' : ''),
        e.quem,
        e.detalhe,
      ]),
      theme: 'grid',
      headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { textColor: GRAY_INK, fontSize: 7.5, valign: 'top' },
      alternateRowStyles: { fillColor: GOLD_TINT },
      margin: { left: margin, right: margin },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 42 },
        2: { cellWidth: 34 },
      },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 4;
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
    doc.text(`LogMax · Atividade da aula · ${a.fluxoNome}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, a.titulo);
}
