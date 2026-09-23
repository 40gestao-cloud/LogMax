// Manifesto de assinaturas do contrato (migr. 623).
//
// É a folha que o ZapSign/DocuSign anexam ao fim do documento: quem assinou,
// por qual parte, quando e sobre qual arquivo (resumo SHA-256). Sai à parte e
// não dentro do PDF do contrato: o arquivo assinado não pode mudar, ou o
// resumo deixaria de bater — carimbar o original seria invalidar o que se quer
// provar.
//
// O rodapé diz o nível da assinatura. Simples não é qualificada, e o aluno
// precisa sair sabendo a diferença.

import { entregarPdf } from './maxShowUpload';
import { GOLD, BLACK, GRAY_INK, GRAY_MID, GRAY_SOFT, GOLD_TINT } from './pdfPalette';
import { formatDataHoraBR, todayBR } from './dates';
import { formatBRL } from './viewUtils';
import { numeroContrato, STATUS_LABEL, type Contrato, type AssinaturaContrato } from './contratos';

const dataBR = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

export async function exportManifestoContratoPDF(c: Contrato, assinaturas: AssinaturaContrato[]) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

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
  doc.text('MANIFESTO DE ASSINATURAS', margin, 21);
  doc.setFontSize(10);
  doc.setTextColor(240, 240, 240);
  doc.text(`${numeroContrato(c.numero)} · ${c.titulo}`.slice(0, 90), margin, 27);
  doc.setFontSize(8);
  doc.setTextColor(...GRAY_SOFT);
  doc.text(`Gerado em: ${dataBR(todayBR())}`, pageWidth - margin, 27, { align: 'right' });

  autoTable(doc, {
    startY: 38,
    head: [['Contrato', '']],
    body: [
      ['Número', numeroContrato(c.numero)],
      ['Título', c.titulo],
      ['Partes', `${c.parte_a}  x  ${c.parte_b}`],
      ['Objeto', c.objeto || '—'],
      ['Valor', c.valor != null ? `R$ ${formatBRL(Number(c.valor))}` : '—'],
      ['Condições', c.condicoes || '—'],
      ['Vigência', `${dataBR(c.vigencia_inicio)} a ${dataBR(c.vigencia_fim)}`],
      ['Situação', STATUS_LABEL[c.status]],
      ['Arquivo', c.arquivo_nome],
      ['SHA-256 do arquivo', c.arquivo_sha256],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, textColor: GRAY_INK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: BLACK, textColor: GOLD, fontSize: 8, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' }, 1: { cellWidth: 'auto', font: 'helvetica' } },
    margin: { left: margin, right: margin },
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 8,
    head: [['Parte', 'Assinado por', 'Cargo', 'Data e hora', 'Resumo conferido']],
    body: assinaturas.length
      ? assinaturas.map(a => [
          a.parte,
          a.nome_snapshot,
          a.cargo_snapshot,
          formatDataHoraBR(a.assinado_em),
          a.arquivo_sha256 === c.arquivo_sha256 ? `${a.arquivo_sha256.slice(0, 16)}… (confere)` : 'NÃO CONFERE',
        ])
      : [['—', 'Nenhuma assinatura ainda', '', '', '']],
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, textColor: GRAY_INK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: BLACK, textColor: GOLD, fontSize: 7.5, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GOLD_TINT },
    margin: { left: margin, right: margin },
  });

  let y = (doc as any).lastAutoTable.finalY + 8;
  if (c.motivo_encerramento) {
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_INK);
    const linhas = doc.splitTextToSize(
      `${STATUS_LABEL[c.status]} por ${c.encerrado_por_nome ?? '—'} em ${formatDataHoraBR(c.encerrado_em)}: ${c.motivo_encerramento}`,
      pageWidth - margin * 2,
    );
    doc.text(linhas, margin, y);
    y += linhas.length * 4 + 4;
  }

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...GRAY_MID);
  const aviso = doc.splitTextToSize(
    'Assinatura eletrônica SIMPLES (Lei 14.063/2020, art. 4º, I): identifica o signatário pela sessão ' +
    'autenticada no LogMax, registra a hora pelo relógio do servidor e vincula a assinatura ao arquivo pelo ' +
    'resumo SHA-256. Não é assinatura avançada nem qualificada — essas exigem certificado ICP-Brasil ou ' +
    'serviço de assinatura credenciado. Para conferir: calcule o SHA-256 do arquivo do contrato e compare com ' +
    'o resumo acima. Qualquer alteração no arquivo muda o resumo.',
    pageWidth - margin * 2,
  );
  doc.text(aviso, margin, Math.min(y, pageHeight - 20 - aviso.length * 3.5));

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_MID);
    doc.text(`LogMax · Manifesto ${numeroContrato(c.numero)}`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  await entregarPdf(doc, `manifesto-${numeroContrato(c.numero)}`, 'download');
}
