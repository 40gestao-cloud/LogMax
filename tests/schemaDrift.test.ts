// Testa a comparação do checador de drift (scripts/schema-drift.mjs).
//
// Só a função `comparar` — ela é a única parte com regra de decisão; o resto
// do script é chamada HTTP e impressão. Sem rede, sem token: as coletas são
// montadas à mão, do jeito que a Management API devolveria.
//
// Este teste não está no grupo `|integracao|` de propósito: roda no CI e na
// máquina de quem não tem `.env.test`.

import { describe, it, expect } from 'vitest';
import { comparar } from '../scripts/schema-drift.mjs';

const CHECK = [{ id: 'tabelas', titulo: 'Tabelas' }];
const CHECK_INFO = [{ id: 'ordem', titulo: 'Ordem', informativo: true }];

/** Monta o formato que `coletar()` produz: um Map por verificação. */
const projeto = (nome: string, linhas: Record<string, string>, checkId = 'tabelas') => ({
  projeto: { nome },
  mapas: { [checkId]: new Map(Object.entries(linhas)) },
});

describe('comparar', () => {
  it('não acusa nada quando as quatro turmas estão iguais', () => {
    const coletas = ['ERP', 'Aprendiz', 'Contabilidade', 'Adm']
      .map(n => projeto(n, { produtos: 'existe', vendas: 'existe' }));

    const [r] = comparar(coletas, CHECK);
    expect(r.divergencias).toEqual([]);
  });

  it('aponta o objeto que falta numa turma e diz em qual', () => {
    const coletas = [
      projeto('ERP',           { produtos: 'existe', promocoes: 'existe' }),
      projeto('Aprendiz',      { produtos: 'existe' }),
      projeto('Contabilidade', { produtos: 'existe', promocoes: 'existe' }),
      projeto('Adm',           { produtos: 'existe', promocoes: 'existe' }),
    ];

    const [r] = comparar(coletas, CHECK);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].chave).toBe('promocoes');
    expect(r.divergencias[0].ausenteEm).toEqual(['Aprendiz']);
  });

  it('aponta valor diferente mesmo com o objeto presente nas quatro', () => {
    const coletas = [
      projeto('ERP',           { produtos: 'numeric | YES | -' }),
      projeto('Aprendiz',      { produtos: 'numeric | NO  | 0' }),
      projeto('Contabilidade', { produtos: 'numeric | YES | -' }),
      projeto('Adm',           { produtos: 'numeric | YES | -' }),
    ];

    const [r] = comparar(coletas, CHECK);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].ausenteEm).toEqual([]);
    // Os quatro valores vêm junto para o relatório conseguir agrupar
    // "ERP+Contab+Adm ≠ Aprendiz".
    expect(r.divergencias[0].valores).toHaveLength(4);
  });

  it('objeto que só existe numa turma também é divergência', () => {
    const coletas = [
      projeto('ERP',           { tabela_orfa: 'existe' }),
      projeto('Aprendiz',      {}),
      projeto('Contabilidade', {}),
      projeto('Adm',           {}),
    ];

    const [r] = comparar(coletas, CHECK);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].ausenteEm).toEqual(['Aprendiz', 'Contabilidade', 'Adm']);
  });

  it('preserva a marca de informativo, que é o que não reprova o run', () => {
    const coletas = [
      projeto('ERP',      { produtos: 'hash-a' }, 'ordem'),
      projeto('Aprendiz', { produtos: 'hash-b' }, 'ordem'),
    ];

    const [r] = comparar(coletas, CHECK_INFO);
    expect(r.informativo).toBe(true);
    expect(r.divergencias).toHaveLength(1);
  });

  it('ordena as divergências por chave, para o relatório sair estável', () => {
    const coletas = [
      projeto('ERP',      { zeta: 'a', alfa: 'a', meio: 'a' }),
      projeto('Aprendiz', { zeta: 'b', alfa: 'b', meio: 'b' }),
    ];

    const [r] = comparar(coletas, CHECK);
    expect(r.divergencias.map((d: any) => d.chave)).toEqual(['alfa', 'meio', 'zeta']);
  });
});
