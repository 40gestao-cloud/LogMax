import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A tela de Orçamentos agrupa os dez status em cinco FASES do ciclo. Status
// que fique fora de toda fase some das abas: continua aparecendo em "Todos",
// mas nenhuma aba o alcança e a soma das abas deixa de bater com o total —
// o tipo de erro que só aparece meses depois, quando alguém acrescenta um
// status novo na migração e não volta aqui.
const fonte = readFileSync('src/views/OrcamentosView.tsx', 'utf-8');

function listaDe(nome: string): string[] {
  const i = fonte.indexOf(`const ${nome} = [`);
  expect(i, `${nome} não encontrado em OrcamentosView.tsx`).toBeGreaterThan(-1);
  const fim = fonte.indexOf('] as const;', i);
  expect(fim, `fim de ${nome} não encontrado`).toBeGreaterThan(i);
  const bloco = fonte.slice(i, fim);
  return [...bloco.matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('fases de orçamento', () => {
  const status = listaDe('STATUS_LIST');
  // FASES cita ids, labels, dicas e status na mesma lista de aspas simples;
  // só interessam os tokens que também estão em STATUS_LIST.
  const citadosNasFases = new Set(listaDe('FASES').filter(t => status.includes(t)));

  it('STATUS_LIST tem os dez status conhecidos', () => {
    expect(status).toHaveLength(10);
    expect(status).toContain('Rascunho');
    expect(status).toContain('Convertido em Pedido');
  });

  it('toda fase referencia status que existem', () => {
    for (const st of citadosNasFases) expect(status).toContain(st);
  });

  it('nenhum status fica sem fase', () => {
    const orfaos = status.filter(st => !citadosNasFases.has(st));
    expect(orfaos, `status sem aba: ${orfaos.join(', ')}`).toEqual([]);
  });
});
