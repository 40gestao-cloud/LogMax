// Export PDF do consolidado de Avaliações por ciclo (admin/CEO + RH).
// Mesmo padrão do biExports.ts: jsPDF + autoTable em dynamic import pra
// não inflar o bundle inicial. Renderiza:
//   • Cabeçalho corporativo (mesma identidade do BI)
//   • Dados do ciclo (nome, período, status, anonimato)
//   • KPIs (total avaliações, avaliados, média geral)
//   • Por grupo (CEO→Gerentes, Gerentes→Colaboradores, Feedback Reverso):
//       - tabela de avaliados com média
//       - subseção por avaliado: avaliadores, médias e observação
//   • Critérios detalhados (categoria + nota) quando disponíveis

const CATEGORIA_LABEL: Record<string, string> = {
  tecnica: 'Técnicas',
  comportamental: 'Comportamentais',
  socioemocional: 'Socioemocionais',
};

const TIPO_LABEL: Record<string, string> = {
  ceo_gerente: 'CEO → Gerentes',
  gerente_colaborador: 'Gerentes → Colaboradores',
  feedback_colaborador: 'Feedback Reverso',
};

const fmtData = (s: string) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

export type CicloPDF = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: string;
  feedback_anonimo: boolean;
};

export type CriterioPDF = {
  avaliacao_id: string;
  categoria: string;
  criterio: string;
  nota: number;
};

export type AvaliadorLinhaPDF = {
  avaliacaoId: string;
  nome: string;
  tipo: string;
  media: number;
  observacao: string | null;
};

export type AvaliadoLinhaPDF = {
  avaliadoId: string;
  nome: string;
  role: string;
  setor: string;
  qtdAvaliacoes: number;
  mediaGeral: number;
  porAvaliador: AvaliadorLinhaPDF[];
};

export type GrupoPDF = {
  tipo: string;
  label: string;
  descricao: string;
  linhas: AvaliadoLinhaPDF[];
  totalAvaliacoes: number;
};

export type ConsolidadoPDF = {
  totalAvaliacoes: number;
  totalAvaliados: number;
  mediaCiclo: number;
  grupos: GrupoPDF[];
};

export async function exportAvaliacoesCicloPDF(
  ciclo: CicloPDF,
  consolidado: ConsolidadoPDF,
  criterios: CriterioPDF[],
  filename: string,
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

  // ─── Cabeçalho corporativo ────────────────────────────────────────
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, pageWidth, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', margin, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Avaliações de Desempenho — Ciclo', margin, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(`Ciclo: ${ciclo.nome}`, margin, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 29, { align: 'right' });

  // ─── Linha de metadados do ciclo ─────────────────────────────────
  let cursorY = 42;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  const metaLinha = `Período: ${fmtData(ciclo.data_inicio)} a ${fmtData(ciclo.data_fim)}   ·   Status: ${ciclo.status}   ·   Feedback anônimo: ${ciclo.feedback_anonimo ? 'Sim' : 'Não'}`;
  doc.text(metaLinha, margin, cursorY);
  cursorY += 8;

  // ─── KPIs do ciclo ───────────────────────────────────────────────
  const kpis = [
    { label: 'Avaliações', value: String(consolidado.totalAvaliacoes) },
    { label: 'Avaliados', value: String(consolidado.totalAvaliados) },
    { label: 'Média Geral', value: consolidado.mediaCiclo.toFixed(1) },
  ];
  const colW = textWidth / kpis.length;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  for (let i = 0; i < kpis.length; i++) {
    doc.text(kpis[i].label.toUpperCase(), margin + i * colW, cursorY);
  }
  cursorY += 5;
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(16, 185, 129);
  for (let i = 0; i < kpis.length; i++) {
    doc.text(kpis[i].value, margin + i * colW, cursorY);
  }
  cursorY += 10;

  // Helper: garante espaço; se não tiver, adiciona página e reseta o cursor.
  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 15) {
      doc.addPage();
      cursorY = 20;
    }
  };

  // Critérios indexados por avaliação_id pra render por avaliador.
  const critsPorAvaliacao = new Map<string, CriterioPDF[]>();
  for (const c of criterios) {
    const list = critsPorAvaliacao.get(c.avaliacao_id) ?? [];
    list.push(c);
    critsPorAvaliacao.set(c.avaliacao_id, list);
  }

  // ─── Grupos ─────────────────────────────────────────────────────
  for (const grupo of consolidado.grupos) {
    if (grupo.linhas.length === 0) continue;

    ensureSpace(20);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(grupo.label, margin, cursorY);
    cursorY += 5;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 110);
    const descLinhas = doc.splitTextToSize(grupo.descricao, textWidth);
    for (const l of descLinhas) {
      doc.text(l, margin, cursorY);
      cursorY += 4;
    }
    doc.setTextColor(140, 140, 140);
    doc.text(
      `${grupo.linhas.length} ${grupo.linhas.length === 1 ? 'avaliado' : 'avaliados'} · ${grupo.totalAvaliacoes} ${grupo.totalAvaliacoes === 1 ? 'avaliação' : 'avaliações'}`,
      margin,
      cursorY,
    );
    cursorY += 5;

    // Tabela: ranking de avaliados do grupo.
    autoTable(doc, {
      startY: cursorY,
      head: [['Avaliado', 'Role · Setor', 'Avaliações', 'Média']],
      body: grupo.linhas.map(l => [
        l.nome,
        `${l.role} · ${l.setor}`,
        String(l.qtdAvaliacoes),
        l.mediaGeral.toFixed(1),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { textColor: [50, 50, 50], fontSize: 9 },
      alternateRowStyles: { fillColor: [245, 247, 245] },
      columnStyles: {
        2: { halign: 'center' },
        3: { halign: 'center', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 6;

    // Detalhe por avaliado: avaliadores, observações e critérios.
    for (const linha of grupo.linhas) {
      ensureSpace(18);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      doc.text(`${linha.nome}  ·  Média ${linha.mediaGeral.toFixed(1)}`, margin, cursorY);
      cursorY += 5;

      for (const av of linha.porAvaliador) {
        ensureSpace(14);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 80, 80);
        doc.text(`${av.nome} — ${av.media.toFixed(1)}`, margin + 2, cursorY);
        cursorY += 4;

        if (av.observacao) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(90, 90, 90);
          const obsLinhas = doc.splitTextToSize(`"${av.observacao}"`, textWidth - 4);
          for (const l of obsLinhas) {
            ensureSpace(5);
            doc.text(l, margin + 4, cursorY);
            cursorY += 4;
          }
        }

        const crits = critsPorAvaliacao.get(av.avaliacaoId) ?? [];
        if (crits.length > 0) {
          // Agrupa critérios por categoria pra leitura mais natural.
          const porCat: Record<string, CriterioPDF[]> = {};
          for (const c of crits) {
            (porCat[c.categoria] ??= []).push(c);
          }
          const body: string[][] = [];
          for (const cat of Object.keys(porCat)) {
            for (const c of porCat[cat]) {
              body.push([CATEGORIA_LABEL[cat] ?? cat, c.criterio, `${c.nota}/10`]);
            }
          }
          autoTable(doc, {
            startY: cursorY,
            head: [['Categoria', 'Critério', 'Nota']],
            body,
            theme: 'plain',
            headStyles: { fillColor: [240, 240, 240], textColor: [60, 60, 60], fontStyle: 'bold', fontSize: 8 },
            bodyStyles: { textColor: [70, 70, 70], fontSize: 8 },
            columnStyles: { 2: { halign: 'center', fontStyle: 'bold', cellWidth: 18 } },
            margin: { left: margin + 4, right: margin },
            tableWidth: textWidth - 4,
          });
          cursorY = (doc as any).lastAutoTable.finalY + 3;
        }
        cursorY += 1;
      }
      cursorY += 3;
    }
    cursorY += 4;
  }

  // Footer: tipo do ciclo + página em todas as páginas.
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text(
      `LogMax · Avaliações · Ciclo ${ciclo.nome}`,
      margin,
      pageHeight - 8,
    );
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  doc.save(`${filename}.pdf`);
}

// ─────────────────────────────────────────────────────────────────
// PDF da avaliação individual (uma pessoa, um avaliador). Usado
// pelo botão "PDF" em "Avaliações Recebidas" pra que o colaborador
// possa baixar a própria.
// ─────────────────────────────────────────────────────────────────

export type AvaliacaoIndividualPDF = {
  avaliadorNome: string;
  avaliadoNome: string;
  cicloNome: string;
  cicloPeriodo: { inicio: string; fim: string };
  tipo: string;
  observacao: string | null;
  criterios: CriterioPDF[];
};

export async function exportAvaliacaoIndividualPDF(av: AvaliacaoIndividualPDF, filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const textWidth = pageWidth - margin * 2;

  // Cabeçalho
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, pageWidth, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', margin, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Avaliação de Desempenho', margin, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(`Ciclo: ${av.cicloNome}`, margin, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 29, { align: 'right' });

  let cursorY = 44;

  // Bloco de identificação
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  const ident = [
    `Avaliado: ${av.avaliadoNome}`,
    `Avaliador: ${av.avaliadorNome}`,
    `Tipo: ${TIPO_LABEL[av.tipo] ?? av.tipo}`,
    `Período do ciclo: ${fmtData(av.cicloPeriodo.inicio)} a ${fmtData(av.cicloPeriodo.fim)}`,
  ];
  for (const linha of ident) {
    doc.text(linha, margin, cursorY);
    cursorY += 5;
  }

  // Média geral
  const media = av.criterios.length === 0
    ? 0
    : av.criterios.reduce((s, c) => s + c.nota, 0) / av.criterios.length;
  cursorY += 4;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('MÉDIA GERAL', margin, cursorY);
  cursorY += 5;
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(16, 185, 129);
  doc.text(media.toFixed(1), margin, cursorY);
  cursorY += 10;

  // Tabela de critérios agrupados por categoria
  const porCat: Record<string, CriterioPDF[]> = {};
  for (const c of av.criterios) {
    (porCat[c.categoria] ??= []).push(c);
  }
  const body: string[][] = [];
  for (const cat of Object.keys(porCat)) {
    for (const c of porCat[cat]) {
      body.push([CATEGORIA_LABEL[cat] ?? cat, c.criterio, `${c.nota}/10`]);
    }
  }
  if (body.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Categoria', 'Critério', 'Nota']],
      body,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { textColor: [50, 50, 50], fontSize: 9 },
      alternateRowStyles: { fillColor: [245, 247, 245] },
      columnStyles: { 2: { halign: 'center', fontStyle: 'bold' } },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  }

  // Observação
  if (av.observacao) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text('Observação do avaliador', margin, cursorY);
    cursorY += 6;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(60, 60, 60);
    const obsLinhas = doc.splitTextToSize(`"${av.observacao}"`, textWidth);
    for (const l of obsLinhas) {
      doc.text(l, margin, cursorY);
      cursorY += 5;
    }
  }

  doc.save(`${filename}.pdf`);
}
