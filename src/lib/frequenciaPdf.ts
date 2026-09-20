// PDF da frequência (Registro de Ponto → aba Relatório).
//
// É o documento que o RH imprime e assina, então o vocabulário aqui NÃO é o do
// banco: para efeito de frequência só existem três situações —
//
//   Presença     — esteve. Atraso entra aqui: quem chegou tarde compareceu, e o
//                  atraso já é cobrado na folha (`recalcular_folha_do_ponto`
//                  compara `entrada` com o alvo da turma). Contá-lo à parte
//                  neste papel faria o total de presenças não fechar com o
//                  número de quem trabalhou no dia.
//   Falta        — não esteve e não justificou.
//   Justificada  — não esteve, com motivo escrito. O motivo VAI no documento:
//                  justificada sem motivo é falta com nome bonito.
//
// Mesmo padrão visual dos outros exports (paleta Premium, import dinâmico de
// jsPDF/autoTable, rodapé com paginação).

import { entregarPdf, type PdfDestino } from './maxShowUpload';
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';

export type FrequenciaStatusPdf = 'Presença' | 'Falta' | 'Justificada';

export type FrequenciaDiaPdf = {
  data: string;
  status: FrequenciaStatusPdf;
  /** Motivo, quando Justificada. Vem da observação do ponto ou, na falta dela,
   *  da justificativa de falta enviada para aquele dia. */
  justificativa: string | null;
  /** Horário marcado, quando houve. Não muda o status — é conferência. */
  entrada: string | null;
};

export type FrequenciaFuncionarioPdf = {
  nome: string;
  cargo: string | null;
  unidade: string;
  dias: FrequenciaDiaPdf[];
};

export type FrequenciaRelatorio = {
  escopo: string;
  inicio: string;
  fim: string;
  geradoEm: string;
  /** Falso quando se pediu só o resumo. */
  detalhar: boolean;
  funcionarios: FrequenciaFuncionarioPdf[];
};

const fmtData = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');

const fmtDiaSemana = (iso: string) =>
  new Date(iso + 'T12:00:00')
    .toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Rio_Branco' })
    .replace('.', '');

const COR_STATUS: Record<FrequenciaStatusPdf, [number, number, number]> = {
  'Presença':    [20, 120, 70],
  'Falta':       [190, 30, 30],
  'Justificada': [30, 90, 170],
};

const contar = (f: FrequenciaFuncionarioPdf, s: FrequenciaStatusPdf) =>
  f.dias.filter(d => d.status === s).length;

export async function exportFrequenciaPDF(
  rel: FrequenciaRelatorio,
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
  const periodoLabel = `${fmtData(rel.inicio)} a ${fmtData(rel.fim)}`;

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
  doc.text('Relatório de Frequência', margin, 22);
  doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text(rel.escopo, pageWidth - margin, 15, { align: 'right' });
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(`${periodoLabel} · gerado em ${rel.geradoEm}`, pageWidth - margin, 22, { align: 'right' });

  let cursorY = 42;

  // ─── Painel de números ────────────────────────────────────────────
  const totais = rel.funcionarios.reduce(
    (acc, f) => {
      acc.presencas += contar(f, 'Presença');
      acc.faltas += contar(f, 'Falta');
      acc.justificadas += contar(f, 'Justificada');
      return acc;
    },
    { presencas: 0, faltas: 0, justificadas: 0 },
  );
  const registros = totais.presencas + totais.faltas + totais.justificadas;
  const pct = registros > 0 ? Math.round((totais.presencas / registros) * 100) : 0;
  // Dia apurado é data, não linha: com 7 funcionários em 2 dias o painel dizia
  // 14 porque somava os registros (funcionários × dias).
  const diasApurados = new Set(rel.funcionarios.flatMap(f => f.dias.map(d => d.data))).size;

  const cards: [string, string][] = [
    ['Funcionários', String(rel.funcionarios.length)],
    ['Dias apurados', String(diasApurados)],
    ['Presenças', String(totais.presencas)],
    ['Faltas', String(totais.faltas)],
    ['Justificadas', String(totais.justificadas)],
    ['% presença', `${pct}%`],
  ];

  const cardW = (pageWidth - margin * 2 - 5 * 3) / 6;
  cards.forEach(([rotulo, valor], i) => {
    const x = margin + i * (cardW + 3);
    doc.setFillColor(...GOLD_TINT);
    doc.rect(x, cursorY, cardW, 16, 'F');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY_MID);
    doc.setFont('helvetica', 'normal');
    doc.text(rotulo.toUpperCase(), x + 2, cursorY + 5);
    doc.setFontSize(10.5);
    doc.setTextColor(...GRAY_INK);
    doc.setFont('helvetica', 'bold');
    doc.text(valor, x + 2, cursorY + 12);
  });
  cursorY += 22;

  // A régua fica escrita no documento: quem recebe o papel não tem como saber,
  // senão, que atraso foi contado como presença.
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...GRAY_MID);
  doc.text(
    'Presença inclui quem chegou com atraso. Falta justificada aparece como Justificada, com o motivo registrado. '
    + 'Dias sem lançamento não entram na apuração.',
    margin, cursorY, { maxWidth: pageWidth - margin * 2 },
  );
  cursorY += 8;

  // ─── Resumo por funcionário ───────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GRAY_INK);
  doc.text('Resumo por funcionário', margin, cursorY);

  autoTable(doc, {
    startY: cursorY + 3,
    head: [['Funcionário', 'Unidade', 'Cargo', 'Presenças', 'Faltas', 'Justif.', 'Dias', '% presença']],
    body: rel.funcionarios.map(f => {
      const p = contar(f, 'Presença');
      const fa = contar(f, 'Falta');
      const j = contar(f, 'Justificada');
      const t = p + fa + j;
      return [
        f.nome, f.unidade, f.cargo ?? '—',
        String(p), String(fa), String(j), String(t),
        t > 0 ? `${Math.round((p / t) * 100)}%` : '—',
      ];
    }),
    theme: 'grid',
    styles: { fontSize: 7.2, cellPadding: 1.8, textColor: GRAY_INK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: BLACK, textColor: GOLD, fontSize: 7, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GOLD_TINT },
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 20 },
      2: { cellWidth: 32 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 14, halign: 'center' },
      6: { cellWidth: 12, halign: 'center' },
      7: { cellWidth: 20, halign: 'center' },
    },
    margin: { left: margin, right: margin },
  });

  cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY) + 10;

  // ─── Detalhamento dia a dia ───────────────────────────────────────
  if (rel.detalhar) {
    for (const f of rel.funcionarios) {
      if (!f.dias.length) continue;
      if (cursorY > pageHeight - 45) { doc.addPage(); cursorY = 20; }

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...GRAY_INK);
      doc.text(f.nome, margin, cursorY);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY_MID);
      doc.text(
        [f.unidade, f.cargo].filter(Boolean).join(' · '),
        pageWidth - margin, cursorY, { align: 'right' },
      );

      const dias = [...f.dias].sort((a, b) => a.data.localeCompare(b.data));
      autoTable(doc, {
        startY: cursorY + 2.5,
        head: [['Data', 'Dia', 'Situação', 'Entrada', 'Justificativa']],
        body: dias.map(d => [
          fmtData(d.data),
          fmtDiaSemana(d.data),
          d.status,
          d.entrada ?? '—',
          d.status === 'Justificada'
            ? (d.justificativa?.trim() || 'Sem motivo registrado')
            : (d.justificativa?.trim() || '—'),
        ]),
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.5, textColor: GRAY_INK, lineColor: [228, 228, 228] },
        headStyles: { fillColor: BLACK, textColor: GOLD, fontSize: 6.8, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: GOLD_TINT },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 14 },
          2: { cellWidth: 26, fontStyle: 'bold' },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 'auto' },
        },
        // Cor só na coluna da situação: pintar a linha inteira deixa a tabela
        // ilegível num mês com muita falta.
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 2) {
            const s = dias[data.row.index]?.status;
            if (s) data.cell.styles.textColor = COR_STATUS[s];
          }
        },
        margin: { left: margin, right: margin },
      });
      cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY) + 9;
    }
  }

  if (!rel.funcionarios.length) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_MID);
    doc.text('Nenhum funcionário no filtro escolhido.', margin, cursorY);
  }

  // ─── Rodapé ───────────────────────────────────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_MID);
    doc.text(`LogMax · Frequência · ${rel.escopo} · ${periodoLabel}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Frequência — ${rel.escopo} (${periodoLabel})`);
}
