import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGO_NICHO } from '../src/lib/catalogoNicho';

// O catálogo semente manda o aluno cadastrar cada produto numa categoria e
// subcategoria da taxonomia padrão (migr. 629/630). Se a taxonomia mudar e o
// catálogo não, a folha impressa passa a pedir uma categoria que não existe —
// foi o que aconteceu com "Mercearia seca e despensa" em 24/09.
//
// A lista vive no banco (`taxonomia_padrao`); a fonte que este teste lê é o
// INSERT da migração mais recente que regrava a tabela inteira.
function taxonomiaDaUltimaMigracao(): Map<string, Set<string>> {
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  const arquivos = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => readFileSync(join(dir, f), 'utf8').includes('INSERT INTO public.taxonomia_padrao'));
  const sql = readFileSync(join(dir, arquivos[arquivos.length - 1]), 'utf8');
  const mapa = new Map<string, Set<string>>();
  const linha = /\('(SuperMax|MaxLook|TechMax)', '((?:[^']|'')*)', '((?:[^']|'')*)', \d+,/g;
  for (const m of sql.matchAll(linha)) {
    const [, nicho, cat, sub] = m;
    const chave = `${nicho}|${cat.replace(/''/g, "'")}`;
    if (!mapa.has(chave)) mapa.set(chave, new Set());
    if (sub) mapa.get(chave)!.add(sub.replace(/''/g, "'"));
  }
  return mapa;
}

describe('catálogo semente × taxonomia padrão', () => {
  const tax = taxonomiaDaUltimaMigracao();

  it('a taxonomia foi lida da migração', () => {
    expect(tax.size).toBeGreaterThan(30);
  });

  it('todo item aponta para uma categoria e subcategoria que existem', () => {
    const fora: string[] = [];
    for (const [nicho, itens] of Object.entries(CATALOGO_NICHO)) {
      for (const i of itens) {
        const subs = tax.get(`${nicho}|${i.categoria}`);
        if (!subs || !subs.has(i.subcategoria)) fora.push(`${nicho}: ${i.nome} → ${i.categoria} › ${i.subcategoria}`);
      }
    }
    expect(fora).toEqual([]);
  });
});
