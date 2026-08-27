import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINT_TABLE_MAP } from '../src/lib/supabase';

// Regressão de um bug que já apareceu três vezes: `useFetchData` resolve a
// tabela SÓ pelo ENDPOINT_TABLE_MAP. Chave faltando não quebra a tela — ela
// devolve [] e a tela fica vazia, sem erro visível. Foi assim que a Matriz
// ficou sem ver pedido de empréstimo (migr. 155) e, em 2026-08-27, que a lista
// de usuários em RH → Funcionários saiu com uma opção só.
//
// O teste lê o código, não roda a tela: qualquer literal passado como primeiro
// argumento de useFetchData tem de ser chave do mapa.

const RAIZ = join(process.cwd(), 'src');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

// useFetchData<Tipo>('endpoint'  |  useFetchData('endpoint'
const CHAMADA = /useFetchData\s*(?:<[^>]*>)?\s*\(\s*'([^']+)'/g;

describe('ENDPOINT_TABLE_MAP cobre todo useFetchData', () => {
  it('nenhum endpoint usado no código está fora do mapa', () => {
    const faltando: string[] = [];
    for (const arquivo of arquivos(RAIZ)) {
      const src = readFileSync(arquivo, 'utf8');
      for (const m of src.matchAll(CHAMADA)) {
        const endpoint = m[1];
        if (!(endpoint in ENDPOINT_TABLE_MAP)) {
          faltando.push(`${arquivo.replace(RAIZ, 'src')}: '${endpoint}'`);
        }
      }
    }
    expect(
      faltando,
      `Endpoint sem chave em ENDPOINT_TABLE_MAP (src/lib/supabase.ts) — a tela ficaria vazia em silêncio:\n  ${faltando.join('\n  ')}`,
    ).toEqual([]);
  });

  it('encontra as chamadas (guarda contra regex que para de casar)', () => {
    const total = arquivos(RAIZ)
      .map(a => [...readFileSync(a, 'utf8').matchAll(CHAMADA)].length)
      .reduce((s, n) => s + n, 0);
    expect(total).toBeGreaterThan(50);
  });
});
