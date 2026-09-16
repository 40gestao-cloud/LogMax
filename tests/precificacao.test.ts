// Markup x margem.
//
// O cadastro exibia `(venda − custo) / custo` sob o rótulo "Margem de Lucro"
// desde sempre. É markup. O DRE, na mesma base, calcula margem de verdade
// (`100 * lucro_bruto / receita_liquida` em `gerar_dre`) — então o sistema tinha
// as duas convenções e chamava as duas de margem.
//
// É o tipo de erro que nunca dá sinal: nada quebra, nenhuma tela fica vermelha,
// e o número exibido é plausível. Por isso o teste — e por isso ele checa a
// RELAÇÃO entre as duas, não só cada fórmula isolada.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  calcMarkup,
  calcMargem,
  precoPorMarkup,
  corDoMarkup,
  fmtPct,
  vendaAbaixoDoCusto,
} from '../src/lib/precificacao';

// 2026-09-15: a turma da contabilidade preencheu custo e venda trocados. O
// markup ficava vermelho e ninguém leu — vermelho ali também é markup baixo,
// que é normal. Virou bloqueio no cadastro (migr. 601), com exceção explícita
// para promoção-isca.
describe('preço de venda abaixo do custo', () => {
  it('pega os campos trocados', () => {
    expect(vendaAbaixoDoCusto(10, 25)).toBe(true);
    expect(calcMarkup(10, 25)!).toBeLessThan(0);
  });

  it('preço acima ou igual ao custo passa', () => {
    expect(vendaAbaixoDoCusto(25, 10)).toBe(false);
    // Igual não é prejuízo: é markup zero, que a régua de cor já denuncia.
    expect(vendaAbaixoDoCusto(10, 10)).toBe(false);
  });

  it('cadastro antecipado não vira prejuízo', () => {
    // Pós-migr. 480 o produto nasce sem custo: ausência não é zero a pagar, e
    // tratá-la como prejuízo devolveria o número inventado que a 480 tirou.
    expect(vendaAbaixoDoCusto(25, 0)).toBe(false);
    expect(vendaAbaixoDoCusto(0, 25)).toBe(false);
    expect(vendaAbaixoDoCusto(0, 0)).toBe(false);
  });
});

describe('o caso que abriu o assunto', () => {
  it('custo 10 e venda 20 são 100% de markup e 50% de margem', () => {
    expect(calcMarkup(20, 10)).toBe(100);
    expect(calcMargem(20, 10)).toBe(50);
  });

  it('markup é sempre maior que margem quando há lucro', () => {
    for (const [v, c] of [[20, 10], [15, 10], [100, 40], [12.5, 12]] as const) {
      expect(calcMarkup(v, c)!).toBeGreaterThan(calcMargem(v, c)!);
    }
  });

  it('margem nunca chega a 100% — markup não tem teto', () => {
    // É a intuição que o rótulo errado destruía: "100% de margem" é impossível
    // (significaria custo zero), mas 100% de markup é só dobrar o custo.
    expect(calcMargem(1000, 1)!).toBeLessThan(100);
    expect(calcMarkup(1000, 1)!).toBeGreaterThan(100);
  });
});

describe('calcMarkup', () => {
  it('venda igual ao custo é markup zero', () => {
    expect(calcMarkup(10, 10)).toBe(0);
  });

  it('vender abaixo do custo é markup negativo', () => {
    expect(calcMarkup(8, 10)).toBeCloseTo(-20, 5);
  });

  it('sem custo não há conta a fazer', () => {
    expect(calcMarkup(20, 0)).toBeNull();
    expect(calcMarkup(0, 10)).toBeNull();
  });
});

describe('calcMargem', () => {
  it('venda igual ao custo é margem zero', () => {
    expect(calcMargem(10, 10)).toBe(0);
  });

  it('vender abaixo do custo é margem negativa', () => {
    expect(calcMargem(8, 10)).toBeCloseTo(-25, 5);
  });

  it('divide pela VENDA, não pelo custo — é a diferença toda', () => {
    // Mesmo par, denominadores diferentes.
    expect(calcMargem(25, 20)).toBeCloseTo(20, 5);   // 5 / 25
    expect(calcMarkup(25, 20)).toBeCloseTo(25, 5);   // 5 / 20
  });
});

describe('precoPorMarkup — é assim que o preço se forma', () => {
  it('markup da categoria aplicado ao custo', () => {
    expect(precoPorMarkup(10, 100)).toBe(20);
    expect(precoPorMarkup(18.9, 30)).toBe(24.57);
  });

  it('o preço formado devolve exatamente o markup usado', () => {
    for (const mk of [10, 30, 55, 120]) {
      const preco = precoPorMarkup(40, mk);
      expect(calcMarkup(preco, 40)!).toBeCloseTo(mk, 1);
    }
  });

  it('arredonda para centavo — preço é dinheiro', () => {
    // Comparar `valor * 100` com um inteiro não serve: 4,56 * 100 dá
    // 455.99999999999994 em ponto flutuante. A pergunta certa é quantas casas
    // o número tem, e isso se lê na representação decimal.
    for (const [custo, mk] of [[3.33, 37], [18.9, 30], [7.77, 55]] as const) {
      const preco = precoPorMarkup(custo, mk);
      expect(preco).toBe(Number(preco.toFixed(2)));
    }
    expect(precoPorMarkup(3.33, 37)).toBe(4.56);
  });
});

describe('régua de cor', () => {
  it('mantém os cortes que a turma já lia', () => {
    expect(corDoMarkup(35)).toContain('emerald');
    expect(corDoMarkup(30)).toContain('emerald');
    expect(corDoMarkup(20)).toContain('yellow');
    expect(corDoMarkup(9)).toContain('red');
    expect(corDoMarkup(null)).toContain('gray');
  });
});

describe('fmtPct', () => {
  it('vírgula decimal, como o resto do sistema', () => {
    expect(fmtPct(33.333)).toBe('33,3%');
    expect(fmtPct(50)).toBe('50,0%');
    expect(fmtPct(null)).toBe('—');
  });
});

describe('a fórmula não volta a se duplicar', () => {
  // Ela vivia copiada em ProdutosView e CatalogoProdutosView, e as duas cópias
  // calculavam markup chamando de margem. Uma cópia nova é como o erro volta.
  const TELAS = ['src/views/ProdutosView.tsx', 'src/views/CatalogoProdutosView.tsx'];

  it.each(TELAS)('%s não redefine a conta localmente', (arquivo) => {
    const fonte = readFileSync(arquivo, 'utf-8');
    expect(fonte).not.toMatch(/const\s+calc(Margem|Markup)\s*=/);
  });

  it.each(TELAS)('%s importa a régua única', (arquivo) => {
    const fonte = readFileSync(arquivo, 'utf-8');
    expect(fonte).toMatch(/from ['"]\.\.\/lib\/precificacao['"]/);
  });
});
