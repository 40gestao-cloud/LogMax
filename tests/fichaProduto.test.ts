// A ficha de produto por nicho é UMA lista só.
//
// `ATRIBUTOS_PRODUTO` estava escrita duas vezes: em `atributosProduto.ts` (o
// que a tela preenche e o PDV mostra) e em `modelosPlanilha.ts` (o que a
// planilha modelo baixa). As duas já tinham divergido — a planilha prometia
// que "o PDV pede o IMEI no fechamento da venda", coisa que o PDV não faz.
//
// A duplicação não dá sinal nenhum quando acontece: o campo novo entra na
// tela, a planilha continua gerando, e ninguém percebe até um aluno preencher
// o modelo e não achar a coluna no sistema. Daí o teste varrer o CÓDIGO-FONTE,
// e não só o resultado.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ATRIBUTOS_PRODUTO, garantiaDias, garantiaAte } from '../src/lib/atributosProduto';
import { getModelo } from '../src/lib/modelosPlanilha';

const FONTE_MODELOS = readFileSync(
  resolve(__dirname, '../src/lib/modelosPlanilha.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('ficha por nicho — fonte única', () => {
  it('modelosPlanilha não declara a própria lista de atributos de produto', () => {
    // Uma atribuição literal (`= {`) é cópia; a derivação usa `Object.fromEntries`.
    expect(
      /const ATRIBUTOS_PRODUTO:\s*Record<string,\s*ModeloCampo\[\]>\s*=\s*\{/.test(FONTE_MODELOS),
      'ATRIBUTOS_PRODUTO voltou a ser escrita à mão em modelosPlanilha.ts — derive de atributosProduto.ts',
    ).toBe(false);
  });

  it('toda coluna da ficha aparece no modelo da filial, na mesma ordem', () => {
    for (const filial of Object.keys(ATRIBUTOS_PRODUTO)) {
      const cols = getModelo('produtos', filial).campos.map(c => c.col);
      const daFicha = ATRIBUTOS_PRODUTO[filial].map(a => a.label.replace(/\s*\*\s*$/, ''));
      const posicoes = daFicha.map(l => cols.indexOf(l));
      expect(posicoes.every(i => i >= 0), `${filial}: coluna faltando no modelo`).toBe(true);
      expect(posicoes, `${filial}: ordem diferente da ficha`)
        .toEqual([...posicoes].sort((a, b) => a - b));
    }
  });

  it('campo obrigatório na ficha é obrigatório no modelo', () => {
    for (const [filial, defs] of Object.entries(ATRIBUTOS_PRODUTO)) {
      const campos = getModelo('produtos', filial).campos;
      for (const d of defs.filter(x => x.req)) {
        const col = campos.find(c => c.col === d.label.replace(/\s*\*\s*$/, ''));
        expect(col?.obrigatorio, `${filial} > ${d.label}`).toBe(true);
      }
    }
  });
});

describe('garantia', () => {
  it('lê o número da ficha', () => {
    expect(garantiaDias({ garantia_dias: '365' })).toBe(365);
    expect(garantiaDias({ garantia_dias: 90 })).toBe(90);
  });

  it('tolera o texto livre que o campo aceitava antes', () => {
    // "12 meses" vira 12 dias, que está errado — mas é o que o dado diz, e
    // inventar 365 seria pior. O campo passou a aceitar só dígitos justamente
    // para isto parar de entrar.
    expect(garantiaDias({ garantia_dias: '12 meses' })).toBe(12);
  });

  it('sem garantia não inventa data', () => {
    expect(garantiaDias({})).toBeNull();
    expect(garantiaDias({ garantia_dias: '' })).toBeNull();
    expect(garantiaDias({ garantia_dias: 'sem garantia' })).toBeNull();
    expect(garantiaDias({ garantia_dias: '0' })).toBeNull();
    expect(garantiaAte({}, '2026-08-17')).toBeNull();
  });

  it('soma os dias à data da venda', () => {
    expect(garantiaAte({ garantia_dias: '90' }, new Date(2026, 7, 17))).toBe('15/11/2026');
  });
});
