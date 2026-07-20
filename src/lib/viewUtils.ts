import { useState, type KeyboardEvent } from 'react';

export type GField = { key: string; label: string; type?: 'text' | 'number' | 'select' | 'date' | 'currency' | 'textarea'; options?: string[]; required?: boolean; placeholder?: string; fullWidth?: boolean };

export function useFormValidation<T extends Record<string, string>>(fields: T) {
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {};
    for (const key in fields) {
      if (!fields[key]?.trim()) {
        newErrors[key] = 'Campo obrigatório';
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const clearError = (key: keyof T) => {
    setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  return { errors, validate, clearError, setErrors };
}

export const formatPhone = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export const formatCPF = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

export const formatCNPJ = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

// Aceita string de input (qualquer formato) ou número (valor em reais).
// Devolve sempre "1.234,56" — milhar com ponto, decimal com vírgula.
export const formatBRL = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === '') return '';
  let digits: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    digits = Math.round(Math.abs(v) * 100).toString();
  } else {
    digits = String(v).replace(/\D/g, '');
  }
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  const cents  = padded.slice(-2);
  const intRaw = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  const intFmt = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFmt},${cents}`;
};

// onKeyDown pra inputs de moeda que usam formatBRL. Bloqueia ponto e
// vírgula (e qualquer outro caractere imprimível não-dígito) pra forçar
// o modo cents-builder — operador antigo digitava "1.250,00" esperando
// mil duzentos e cinquenta, mas formatBRL ignora os separadores e só
// salva "12,50" no final. Permite teclas de controle (Backspace, setas,
// Tab, atalhos com Ctrl/Meta).
export const handleMoneyKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length !== 1) return;
  if (!/[0-9]/.test(e.key)) e.preventDefault();
};

// Inverte formatBRL: "1.234,56" → 1234.56 ; "" → 0.
export const parseBRL = (v: string | number | null | undefined): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const digits = String(v).replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits) / 100;
};

// Converte string vazia em chaves UUID-like (`_id`) para `null`. Postgres
// rejeita '' como UUID; o front frequentemente envia '' quando o select
// está em "Nenhum/Selecione...". Em vez de tratar caso a caso em cada view,
// rodamos no dbInsert/dbUpdate. Tabelas com FK NOT NULL passam a falhar com
// mensagem mais clara ("null value in column ... violates not-null") em vez
// do críptico "invalid input syntax for type uuid: ''".
export function sanitizeUuidFks<T extends Record<string, any>>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  const out: any = { ...payload };
  for (const key of Object.keys(out)) {
    if (key.endsWith('_id') && out[key] === '') {
      out[key] = null;
    }
  }
  return out as T;
}

export async function exportToPDF(title: string, columns: string[], rows: any[][], filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();

  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Relatório Operacional', 14, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(title, 14, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  const now = new Date().toLocaleString('pt-BR');
  doc.text(`Gerado em: ${now}`, 210 - 14, 29, { align: 'right' });

  autoTable(doc, {
    startY: 38,
    head: [columns],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { textColor: [60, 60, 60], fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 245] },
  });

  doc.save(`${filename}.pdf`);
}

/** Grupo para export agrupado — um título + linhas próprias. */
export type GrupoExport = { titulo: string; rows: any[][] };

/**
 * PDF agrupado: mesma identidade visual do exportToPDF, mas com cabeçalho de
 * grupo + tabela própria para cada grupo. Usado quando o usuário quer ver
 * o mesmo conjunto de colunas segmentado (ex.: produtos por filial).
 */
export async function exportToPDFAgrupado(title: string, columns: string[], grupos: GrupoExport[], filename: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();

  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Relatório Operacional', 14, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(title, 14, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 210 - 14, 29, { align: 'right' });

  let cursorY = 40;
  for (const grupo of grupos) {
    if (grupo.rows.length === 0) continue;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(grupo.titulo, 14, cursorY);
    cursorY += 4;
    autoTable(doc, {
      startY: cursorY,
      head: [columns],
      body: grupo.rows,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { textColor: [60, 60, 60], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 247, 245] },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 12;
  }

  doc.save(`${filename}.pdf`);
}

export type ReciboItem = {
  nome_produto: string;
  qtd: number;
  preco_unitario: number;
  subtotal: number;
};

export type ReciboVenda = {
  id: string;
  shortId: string;
  data: string;
  hora?: string;
  filial?: string | null;
  cliente?: string | null;
  itens: ReciboItem[];
  subtotal: number;
  desconto: number;
  total: number;
  formaPagamento: string;
  operador?: string | null;
};

/**
 * Recibo de venda (PDV). Formato A4 retrato, cabeçalho LogMax, dados da venda,
 * tabela de itens e bloco de totais. Salva como `recibo-{shortId}.pdf`.
 */
export async function gerarReciboVendaPDF(venda: ReciboVenda) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();

  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Recibo de Venda', 14, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(`Venda #${venda.shortId}`, 14, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  const emissao = `${venda.data}${venda.hora ? ' ' + venda.hora : ''}`;
  doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 210 - 14, 29, { align: 'right' });

  // Bloco de cabeçalho da venda
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  let y = 42;
  const linha = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 50, y);
    y += 5;
  };
  linha('Data/Hora:', emissao || '—');
  if (venda.filial) linha('Filial:', venda.filial);
  if (venda.cliente) linha('Cliente:', venda.cliente);
  if (venda.operador) linha('Operador:', venda.operador);

  const fmtBR = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtQtd = (n: number) => Number.isInteger(n)
    ? String(n)
    : n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  autoTable(doc, {
    startY: y + 2,
    head: [['Produto', 'Qtd', 'Unit.', 'Subtotal']],
    body: venda.itens.map(it => [
      it.nome_produto,
      fmtQtd(Number(it.qtd)),
      fmtBR(Number(it.preco_unitario)),
      fmtBR(Number(it.subtotal)),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { textColor: [60, 60, 60], fontSize: 9 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: [245, 247, 245] },
  });

  let cursorY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal', 140, cursorY);
  doc.text(fmtBR(venda.subtotal), 196, cursorY, { align: 'right' });
  cursorY += 6;
  if (venda.desconto > 0) {
    doc.setTextColor(190, 30, 30);
    doc.text('Desconto', 140, cursorY);
    doc.text(`- ${fmtBR(venda.desconto)}`, 196, cursorY, { align: 'right' });
    cursorY += 6;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(16, 185, 129);
  doc.text('TOTAL', 140, cursorY);
  doc.text(fmtBR(venda.total), 196, cursorY, { align: 'right' });
  cursorY += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`Forma de pagamento: ${venda.formaPagamento}`, 14, cursorY);

  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  doc.text('Documento não fiscal · LogMax PDV', 105, 287, { align: 'center' });

  doc.save(`recibo-${venda.shortId}.pdf`);
}

// ─── Notas Emitidas ───────────────────────────────────────────────────────
// Documento não fiscal (LogMax é ambiente educacional). O `tipo` só
// direciona rótulos e a legenda de rodapé; a estrutura é a mesma.
export type NotaEmitida = {
  numero: number;
  serie: string;
  tipo: 'NF Produto' | 'NFS-e Serviço' | 'Recibo Simples';
  filial: string;
  cliente_nome: string | null;
  descricao: string;
  valor_total: number;
  data_emissao: string;    // ISO ou dd/mm/aaaa; formatado antes de imprimir
  origem?: string | null;  // rastreio: 'pdv' / 'servico_manual' / 'avulso'
};

const TITULO_POR_TIPO: Record<NotaEmitida['tipo'], string> = {
  'NF Produto':     'Nota Fiscal — Venda de Produto',
  'NFS-e Serviço':  'Nota Fiscal de Serviço',
  'Recibo Simples': 'Recibo',
};

const RODAPE_POR_TIPO: Record<NotaEmitida['tipo'], string> = {
  'NF Produto':     'Documento não fiscal · Emitido em ambiente LogMax',
  'NFS-e Serviço':  'Documento não fiscal · Emitido em ambiente LogMax',
  'Recibo Simples': 'Documento não fiscal · Emitido em ambiente LogMax',
};

/**
 * PDF da nota emitida. Formato A4 retrato, cabeçalho LogMax colorido
 * com o tipo, bloco de dados (número/série, filial, cliente, data), a
 * descrição do produto/serviço num painel e o total em destaque.
 * Salva como `nota-{tipo-slug}-{filial}-{numero}.pdf`.
 */
export async function gerarNotaEmitidaPDF(nota: NotaEmitida) {
  const [{ default: jsPDF }] = await Promise.all([import('jspdf')]);
  const doc = new jsPDF();

  const numeroFmt = String(nota.numero).padStart(6, '0');
  const titulo = TITULO_POR_TIPO[nota.tipo] ?? 'Documento';

  // Cabeçalho preto com faixa do accent
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('LogMax', 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text(titulo, 14, 21);
  doc.setFontSize(11);
  doc.setTextColor(220, 220, 220);
  doc.text(`${nota.tipo} · Nº ${numeroFmt} / Série ${nota.serie}`, 14, 29);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 210 - 14, 29, { align: 'right' });

  // Bloco de dados
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  let y = 44;
  const linha = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 55, y);
    y += 6;
  };
  linha('Data de emissão:', nota.data_emissao);
  linha('Filial:', nota.filial);
  linha('Cliente:', nota.cliente_nome ?? 'Consumidor final');
  if (nota.origem && nota.origem !== 'avulso') {
    linha('Origem:', nota.origem === 'pdv' ? 'Venda no PDV' : 'Serviço prestado');
  }

  // Painel descrição
  y += 4;
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(245, 247, 245);
  doc.roundedRect(14, y, 182, 40, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(nota.tipo === 'NFS-e Serviço' ? 'DESCRIÇÃO DO SERVIÇO' : 'DESCRIÇÃO', 18, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  const linhasDesc = doc.splitTextToSize(nota.descricao || '—', 174);
  doc.text(linhasDesc.slice(0, 4), 18, y + 14);
  y += 46;

  // Bloco de valor
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text('VALOR TOTAL', 14, y + 4);
  doc.setFontSize(20);
  doc.setTextColor(16, 185, 129);
  doc.text(
    `R$ ${nota.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    196, y + 6, { align: 'right' }
  );

  // Assinatura
  y += 30;
  doc.setDrawColor(180, 180, 180);
  doc.line(14, y + 22, 90, y + 22);
  doc.line(120, y + 22, 196, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('Emitente', 52, y + 27, { align: 'center' });
  doc.text('Cliente', 158, y + 27, { align: 'center' });

  // Rodapé
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  doc.text(RODAPE_POR_TIPO[nota.tipo] ?? 'Documento não fiscal', 105, 287, { align: 'center' });

  const slugTipo = nota.tipo === 'NF Produto' ? 'nf'
    : nota.tipo === 'NFS-e Serviço' ? 'nfse'
    : 'recibo';
  const slugFilial = nota.filial.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`${slugTipo}-${slugFilial}-${numeroFmt}.pdf`);
}

/**
 * Excel agrupado: uma aba (worksheet) por grupo. Cada aba leva as mesmas
 * colunas. Nome da aba truncado a 31 chars (limite do Excel).
 */
export async function exportToExcelAgrupado(columns: string[], grupos: GrupoExport[], filename: string) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LogMax';
  workbook.created = new Date();

  for (const grupo of grupos) {
    if (grupo.rows.length === 0) continue;
    const worksheet = workbook.addWorksheet(grupo.titulo.slice(0, 31));
    worksheet.addRow(columns);
    worksheet.getRow(1).font = { bold: true };
    grupo.rows.forEach(r => worksheet.addRow(r));
    worksheet.columns.forEach((col, i) => {
      const headerLen = (columns[i] ?? '').length;
      const maxBodyLen = grupo.rows.reduce((max, r) => Math.max(max, String(r[i] ?? '').length), 0);
      col.width = Math.min(50, Math.max(10, Math.max(headerLen, maxBodyLen) + 2));
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportToExcel(sheetName: string, columns: string[], rows: any[][], filename: string) {
  // exceljs em vez de xlsx (sheetjs) — este último tem 2 CVEs HIGH sem patch.
  // Lazy-loaded para não pesar no bundle inicial.
  const ExcelJS = (await import('exceljs')).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LogMax';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31)); // limite Excel: 31 chars no nome da sheet
  worksheet.addRow(columns);
  worksheet.getRow(1).font = { bold: true };
  rows.forEach(r => worksheet.addRow(r));

  // Auto-largura das colunas baseado no maior valor
  worksheet.columns.forEach((col, i) => {
    const headerLen = (columns[i] ?? '').length;
    const maxBodyLen = rows.reduce((max, r) => Math.max(max, String(r[i] ?? '').length), 0);
    col.width = Math.min(50, Math.max(10, Math.max(headerLen, maxBodyLen) + 2));
  });

  // Gerar buffer e disparar download via Blob (funciona em qualquer browser sem File System API)
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
