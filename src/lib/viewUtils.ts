import { useState } from 'react';

export type GField = { key: string; label: string; type?: 'text' | 'number' | 'select' | 'date' | 'currency'; options?: string[]; required?: boolean; placeholder?: string };

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

// Inverte formatBRL: "1.234,56" → 1234.56 ; "" → 0.
export const parseBRL = (v: string | number | null | undefined): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const digits = String(v).replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits) / 100;
};

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
