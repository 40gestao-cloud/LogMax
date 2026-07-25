// =================================================================
// Max Planilhas — exportador XLSX (lazy load do SheetJS)
// =================================================================
// SheetJS pesa ~400KB; nao vale trazer no chunk do editor. Import dinamico
// aqui garante que o modulo so baixa no clique de "Baixar XLSX".
// Univer armazena o workbook como IWorkbookData: sheets[id].cellData[row][col]
// com { v, f, s (styleId) }. Convertemos pra objeto de celulas SheetJS.
// =================================================================

type UniverCell = { v?: any; f?: string; s?: string; t?: number };
type UniverSheet = {
  id: string;
  name?: string;
  cellData?: Record<string, Record<string, UniverCell>>;
  mergeData?: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
  columnData?: Record<string, { w?: number }>;
};
type UniverWorkbook = {
  sheetOrder?: string[];
  sheets?: Record<string, UniverSheet>;
};

export async function exportXlsx(titulo: string, workbook: UniverWorkbook | any) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  if (!workbook || typeof workbook !== 'object' || !Array.isArray(workbook.sheetOrder) || !workbook.sheets) {
    // Fallback: planilha vazia
    const ws: any = { '!ref': 'A1:A1', A1: { t: 's', v: '' } };
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha1');
    XLSX.writeFile(wb, `${sanitize(titulo)}.xlsx`);
    return;
  }

  workbook.sheetOrder.forEach((sheetId: string, idx: number) => {
    const s = workbook.sheets![sheetId]; if (!s) return;
    const ws: any = {};
    let maxR = 0, maxC = 0;

    const cellData = s.cellData || {};
    for (const rowKey of Object.keys(cellData)) {
      const r = parseInt(rowKey, 10); if (Number.isNaN(r)) continue;
      const row = cellData[rowKey];
      for (const colKey of Object.keys(row)) {
        const c = parseInt(colKey, 10); if (Number.isNaN(c)) continue;
        const cell = row[colKey]; if (!cell) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        let obj: any;
        if (cell.f) {
          obj = { t: 'n', f: String(cell.f).replace(/^=/, ''), v: cell.v ?? 0 };
        } else if (cell.v != null && cell.v !== '' && !Number.isNaN(Number(cell.v)) && typeof cell.v !== 'boolean') {
          obj = { t: 'n', v: Number(cell.v) };
        } else if (typeof cell.v === 'boolean') {
          obj = { t: 'b', v: cell.v };
        } else {
          obj = { t: 's', v: String(cell.v ?? '') };
        }
        ws[addr] = obj;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
    }

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });

    // Merges do Univer: [{startRow, endRow, startColumn, endColumn}]
    if (Array.isArray(s.mergeData) && s.mergeData.length > 0) {
      ws['!merges'] = s.mergeData.map(m => ({
        s: { r: m.startRow, c: m.startColumn },
        e: { r: m.endRow, c: m.endColumn },
      }));
    }

    // Larguras: columnData = { "0": { w: 73 }, ... }
    if (s.columnData && typeof s.columnData === 'object') {
      const cols: any[] = [];
      for (let c = 0; c <= maxC; c++) cols[c] = { wpx: s.columnData[String(c)]?.w ?? 73 };
      ws['!cols'] = cols;
    }

    const name = (s.name || `Planilha${idx + 1}`).slice(0, 31).replace(/[\\/?*[\]:]/g, '_');
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  XLSX.writeFile(wb, `${sanitize(titulo)}.xlsx`);
}

function sanitize(name: string) {
  return (name?.trim() || 'planilha').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}
