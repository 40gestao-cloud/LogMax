import { describe, it, expect } from 'vitest';
import { semelhancaDeItem, palavrasDoItem, medidasDoItem } from '../src/lib/similaridadeItem';

// A régua vale pelo que ela RECUSA. Aviso que dispara em item legitimamente
// diferente ensina a turma a clicar "sim" sem ler — e aí ele para de valer nos
// casos em que está certo. Por isso metade destes testes é do lado do "não".

describe('palavrasDoItem', () => {
  it('tira acento, pontuação e ruído gramatical', () => {
    expect(palavrasDoItem('Molho de Tomate Tradicional 300g (Pomarola)'))
      .toEqual(['molho', 'tomate', 'tradicional', '300g', 'pomarola']);
  });

  it('mantém o número colado à unidade', () => {
    expect(palavrasDoItem('Smart TV 32" HD')).toEqual(['smart', 'tv', '32', 'hd']);
  });
});

describe('medidasDoItem', () => {
  it('normaliza kg e g para a mesma base', () => {
    expect(medidasDoItem('Sal 1kg')).toEqual(medidasDoItem('Sal 1000g'));
  });

  it('normaliza l e ml', () => {
    expect(medidasDoItem('Água Sanitária 2 Litros 2l')).toEqual(medidasDoItem('Água 2000ml'));
  });
});

describe('semelhancaDeItem — o que TEM de avisar', () => {
  it('mesmo texto com espaçamento e caixa diferentes', () => {
    expect(semelhancaDeItem('Sal Refinado 1kg', '  sal   REFINADO 1kg ')).toBe('igual');
  });

  it('marca a mais no fim — o caso que originou a régua', () => {
    expect(semelhancaDeItem('Sal Refinado 1kg', 'Sal Refinado 1kg Cisne')).toBe('contido');
  });

  it('medida declarada só de um lado', () => {
    expect(semelhancaDeItem('Detergente Ypê', 'Detergente Ypê 500ml')).toBe('contido');
  });

  it('mesma medida escrita em unidade diferente', () => {
    expect(semelhancaDeItem('Sal Refinado 1kg Cisne', 'Sal Refinado 1000g Cisne')).toBe('parecido');
  });

  it('ordem trocada e uma palavra a mais', () => {
    expect(semelhancaDeItem('Papel Sulfite A4 75g', 'Sulfite Papel A4 75g'))
      .toBe('igual');
  });
});

describe('semelhancaDeItem — o que NÃO pode avisar', () => {
  it('mesma marca e linha, gramatura diferente', () => {
    expect(semelhancaDeItem('Sabão Omo 500g', 'Sabão Omo 1kg')).toBe('nao');
  });

  it('mesmo adjetivo, produto diferente', () => {
    expect(semelhancaDeItem('Sal Refinado', 'Açúcar Refinado')).toBe('nao');
  });

  it('mesma família, modelo diferente — o caso do controle', () => {
    expect(semelhancaDeItem('Controle sem fio DualSense Edge para PS5', 'Controle Sem Fio para PC'))
      .toBe('nao');
  });

  it('uma palavra em comum não basta', () => {
    expect(semelhancaDeItem('Sal', 'Salsicha')).toBe('nao');
    expect(semelhancaDeItem('Notebook', 'Notebook IdeaPad 3i Intel Core i5')).toBe('nao');
  });

  it('capacidade diferente no eletrônico', () => {
    expect(semelhancaDeItem('iPhone 16 128GB', 'iPhone 16 256GB')).toBe('nao');
  });

  it('texto vazio nunca casa', () => {
    expect(semelhancaDeItem('', 'Sal Refinado 1kg')).toBe('nao');
    expect(semelhancaDeItem(null, undefined)).toBe('nao');
  });
});

// Relatado pelo professor em 2026-08-27: a régua estava casando dois produtos
// diferentes da MESMA marca. Marca, medida e substantivo iguais somavam Dice
// 0.83 e o aviso disparava — mas espaguete e parafuso são duas compras.
describe('semelhancaDeItem — marca igual não é item igual', () => {
  it('mesma marca e medida, produto diferente — o caso do macarrão', () => {
    expect(semelhancaDeItem(
      'Macarrão Espaguete 500 g Dona Benta',
      'Macarrão Parafuso 500 g Dona Benta',
    )).toBe('nao');
  });

  it('mesma linha, sabor diferente', () => {
    expect(semelhancaDeItem(
      'Biscoito Recheado Chocolate Bono',
      'Biscoito Recheado Morango Bono',
    )).toBe('nao');
  });

  it('mesmo produto, marca diferente — duas compras, duas decisões', () => {
    expect(semelhancaDeItem('Café Torrado 500g Pilão', 'Café Torrado 500g Melitta')).toBe('nao');
  });

  it('mas a marca a mais de UM lado só continua avisando', () => {
    expect(semelhancaDeItem(
      'Macarrão Espaguete 500 g',
      'Macarrão Espaguete 500 g Dona Benta',
    )).toBe('contido');
  });
});

describe('medida escrita com espaço', () => {
  it('"500 g" vale o mesmo que "500g"', () => {
    expect(medidasDoItem('Sabão Omo 500 g')).toEqual(medidasDoItem('Sabão Omo 500g'));
    expect(medidasDoItem('Refrigerante 2 litros')).toEqual(medidasDoItem('Refrigerante 2l'));
  });

  it('gramatura diferente com espaço barra igual', () => {
    expect(semelhancaDeItem('Sabão Omo 500 g', 'Sabão Omo 1 kg')).toBe('nao');
  });
});
