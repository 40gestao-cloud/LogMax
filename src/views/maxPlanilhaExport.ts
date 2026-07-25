// =================================================================
// Max Planilhas — exportador XLSX (lazy load do SheetJS)
// =================================================================
// SheetJS pesa ~400KB; nao vale trazer no chunk do editor. Import dinamico
// aqui garante que o modulo so baixa no clique de "Baixar XLSX".
// Fortune-sheet armazena celulas em `celldata: [{r, c, v: {v, m, f?, ct?, ...}}]`.
// Convertemos pra objeto de celulas SheetJS ({endereco: {t, v, f?, z?}}) por sheet.
// =================================================================

type FSCell = { r: number; c: number; v?: any };
type FSSheet = { name?: string; celldata?: FSCell[]; config?: any };

export async function exportXlsx(titulo: string, sheets: FSSheet[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  sheets.forEach((s, idx) => {
    const ws: any = {};
    let maxR = 0, maxC = 0;

    for (const cell of s.celldata || []) {
      if (!cell?.v) continue;
      const addr = XLSX.utils.encode_cell({ r: cell.r, c: cell.c });
      const v = cell.v;
      let obj: any;

      if (v.f) {
        // Fortune-sheet guarda formula com '=' na frente; SheetJS quer sem.
        obj = { t: 'n', f: String(v.f).replace(/^=/, ''), v: v.v ?? 0 };
      } else if (v.ct?.t === 'n' && v.v != null && v.v !== '') {
        obj = { t: 'n', v: Number(v.v) };
        if (v.ct.fa && v.ct.fa !== 'General') obj.z = v.ct.fa;
      } else if (v.ct?.t === 'd' && v.v) {
        const d = new Date(v.v);
        if (!Number.isNaN(d.getTime())) {
          obj = { t: 'd', v: d };
          if (v.ct.fa) obj.z = v.ct.fa;
        } else {
          obj = { t: 's', v: String(v.m ?? v.v) };
        }
      } else {
        obj = { t: 's', v: String(v.m ?? v.v ?? '') };
      }
      ws[addr] = obj;
      if (cell.r > maxR) maxR = cell.r;
      if (cell.c > maxC) maxC = cell.c;
    }

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });

    // Merges: config.merge = { "r_c": {r, c, rs, cs} }
    const merges = s.config?.merge;
    if (merges && typeof merges === 'object') {
      ws['!merges'] = Object.values(merges).map((m: any) => ({
        s: { r: m.r, c: m.c },
        e: { r: m.r + (m.rs || 1) - 1, c: m.c + (m.cs || 1) - 1 },
      }));
    }

    // Larguras: config.columnlen = { colIdx: pixels }
    const colw = s.config?.columnlen;
    if (colw && typeof colw === 'object') {
      const cols: any[] = [];
      for (let c = 0; c <= maxC; c++) cols[c] = { wpx: colw[c] ?? 73 };
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
