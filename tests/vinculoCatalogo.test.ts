import { describe, it, expect } from 'vitest';
import { nomeComMarca, produtoConfere } from '../src/lib/vinculoCatalogo';

// Mesmos casos usados para validar `vinculo_item_confere` (migr. 676).
describe('produtoConfere', () => {
  const casos: [string, string, string | null, string, string | null, boolean][] = [
    ['liza x Liza velho',           'Óleo de soja 900ml', 'liza', 'Óleo de Soja 900ml',      'Liza', true],
    ['soya x Liza velho',           'Óleo de soja 900ml', 'Soya', 'Óleo de Soja 900ml',      'Liza', false],
    ['liza x Liza renomeado',       'Óleo de soja 900ml', 'liza', 'Óleo de Soja 900ml Liza', 'Liza', true],
    ['soya x Liza renomeado',       'Óleo de soja 900ml', 'Soya', 'Óleo de Soja 900ml Liza', 'Liza', false],
    ['soya x Soya novo',            'Óleo de soja 900ml', 'Soya', 'Óleo de soja 900ml Soya', 'Soya', true],
    ['sem marca pedida',            'Óleo de soja 900ml', null,   'Óleo de Soja 900ml',      'Liza', true],
    ['marca no texto',              'Sal Refinado 1kg Cisne', 'Cisne', 'Sal Refinado 1kg Cisne', 'Cisne', true],
    ['marca só no nome',            'Óleo de soja 900ml', 'Soya', 'Óleo de soja 900ml Soya', null,   true],
    ['produto sem marca, nome curto', 'Óleo de soja 900ml', 'Soya', 'Óleo de soja 900ml',    null,   false],
  ];
  it.each(casos)('%s', (_c, item, marca, nome, pmarca, esperado) => {
    expect(produtoConfere(item, marca, { nome, marca: pmarca })).toBe(esperado);
  });
});

describe('nomeComMarca', () => {
  it('põe a marca no fim', () => {
    expect(nomeComMarca('Óleo de soja 900ml', 'Soya')).toBe('Óleo de soja 900ml Soya');
  });
  it('não repete marca que o texto já traz', () => {
    expect(nomeComMarca('Sal Refinado 1kg Cisne', 'cisne')).toBe('Sal Refinado 1kg Cisne');
  });
  it('sem marca, só limpa o espaço', () => {
    expect(nomeComMarca('Arroz\t5kg ', '')).toBe('Arroz 5kg');
  });
});
