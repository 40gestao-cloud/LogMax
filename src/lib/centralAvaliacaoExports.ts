// Exports (PDF + Excel) do consolidado da Central de Avaliação — Matriz.
// Reúne "Dados das Filiais" (6 grupos) + "Tarefas da Matriz" (3 tipos) numa
// única busca e gera os dois formatos. Mesmo padrão dos outros exports do
// projeto: dynamic import das libs pesadas (jsPDF/autoTable, exceljs).
//
// A config de grupos/tipos é uma cópia da usada em MatrizAvaliacoesView.tsx
// e MatrizTarefasPanel.tsx — mesma convenção já usada no projeto pra essas
// telas (cada uma mantém sua própria cópia de OP_FILIAIS/FILIAL_COLOR etc.).

import { supabase, ENDPOINT_TABLE_MAP } from './supabase';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

type TipoCfg = { id: string; label: string; endpoint: string; descField: string[]; dateField: string; creative: boolean };
type GrupoCfg = { id: string; label: string; tipos: TipoCfg[] };

const GRUPOS: GrupoCfg[] = [
  {
    id: 'marketing', label: 'Marketing',
    tipos: [
      { id: 'arte',          label: 'Artes',         endpoint: '/api/marketingartesview',       descField: ['titulo','nome','descricao'], dateField: 'created_at',    creative: true },
      { id: 'promocao',      label: 'Promoções',     endpoint: '/api/marketingpromocoesview',   descField: ['nome','titulo','descricao'], dateField: 'created_at',    creative: true },
      { id: 'campanha',      label: 'Campanhas',     endpoint: '/api/marketingcampanhasview',   descField: ['nome','titulo','descricao'], dateField: 'created_at',    creative: true },
      { id: 'redes_sociais', label: 'Redes Sociais', endpoint: '/api/metricasredessociaisview', descField: ['plataforma'],                dateField: 'data_registro', creative: true },
    ],
  },
  {
    id: 'vendas', label: 'Vendas',
    tipos: [
      { id: 'orcamento', label: 'Orçamentos', endpoint: '/api/orcamentosview', descField: ['cliente_nome','descricao','numero'], dateField: 'created_at', creative: false },
    ],
  },
  {
    id: 'compras', label: 'Compras',
    tipos: [
      { id: 'requisicao', label: 'Requisições', endpoint: '/api/requisicoesview', descField: ['descricao','item','titulo'], dateField: 'created_at', creative: false },
      { id: 'cotacao',    label: 'Cotações',    endpoint: '/api/cotacoesview',    descField: ['descricao','item','titulo'], dateField: 'created_at', creative: false },
    ],
  },
  {
    id: 'rh', label: 'RH',
    tipos: [
      { id: 'frequencia_trabalho',  label: 'Frequência de Trabalho', endpoint: '/api/frequenciatrabalhocomfilialview', descField: ['nome_funcionario','justificativa','status'], dateField: 'data',       creative: false },
      { id: 'avaliacao_desempenho', label: 'Desempenho',             endpoint: '/api/avaliacoesview',                  descField: ['observacao','tipo'],                         dateField: 'created_at', creative: false },
    ],
  },
  {
    id: 'cadastros', label: 'Cadastros',
    tipos: [
      { id: 'cadastro_categoria',  label: 'Categorias',  endpoint: 'categorias_produto',          descField: ['nome','descricao'],                dateField: 'created_at', creative: false },
      { id: 'cadastro_fornecedor', label: 'Fornecedores',endpoint: '/api/crmview-fornecedores',   descField: ['nome','razao_social','descricao'], dateField: 'created_at', creative: false },
      { id: 'cadastro_servico',    label: 'Serviços',    endpoint: '/api/servicosview',           descField: ['nome','descricao','codigo'],       dateField: 'created_at', creative: false },
      { id: 'cadastro_produto',    label: 'Produtos',    endpoint: '/api/produtosview',           descField: ['nome','descricao','codigo'],       dateField: 'created_at', creative: false },
      { id: 'cadastro_cliente',    label: 'Clientes',    endpoint: '/api/crmview-clientes',       descField: ['nome','razao_social','descricao'], dateField: 'created_at', creative: false },
    ],
  },
  {
    id: 'financeiro', label: 'Financeiro',
    tipos: [
      { id: 'conta_pagar',   label: 'Contas a Pagar',   endpoint: '/api/contaspagarview',   descField: ['descricao','fornecedor_nome','numero_documento'], dateField: 'created_at', creative: false },
      { id: 'conta_receber', label: 'Contas a Receber', endpoint: '/api/contasreceberview', descField: ['descricao','cliente_nome','numero_documento'],    dateField: 'created_at', creative: false },
    ],
  },
];

const TAREFA_TIPOS = [
  { id: 'tarefa_treinamento_vendas', label: 'Vendas e Atendimento' },
  { id: 'tarefa_treinamento_ia',     label: 'Desenvolvimento com IA' },
  { id: 'tarefa_rh',                 label: 'Recursos Humanos' },
  { id: 'tarefa_marketing',          label: 'Marketing' },
  { id: 'tarefa_financeiro',         label: 'Financeiro' },
  { id: 'tarefa_logistica',          label: 'Logística' },
  { id: 'tarefa_apresentacao',       label: 'Apresentação Profissional' },
];

function firstNonEmpty(row: any, fields: string[]): string {
  for (const f of fields) {
    const v = row?.[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return '—';
}

function media(notas: number[]): number | null {
  return notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
}

export type RelatorioItem = {
  filial: string;
  descricao: string;
  aprovados: number;
  reprovados: number;
  media: number | null;
  comentarios: string[];
};
export type RelatorioTipo = { id: string; label: string; creative: boolean; itens: RelatorioItem[] };
export type RelatorioGrupo = { id: string; label: string; tipos: RelatorioTipo[] };

export type RelatorioParticipante = { nome: string; filial: string; media: number | null; comentarios: string[] };
export type RelatorioTarefa = { nome: string; data: string; participantes: RelatorioParticipante[] };
export type RelatorioTarefaTipo = { id: string; label: string; tarefas: RelatorioTarefa[] };

export type CentralRelatorio = {
  competicaoNome: string;
  dataInicio: string;
  dataFim: string;
  grupos: RelatorioGrupo[];
  tarefaTipos: RelatorioTarefaTipo[];
};

export async function buscarRelatorioCentralAvaliacao(competicao: {
  id: string; nome: string; data_inicio: string; data_fim: string;
}): Promise<CentralRelatorio> {
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

  const ini = competicao.data_inicio;
  const fim = competicao.data_fim + 'T23:59:59.999';

  const grupos: RelatorioGrupo[] = [];
  for (const g of GRUPOS) {
    const tipos: RelatorioTipo[] = [];
    for (const t of g.tipos) {
      const table = ENDPOINT_TABLE_MAP[t.endpoint] ?? t.endpoint;
      const cols = Array.from(new Set(['id', 'filial', t.dateField, ...t.descField])).join(',');
      const { data } = await supabase
        .from(table)
        .select(cols)
        .in('filial', OP_FILIAIS as unknown as string[])
        .gte(t.dateField, ini)
        .lte(t.dateField, fim);
      const rows = (data ?? []) as any[];
      const itens: RelatorioItem[] = rows.map(r => {
        const avs = avalsPorChave.get(`${t.id}:${r.id}`) ?? [];
        const notas = avs.filter(a => a.nota != null).map(a => Number(a.nota));
        return {
          filial: r.filial,
          descricao: firstNonEmpty(r, t.descField),
          aprovados: avs.filter(a => a.decisao === 'Aprovado').length,
          reprovados: avs.filter(a => a.decisao === 'Reprovado').length,
          media: media(notas),
          comentarios: avs.filter(a => (a.comentario ?? '').trim()).map(a => a.comentario),
        };
      });
      tipos.push({ id: t.id, label: t.label, creative: t.creative, itens });
    }
    grupos.push({ id: g.id, label: g.label, tipos });
  }

  const { data: tarefasRaw } = await supabase
    .from('matriz_tarefas')
    .select('id,tipo,nome,data')
    .eq('competicao_id', competicao.id)
    .eq('ativo', true)
    .order('data', { ascending: false });
  const tarefasArr = (tarefasRaw ?? []) as any[];

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
          });
        return { nome: t.nome, data: t.data, participantes };
      });
    return { id: tt.id, label: tt.label, tarefas };
  });

  return {
    competicaoNome: competicao.nome,
    dataInicio: competicao.data_inicio,
    dataFim: competicao.data_fim,
    grupos,
    tarefaTipos,
  };
}

const fmtDataBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtMedia = (v: number | null) => (v == null ? '—' : v.toFixed(1));

// ─────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────

export async function exportCentralAvaliacaoPDF(rel: CentralRelatorio, filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, pageWidth, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', margin, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Central de Avaliação — Matriz', margin, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(`${rel.competicaoNome}  ·  ${fmtDataBR(rel.dataInicio)} a ${fmtDataBR(rel.dataFim)}`, margin, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 29, { align: 'right' });

  let cursorY = 42;
  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 15) { doc.addPage(); cursorY = 20; }
  };

  // ─── Dados das Filiais ──────────────────────────────────────────
  ensureSpace(10);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(16, 185, 129);
  doc.text('Dados das Filiais', margin, cursorY);
  cursorY += 8;

  for (const grupo of rel.grupos) {
    for (const tipo of grupo.tipos) {
      if (tipo.itens.length === 0) continue;
      ensureSpace(16);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      doc.text(`${grupo.label} — ${tipo.label}`, margin, cursorY);
      cursorY += 5;

      autoTable(doc, {
        startY: cursorY,
        head: [tipo.creative
          ? ['Filial', 'Item', 'Nota média', 'Comentários']
          : ['Filial', 'Item', 'Aprovados', 'Reprovados', 'Comentários']],
        body: tipo.itens.map(it => tipo.creative
          ? [it.filial, it.descricao, fmtMedia(it.media), it.comentarios.join(' | ') || '—']
          : [it.filial, it.descricao, String(it.aprovados), String(it.reprovados), it.comentarios.join(' | ') || '—']),
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { textColor: [60, 60, 60], fontSize: 7.5 },
        alternateRowStyles: { fillColor: [245, 247, 245] },
        margin: { left: margin, right: margin },
        columnStyles: tipo.creative
          ? { 2: { halign: 'center' } }
          : { 2: { halign: 'center' }, 3: { halign: 'center' } },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 6;
    }
  }

  // ─── Tarefas da Matriz ──────────────────────────────────────────
  const temTarefas = rel.tarefaTipos.some(tt => tt.tarefas.length > 0);
  if (temTarefas) {
    ensureSpace(14);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text('Tarefas da Matriz', margin, cursorY);
    cursorY += 8;

    for (const tt of rel.tarefaTipos) {
      for (const tarefa of tt.tarefas) {
        ensureSpace(16);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        doc.text(`${tt.label} — ${tarefa.nome} (${fmtDataBR(tarefa.data)})`, margin, cursorY);
        cursorY += 5;

        autoTable(doc, {
          startY: cursorY,
          head: [['Participante', 'Filial', 'Nota média', 'Comentários']],
          body: tarefa.participantes.map(p => [p.nome, p.filial, fmtMedia(p.media), p.comentarios.join(' | ') || '—']),
          theme: 'grid',
          headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 8 },
          bodyStyles: { textColor: [60, 60, 60], fontSize: 7.5 },
          alternateRowStyles: { fillColor: [245, 247, 245] },
          margin: { left: margin, right: margin },
          columnStyles: { 2: { halign: 'center' } },
        });
        cursorY = (doc as any).lastAutoTable.finalY + 6;
      }
    }
  }

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text(`LogMax · Central de Avaliação · ${rel.competicaoNome}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  doc.save(`${filename}.pdf`);
}

// ─────────────────────────────────────────────────────────────────
// EXCEL
// ─────────────────────────────────────────────────────────────────

export async function exportCentralAvaliacaoExcel(rel: CentralRelatorio, filename: string) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LogMax';
  wb.created = new Date();

  const accent = 'FF10B981';
  const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent } };
  const headerFont: any = { bold: true, color: { argb: 'FF0A0A0A' } };

  // ── Resumo ───────────────────────────────────────────────────────
  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }];
  resumo.addRow(['LogMax — Central de Avaliação']).font = { size: 16, bold: true, color: { argb: accent } };
  resumo.addRow([`Competição: ${rel.competicaoNome}`]);
  resumo.addRow([`Período: ${fmtDataBR(rel.dataInicio)} a ${fmtDataBR(rel.dataFim)}`]);
  resumo.addRow([`Gerado em: ${new Date().toLocaleString('pt-BR')}`]);
  resumo.addRow([]);
  resumo.addRow(['Grupo / Tipo', 'Itens', 'Aprovados', 'Reprovados']).font = headerFont;
  resumo.lastRow!.eachCell(c => { c.fill = headerFill; });
  for (const grupo of rel.grupos) {
    for (const tipo of grupo.tipos) {
      resumo.addRow([
        `${grupo.label} — ${tipo.label}`,
        tipo.itens.length,
        tipo.itens.reduce((s, it) => s + it.aprovados, 0),
        tipo.itens.reduce((s, it) => s + it.reprovados, 0),
      ]);
    }
  }
  resumo.addRow([]);
  resumo.addRow(['Tarefas da Matriz', 'Tarefas', 'Participantes', '']).font = headerFont;
  resumo.lastRow!.eachCell(c => { c.fill = headerFill; });
  for (const tt of rel.tarefaTipos) {
    resumo.addRow([tt.label, tt.tarefas.length, tt.tarefas.reduce((s, t) => s + t.participantes.length, 0), '']);
  }

  // ── Dados das Filiais ────────────────────────────────────────────
  const wsDados = wb.addWorksheet('Dados das Filiais');
  wsDados.columns = [
    { header: 'Grupo',       key: 'grupo',       width: 14 },
    { header: 'Tipo',        key: 'tipo',        width: 22 },
    { header: 'Filial',      key: 'filial',      width: 14 },
    { header: 'Item',        key: 'item',        width: 40 },
    { header: 'Aprovados',   key: 'aprovados',   width: 12 },
    { header: 'Reprovados',  key: 'reprovados',  width: 12 },
    { header: 'Nota média',  key: 'media',       width: 12 },
    { header: 'Comentários', key: 'comentarios', width: 50 },
  ];
  wsDados.getRow(1).font = headerFont;
  wsDados.getRow(1).eachCell(c => { c.fill = headerFill; });
  for (const grupo of rel.grupos) {
    for (const tipo of grupo.tipos) {
      for (const it of tipo.itens) {
        wsDados.addRow({
          grupo: grupo.label,
          tipo: tipo.label,
          filial: it.filial,
          item: it.descricao,
          aprovados: it.aprovados,
          reprovados: it.reprovados,
          media: it.media != null ? Number(it.media.toFixed(1)) : null,
          comentarios: it.comentarios.join(' | '),
        });
      }
    }
  }

  // ── Tarefas da Matriz ────────────────────────────────────────────
  const wsTarefas = wb.addWorksheet('Tarefas da Matriz');
  wsTarefas.columns = [
    { header: 'Tipo',         key: 'tipo',         width: 24 },
    { header: 'Tarefa',       key: 'tarefa',       width: 30 },
    { header: 'Data',         key: 'data',         width: 12 },
    { header: 'Participante', key: 'participante', width: 26 },
    { header: 'Filial',       key: 'filial',       width: 14 },
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
          data: fmtDataBR(tarefa.data),
          participante: p.nome,
          filial: p.filial,
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
