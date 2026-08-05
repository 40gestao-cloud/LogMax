// Exports (PDF + Excel) do consolidado da Central de Avaliação — Matriz.
// Espelha exatamente o que a tela mostra: os cards de "Tarefas da Matriz"
// por tipo. A antiga seção "Dados das Filiais" (6 grupos vindos dos módulos
// operacionais) saiu da Competição do Conselho e por isso saiu daqui também.
//
// Ordem canônica = ordem dos cards em MatrizTarefasPanel.tsx (TIPOS) →
// tarefas por data desc → participantes por filial (SuperMax, MaxLook,
// TechMax) e alfabético dentro da filial. Mesmo padrão dos outros exports
// do projeto: dynamic import das libs pesadas (jsPDF/autoTable, exceljs).

import { supabase } from './supabase';
import { entregarPdf, type PdfDestino } from './maxShowUpload';
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
const ORDEM_FILIAL = new Map(OP_FILIAIS.map((f, i) => [f as string, i] as const));

// Espelha a ordem dos cards em MatrizTarefasPanel.tsx — não reordenar sem
// reordenar lá também.
const TAREFA_TIPOS = [
  { id: 'tarefa_apresentacao',       label: 'Apresentação Profissional' },
  { id: 'tarefa_treinamento_ia',     label: 'Desenvolvimento com IA' },
  { id: 'tarefa_rh',                 label: 'Recursos Humanos' },
  { id: 'tarefa_financeiro',         label: 'Financeiro' },
  { id: 'tarefa_logistica',          label: 'Logística' },
  { id: 'tarefa_marketing',          label: 'Marketing' },
  { id: 'tarefa_treinamento_vendas', label: 'Vendas e Atendimento' },
];

function media(notas: number[]): number | null {
  return notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
}

export type RelatorioParticipante = { nome: string; filial: string; media: number | null; comentarios: string[] };
export type RelatorioTarefa = {
  nome: string;
  descricao: string | null;
  data: string;
  status: 'aberta' | 'encerrada';
  participantes: RelatorioParticipante[];
};
export type RelatorioTarefaTipo = { id: string; label: string; tarefas: RelatorioTarefa[] };

export type CentralRelatorio = {
  competicaoNome: string;
  dataInicio: string;
  dataFim: string;
  tarefaTipos: RelatorioTarefaTipo[];
};

export async function buscarRelatorioCentralAvaliacao(competicao: {
  id: string; nome: string; data_inicio: string; data_fim: string;
}, ehAdmin = false): Promise<CentralRelatorio> {
  // Admin não é conselho — nota dele fica de fora dos agregados (regra 240).
  const { data: avalsRaw } = await supabase
    .from('avaliacoes_matriz')
    .select('item_tipo,item_id,decisao,nota,comentario,avaliador:user_profiles!avaliador_id(role)')
    .eq('competicao_id', competicao.id)
    .eq('ativo', true);

  const avalsPorChave = new Map<string, any[]>();
  for (const a of (avalsRaw ?? []) as any[]) {
    if (a.avaliador?.role === 'admin') continue;
    const key = `${a.item_tipo}:${a.item_id}`;
    const list = avalsPorChave.get(key) ?? [];
    list.push(a);
    avalsPorChave.set(key, list);
  }

  const { data: tarefasRaw } = await supabase
    .from('matriz_tarefas')
    .select('id,tipo,nome,descricao,data,status')
    .eq('competicao_id', competicao.id)
    .eq('ativo', true)
    .order('data', { ascending: false });
  // Voto selado (migr. 345): fora do admin, a RLS entrega só a própria nota
  // enquanto a tarefa não encerra. Exportar tarefa em avaliação geraria um
  // relatório com "média do conselho" calculada sobre uma nota — pior que
  // não exportar, porque o PDF circula como se fosse o número oficial.
  const tarefasArr = ((tarefasRaw ?? []) as any[])
    .filter(t => ehAdmin || t.status === 'encerrada');

  let participantesRaw: any[] = [];
  const tarefaIds = tarefasArr.map(t => t.id);
  if (tarefaIds.length > 0) {
    const { data } = await supabase
      .from('matriz_tarefa_participantes')
      .select('id,tarefa_id,nome_snapshot,filial')
      .in('tarefa_id', tarefaIds)
      .eq('ativo', true);
    participantesRaw = data ?? [];
  }

  const tarefaTipos: RelatorioTarefaTipo[] = TAREFA_TIPOS.map(tt => {
    const tarefas: RelatorioTarefa[] = tarefasArr
      .filter(t => t.tipo === tt.id)
      .map(t => {
        const participantes = participantesRaw
          .filter(p => p.tarefa_id === t.id)
          .map(p => {
            const avs = avalsPorChave.get(`${tt.id}:${p.id}`) ?? [];
            const notas = avs.filter(a => a.nota != null).map(a => Number(a.nota));
            return {
              nome: p.nome_snapshot,
              filial: p.filial,
              media: media(notas),
              comentarios: avs.filter(a => (a.comentario ?? '').trim()).map(a => a.comentario),
            };
          })
          // Mesma ordem visual dos cards: bloco por filial, nomes alfabéticos.
          .sort((a, b) => {
            const df = (ORDEM_FILIAL.get(a.filial) ?? 99) - (ORDEM_FILIAL.get(b.filial) ?? 99);
            return df !== 0 ? df : a.nome.localeCompare(b.nome, 'pt-BR');
          });
        return {
          nome: t.nome,
          descricao: t.descricao ?? null,
          data: t.data,
          status: (t.status ?? 'aberta') as 'aberta' | 'encerrada',
          participantes,
        };
      });
    return { id: tt.id, label: tt.label, tarefas };
  });

  return {
    competicaoNome: competicao.nome,
    dataInicio: competicao.data_inicio,
    dataFim: competicao.data_fim,
    tarefaTipos,
  };
}

const fmtDataBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtMedia = (v: number | null) => (v == null ? '—' : v.toFixed(1));

// ─────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────

export async function exportCentralAvaliacaoPDF(
  rel: CentralRelatorio,
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
  doc.text('CENTRAL DE AVALIAÇÃO — MATRIZ', margin, 21);
  doc.setFontSize(10);
  doc.setTextColor(240, 240, 240);
  doc.text(`${rel.competicaoNome}  ·  ${fmtDataBR(rel.dataInicio)} a ${fmtDataBR(rel.dataFim)}`, margin, 27);

  doc.setFontSize(8);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 27, { align: 'right' });

  let cursorY = 44;
  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 15) { doc.addPage(); cursorY = 20; }
  };

  const tiposComTarefas = rel.tarefaTipos.filter(tt => tt.tarefas.length > 0);

  if (tiposComTarefas.length === 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRAY_MID);
    doc.text('Nenhuma tarefa cadastrada nesta competição.', margin, cursorY);
  }

  // ─── Tarefas da Matriz — um bloco por tipo, na ordem dos cards ────
  for (const tt of tiposComTarefas) {
    // Título do tipo = card da tela. Reserva espaço pra não deixar
    // cabeçalho órfão no rodapé da página.
    ensureSpace(26);
    doc.setFillColor(...BLACK);
    doc.rect(margin, cursorY - 5, pageWidth - margin * 2, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GOLD);
    doc.text(tt.label.toUpperCase(), margin + 2.5, cursorY);
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_SOFT);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `${tt.tarefas.length} tarefa${tt.tarefas.length === 1 ? '' : 's'}`,
      pageWidth - margin - 2.5, cursorY, { align: 'right' },
    );
    cursorY += 9;

    for (const tarefa of tt.tarefas) {
      ensureSpace(24);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...GRAY_INK);
      doc.text(tarefa.nome, margin, cursorY);
      cursorY += 4.5;

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY_MID);
      const meta = [
        fmtDataBR(tarefa.data),
        `${tarefa.participantes.length} participante${tarefa.participantes.length === 1 ? '' : 's'}`,
        tarefa.status === 'encerrada' ? 'Encerrada' : 'Aberta',
      ].join('  ·  ');
      doc.text(meta, margin, cursorY);
      cursorY += 4.5;

      if (tarefa.descricao && tarefa.descricao.trim()) {
        doc.setFontSize(8.5);
        doc.setTextColor(...GRAY_INK);
        const linhas = doc.splitTextToSize(tarefa.descricao.trim(), pageWidth - margin * 2);
        for (const l of linhas) {
          ensureSpace(5);
          doc.text(l, margin, cursorY);
          cursorY += 4;
        }
        cursorY += 1;
      }

      if (tarefa.participantes.length === 0) {
        ensureSpace(8);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(...GRAY_MID);
        doc.text('Sem participantes.', margin, cursorY);
        doc.setFont('helvetica', 'normal');
        cursorY += 8;
        continue;
      }

      autoTable(doc, {
        startY: cursorY,
        head: [['Filial', 'Participante', 'Nota média', 'Comentários']],
        body: tarefa.participantes.map(p => [
          p.filial, p.nome, fmtMedia(p.media), p.comentarios.join(' | ') || '—',
        ]),
        theme: 'grid',
        headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { textColor: GRAY_INK, fontSize: 7.5 },
        alternateRowStyles: { fillColor: GOLD_TINT },
        margin: { left: margin, right: margin },
        columnStyles: {
          0: { cellWidth: 24 },
          2: { cellWidth: 20, halign: 'center' },
        },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 7;
    }
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
    doc.text(`LogMax · Central de Avaliação · ${rel.competicaoNome}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, filename, destino, profile, showToast, `Central de Avaliação — ${rel.competicaoNome}`);
}

// ─────────────────────────────────────────────────────────────────
// EXCEL
// ─────────────────────────────────────────────────────────────────

export async function exportCentralAvaliacaoExcel(rel: CentralRelatorio, filename: string) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LogMax';
  wb.created = new Date();

  const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0A0A' } };
  const headerFont: any = { bold: true, color: { argb: 'FFD4AF37' } };
  const accent = 'FFD4AF37'; // usado no título do resumo abaixo

  // ── Resumo ───────────────────────────────────────────────────────
  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }];
  resumo.addRow(['LogMax — Central de Avaliação']).font = { size: 16, bold: true, color: { argb: accent } };
  resumo.addRow([`Competição: ${rel.competicaoNome}`]);
  resumo.addRow([`Período: ${fmtDataBR(rel.dataInicio)} a ${fmtDataBR(rel.dataFim)}`]);
  resumo.addRow([`Gerado em: ${new Date().toLocaleString('pt-BR')}`]);
  resumo.addRow([]);
  resumo.addRow(['Tipo de tarefa', 'Tarefas', 'Participantes', 'Notas lançadas']).font = headerFont;
  resumo.lastRow!.eachCell(c => { c.fill = headerFill; });
  for (const tt of rel.tarefaTipos) {
    const participantes = tt.tarefas.reduce((s, t) => s + t.participantes.length, 0);
    const avaliados = tt.tarefas.reduce(
      (s, t) => s + t.participantes.filter(p => p.media != null).length, 0);
    resumo.addRow([tt.label, tt.tarefas.length, participantes, avaliados]);
  }

  // ── Tarefas da Matriz ────────────────────────────────────────────
  const wsTarefas = wb.addWorksheet('Tarefas da Matriz');
  wsTarefas.columns = [
    { header: 'Tipo',         key: 'tipo',         width: 24 },
    { header: 'Tarefa',       key: 'tarefa',       width: 30 },
    { header: 'Descrição',    key: 'descricao',    width: 50 },
    { header: 'Data',         key: 'data',         width: 12 },
    { header: 'Status',       key: 'status',       width: 12 },
    { header: 'Filial',       key: 'filial',       width: 14 },
    { header: 'Participante', key: 'participante', width: 26 },
    { header: 'Nota média',   key: 'media',        width: 12 },
    { header: 'Comentários',  key: 'comentarios',  width: 50 },
  ];
  wsTarefas.getRow(1).font = headerFont;
  wsTarefas.getRow(1).eachCell(c => { c.fill = headerFill; });
  for (const tt of rel.tarefaTipos) {
    for (const tarefa of tt.tarefas) {
      for (const p of tarefa.participantes) {
        wsTarefas.addRow({
          tipo: tt.label,
          tarefa: tarefa.nome,
          descricao: tarefa.descricao ?? '',
          data: fmtDataBR(tarefa.data),
          status: tarefa.status === 'encerrada' ? 'Encerrada' : 'Aberta',
          filial: p.filial,
          participante: p.nome,
          media: p.media != null ? Number(p.media.toFixed(1)) : null,
          comentarios: p.comentarios.join(' | '),
        });
      }
    }
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
