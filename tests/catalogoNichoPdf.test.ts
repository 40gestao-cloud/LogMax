import { describe, it, expect, vi } from 'vitest';

// `entregarPdf` puxaria supabase + PromptContext (React) para dentro do teste.
// Mockar aqui deixa o gerador puro E dá acesso ao jsPDF montado, que é
// justamente o que se quer inspecionar.
const entregue: { doc?: any; filename?: string; titulo?: string } = {};
vi.mock('../src/lib/maxShowUpload', () => ({
  entregarPdf: async (doc: any, filename: string, _d: any, _p: any, _t: any, titulo?: string) => {
    entregue.doc = doc;
    entregue.filename = filename;
    entregue.titulo = titulo;
  },
}));

import { exportSorteioCatalogoPDF } from '../src/lib/catalogoNichoPdf';
import { sortear } from '../src/lib/sorteioCatalogo';

const LARGURA_UTIL = 210.0015555555555 - 14 * 2;

describe('exportSorteioCatalogoPDF', () => {
  it('monta o PDF sem estourar e cabe na largura da página', async () => {
    const { itens, semente } = sortear({ nichos: ['SuperMax', 'MaxLook', 'TechMax'], qtd: 40, semente: 2026 });

    await exportSorteioCatalogoPDF(itens, semente, 'sorteio-teste');

    const doc = entregue.doc;
    expect(doc, 'o gerador não entregou documento nenhum').toBeTruthy();
    expect(entregue.filename).toBe('sorteio-teste');
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);

    // A tabela tem duas colunas que o ALUNO preenche à caneta. Uma versão
    // anterior somava 176 mm de largura fixa em 182 disponíveis e espremia
    // "Preço" em 6 mm — menos do que o próprio cabeçalho ocupa.
    const cols = doc.lastAutoTable.columns.map((c: any) => c.width);
    expect(cols.reduce((a: number, b: number) => a + b, 0)).toBeLessThanOrEqual(LARGURA_UTIL + 0.01);
    const larguraPreco = cols[cols.length - 1];
    const textoPreco = doc.getStringUnitWidth('Preço') * 7.5 / doc.internal.scaleFactor;
    expect(larguraPreco, 'coluna "Preço" sem espaço de escrita').toBeGreaterThan(textoPreco + 4 + 5);
  });

  it('não quebra com lista de um item só', async () => {
    const { itens, semente } = sortear({ nichos: ['TechMax'], qtd: 1, semente: 7 });
    await expect(exportSorteioCatalogoPDF(itens, semente, 'um-item')).resolves.toBeUndefined();
    expect(entregue.doc.internal.getNumberOfPages()).toBe(1);
  });

  it('o título do Max Show nomeia os nichos sorteados', async () => {
    const { itens, semente } = sortear({ nichos: ['MaxLook'], qtd: 3, semente: 1 });
    await exportSorteioCatalogoPDF(itens, semente, 'x');
    expect(entregue.titulo).toBe('Sorteio de catálogo — MaxLook');
  });
});
