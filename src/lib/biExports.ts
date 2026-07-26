// Exports do Painel BI em 3 formatos (PDF, Excel, Word). Carregados via
// dynamic import pra não inflar o bundle inicial — só baixa as libs
// quando o usuário clica em exportar.
//
// Formatos:
//   • PDF: jsPDF + autoTable (já no projeto). Cabeçalho corporativo +
//     markdown convertido em parágrafos/tabelas estilizadas.
//   • Excel: exceljs (já no projeto). Aba "Resumo" com métricas chave +
//     1 aba por filial com vendas/ticket detalhados.
//   • Word: lib docx (nova). Converte títulos H1/H2/H3 + parágrafos +
//     listas do Markdown em estilos nativos do Word.
import { entregarPdf, type PdfDestino } from './maxShowUpload';

const formatBRL = (n: number) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatPct = (n: number | null) =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`;

const formatDate = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export type BIDados = {
  periodo: { inicio: string; fim: string; dias: number };
  periodo_anterior: { inicio: string; fim: string };
  vendas: any;
  financeiro: any;
  rh: any;
  estoque: any;
  marketing: any;
  gerado_em: string;
};

// ─────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────

/**
 * Converte markdown em texto simples (sem ##/**, com quebras) pro PDF.
 * Não tenta renderizar tabelas markdown — quem tem dados estruturados
 * é o `dados` JSON, que mandamos pra autoTable separado.
 */
const markdownToPdfBlocks = (md: string): { type: 'h1' | 'h2' | 'h3' | 'li' | 'p'; text: string }[] => {
  const lines = md.split('\n');
  const blocks: { type: 'h1' | 'h2' | 'h3' | 'li' | 'p'; text: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('### ')) blocks.push({ type: 'h3', text: line.slice(4) });
    else if (line.startsWith('## ')) blocks.push({ type: 'h2', text: line.slice(3) });
    else if (line.startsWith('# '))  blocks.push({ type: 'h1', text: line.slice(2) });
    else if (/^[-*]\s+/.test(line))  blocks.push({ type: 'li', text: line.replace(/^[-*]\s+/, '• ') });
    else if (/^\d+\.\s+/.test(line)) blocks.push({ type: 'li', text: line });
    else blocks.push({ type: 'p', text: line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1') });
  }
  return blocks;
};

export async function exportBIToPDF(
  dados: BIDados,
  markdown: string,
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
  const margin = 14;
  const textWidth = pageWidth - margin * 2;

  // ─── Cabeçalho corporativo (mesma identidade dos outros exports) ──
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, pageWidth, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', margin, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Painel de Inteligência Estratégica', margin, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(`Período: ${formatDate(dados.periodo.inicio)} a ${formatDate(dados.periodo.fim)}`, margin, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em: ${new Date(dados.gerado_em).toLocaleString('pt-BR')}`, pageWidth - margin, 29, { align: 'right' });

  // ─── KPIs em grid (4 colunas) ─────────────────────────────────────
  let cursorY = 42;
  const kpis = [
    { label: 'Faturamento',  value: formatBRL(dados.vendas?.total_faturamento ?? 0) },
    { label: 'Variação',     value: formatPct(dados.vendas?.variacao_faturamento_pct ?? null) },
    { label: 'Saldo (Fin.)', value: formatBRL(dados.financeiro?.saldo ?? 0) },
    { label: 'Folha',        value: formatBRL(dados.rh?.folha_total ?? 0) },
  ];
  const colW = textWidth / 4;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  for (let i = 0; i < kpis.length; i++) {
    const x = margin + i * colW;
    doc.text(kpis[i].label.toUpperCase(), x, cursorY);
  }
  cursorY += 5;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(16, 185, 129);
  for (let i = 0; i < kpis.length; i++) {
    const x = margin + i * colW;
    doc.text(kpis[i].value, x, cursorY);
  }
  cursorY += 8;

  // ─── Tabela: Vendas por filial ────────────────────────────────────
  const porFilial: any[] = dados.vendas?.por_filial ?? [];
  if (porFilial.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Filial', 'Vendas', 'Faturamento', 'Ticket médio']],
      body: porFilial.map(f => [
        f.filial,
        String(f.qtd_vendas),
        formatBRL(f.faturamento),
        formatBRL(f.ticket_medio),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { textColor: [60, 60, 60], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 247, 245] },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  }

  // ─── Análise IA (markdown como texto formatado) ──────────────────
  doc.setFontSize(11);
  doc.setTextColor(16, 185, 129);
  doc.setFont('helvetica', 'bold');
  doc.text('Análise Executiva', margin, cursorY);
  cursorY += 6;

  const blocks = markdownToPdfBlocks(markdown);
  for (const block of blocks) {
    if (cursorY > 270) { doc.addPage(); cursorY = 20; }
    switch (block.type) {
      case 'h1':
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(16, 185, 129);
        doc.text(block.text, margin, cursorY); cursorY += 7;
        break;
      case 'h2':
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(40, 40, 40);
        doc.text(block.text, margin, cursorY); cursorY += 6;
        break;
      case 'h3':
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 80, 80);
        doc.text(block.text, margin, cursorY); cursorY += 5;
        break;
      case 'li':
      case 'p': {
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50);
        const lines = doc.splitTextToSize(block.text, textWidth);
        for (const l of lines) {
          if (cursorY > 280) { doc.addPage(); cursorY = 20; }
          doc.text(l, margin, cursorY); cursorY += 4.5;
        }
        cursorY += 1;
        break;
      }
    }
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Painel BI — ${formatDate(dados.periodo.inicio)} a ${formatDate(dados.periodo.fim)}`);
}

// ─────────────────────────────────────────────────────────────────
// EXCEL (multi-abas, exceljs)
// ─────────────────────────────────────────────────────────────────

export async function exportBIToExcel(dados: BIDados, filename: string) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LogMax BI';
  wb.created = new Date();

  const accent = 'FF10B981'; // emerald-500
  const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent } };
  const headerFont: any = { bold: true, color: { argb: 'FF0A0A0A' } };

  // ── Aba: Resumo ─────────────────────────────────────────────────
  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ width: 38 }, { width: 22 }, { width: 22 }];
  resumo.addRow(['LogMax — Painel BI']).font = { size: 16, bold: true, color: { argb: accent } };
  resumo.addRow([`Período: ${formatDate(dados.periodo.inicio)} a ${formatDate(dados.periodo.fim)} (${dados.periodo.dias} dias)`]);
  resumo.addRow([`Gerado em: ${new Date(dados.gerado_em).toLocaleString('pt-BR')}`]);
  resumo.addRow([]);

  const addSecao = (titulo: string, linhas: [string, any, any?][]) => {
    const r = resumo.addRow([titulo]);
    r.font = { bold: true, size: 12, color: { argb: accent } };
    resumo.addRow(['Indicador', 'Valor', 'Comparativo']).font = headerFont;
    resumo.lastRow!.eachCell(c => { c.fill = headerFill; });
    for (const [label, valor, comp] of linhas) {
      resumo.addRow([label, valor, comp ?? '—']);
    }
    resumo.addRow([]);
  };

  addSecao('Vendas', [
    ['Faturamento total',  formatBRL(dados.vendas?.total_faturamento ?? 0), formatPct(dados.vendas?.variacao_faturamento_pct ?? null)],
    ['Qtd vendas',         dados.vendas?.total_vendas ?? 0, `Anterior: ${dados.vendas?.qtd_vendas_anterior ?? 0}`],
    ['Ticket médio',       formatBRL(dados.vendas?.ticket_medio_geral ?? 0)],
  ]);

  addSecao('Financeiro', [
    ['Receitas no período',     formatBRL(dados.financeiro?.receitas ?? 0)],
    ['Despesas no período',     formatBRL(dados.financeiro?.despesas ?? 0)],
    ['Saldo',                   formatBRL(dados.financeiro?.saldo ?? 0), formatPct(dados.financeiro?.variacao_saldo_pct ?? null)],
    ['Margem %',                dados.financeiro?.margem_pct != null ? `${dados.financeiro.margem_pct}%` : '—'],
    ['A receber',               formatBRL(dados.financeiro?.a_receber ?? 0)],
    ['A pagar',                 formatBRL(dados.financeiro?.a_pagar ?? 0)],
  ]);

  addSecao('Recursos Humanos', [
    ['Folha total',              formatBRL(dados.rh?.folha_total ?? 0)],
    ['Descontos da folha',       formatBRL(dados.rh?.folha_descontos ?? 0)],
    ['Horas extras',             `${dados.rh?.horas_extras ?? 0}h`],
    ['Horas atraso',             `${dados.rh?.horas_atraso ?? 0}h`],
    ['Faltas (dias)',            dados.rh?.faltas_dias ?? 0],
    ['Justificados (dias)',      dados.rh?.justificados_dias ?? 0],
    ['Afastamentos no período',  dados.rh?.afastamentos_total ?? 0],
    ['Funcionários ativos',      dados.rh?.funcionarios_ativos ?? 0],
  ]);

  addSecao('Estoque', [
    ['Total produtos ativos',    dados.estoque?.total_produtos_ativos ?? 0],
    ['Valor total do estoque',   formatBRL(dados.estoque?.valor_estoque_total ?? 0)],
    ['Produtos sem saída',       (dados.estoque?.produtos_sem_saida ?? []).length],
  ]);

  addSecao('Marketing', [
    ['Campanhas ativas',         dados.marketing?.campanhas_ativas ?? 0],
    ['Campanhas concluídas',     dados.marketing?.campanhas_concluidas ?? 0],
    ['Orçamento campanhas',      formatBRL(dados.marketing?.orcamento_campanhas ?? 0)],
    ['Gasto real campanhas',     formatBRL(dados.marketing?.gasto_real_campanhas ?? 0)],
    ['Cupons usados',            dados.marketing?.cupons_usados ?? 0],
    ['Desconto via cupons',      formatBRL(dados.marketing?.desconto_total_cupons ?? 0)],
    ['Promoções aprovadas',      dados.marketing?.promocoes_aprovadas ?? 0],
  ]);

  // ── Aba: Vendas por filial ──────────────────────────────────────
  const porFilial: any[] = dados.vendas?.por_filial ?? [];
  if (porFilial.length > 0) {
    const wsF = wb.addWorksheet('Vendas por Filial');
    wsF.columns = [
      { header: 'Filial',       key: 'filial',       width: 18 },
      { header: 'Qtd Vendas',   key: 'qtd_vendas',   width: 14 },
      { header: 'Faturamento',  key: 'faturamento',  width: 18 },
      { header: 'Ticket médio', key: 'ticket_medio', width: 18 },
    ];
    wsF.getRow(1).font = headerFont;
    wsF.getRow(1).eachCell(c => { c.fill = headerFill; });
    for (const f of porFilial) wsF.addRow({
      filial: f.filial,
      qtd_vendas: f.qtd_vendas,
      faturamento: Number(f.faturamento),
      ticket_medio: Number(f.ticket_medio),
    });
    wsF.getColumn('faturamento').numFmt = '"R$ "#,##0.00';
    wsF.getColumn('ticket_medio').numFmt = '"R$ "#,##0.00';
  }

  // ── Aba: Top produtos vendidos ──────────────────────────────────
  const top: any[] = dados.estoque?.top_vendidos ?? [];
  if (top.length > 0) {
    const wsT = wb.addWorksheet('Top Vendidos');
    wsT.columns = [
      { header: 'Produto',     key: 'nome',         width: 38 },
      { header: 'Filial',      key: 'filial',       width: 14 },
      { header: 'Qtd vendida', key: 'qtd_vendida',  width: 14 },
      { header: 'Receita',     key: 'receita',      width: 18 },
    ];
    wsT.getRow(1).font = headerFont;
    wsT.getRow(1).eachCell(c => { c.fill = headerFill; });
    for (const t of top) wsT.addRow({ nome: t.nome ?? '—', filial: t.filial ?? '—', qtd_vendida: t.qtd_vendida, receita: Number(t.receita) });
    wsT.getColumn('receita').numFmt = '"R$ "#,##0.00';
  }

  // ── Aba: Produtos sem saída ────────────────────────────────────
  const sem: any[] = dados.estoque?.produtos_sem_saida ?? [];
  if (sem.length > 0) {
    const wsS = wb.addWorksheet('Produtos Sem Saída');
    wsS.columns = [
      { header: 'Produto', key: 'nome',    width: 38 },
      { header: 'Filial',  key: 'filial',  width: 14 },
      { header: 'Estoque', key: 'estoque', width: 14 },
    ];
    wsS.getRow(1).font = headerFont;
    wsS.getRow(1).eachCell(c => { c.fill = headerFill; });
    for (const s of sem) wsS.addRow({ nome: s.nome ?? '—', filial: s.filial ?? '—', estoque: s.estoque });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────
// WORD (lib docx)
// ─────────────────────────────────────────────────────────────────

const markdownToDocxChildren = async (md: string): Promise<any[]> => {
  const { Paragraph, TextRun, HeadingLevel } = await import('docx');
  const lines = md.split('\n');
  const children: any[] = [];

  // Parser line-by-line, simples. Preserva **bold** inline.
  const parseInline = (text: string): any[] => {
    const parts: any[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let last = 0; let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parts.push(new TextRun({ text: text.slice(last, m.index) }));
      parts.push(new TextRun({ text: m[1], bold: true }));
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(new TextRun({ text: text.slice(last) }));
    return parts.length > 0 ? parts : [new TextRun({ text })];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { children.push(new Paragraph({ children: [new TextRun({ text: '' })] })); continue; }

    if (line.startsWith('### ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInline(line.slice(4)) }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(line.slice(3)) }));
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: parseInline(line.slice(2)) }));
    } else if (/^[-*]\s+/.test(line)) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(line.replace(/^[-*]\s+/, '')) }));
    } else if (/^\d+\.\s+/.test(line)) {
      children.push(new Paragraph({ numbering: { reference: 'numbered-list', level: 0 }, children: parseInline(line.replace(/^\d+\.\s+/, '')) }));
    } else {
      children.push(new Paragraph({ children: parseInline(line) }));
    }
  }

  return children;
};

export async function exportBIToWord(dados: BIDados, markdown: string, filename: string) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');

  const periodoStr = `Período: ${formatDate(dados.periodo.inicio)} a ${formatDate(dados.periodo.fim)} (${dados.periodo.dias} dias)`;
  const geradoStr  = `Gerado em: ${new Date(dados.gerado_em).toLocaleString('pt-BR')}`;

  const corpo = await markdownToDocxChildren(markdown);

  const doc = new Document({
    creator: 'LogMax BI',
    title: 'Painel de Inteligência Estratégica',
    numbering: {
      config: [{
        reference: 'numbered-list',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{
      children: [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'LogMax — Painel de BI', bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: periodoStr, italics: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: geradoStr, italics: true, size: 18 })] }),
        new Paragraph({ children: [new TextRun({ text: '' })] }),
        ...corpo,
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
