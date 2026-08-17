// A ficha de perecível que ninguém lia.
//
// A migr. 360 criou `perecivel` / `validade_dias` / `armazenagem` em
// `produtos.atributos` com a dica "Prazo desde o recebimento. É o que decide
// remarcação e ordem de saída." — e nenhum consumidor. A migr. 424 deu tela à
// validade meses depois por outro caminho, com a data digitada lote a lote.
//
// Estas funções são o encontro das duas metades. O teste guarda a conta e,
// principalmente, os casos em que ela NÃO deve devolver nada: sugerir data para
// produto sem prazo seria inventar exatamente a informação que a ficha existe
// para parar de inventar.

import { describe, it, expect } from 'vitest';
import {
  ehPerecivel,
  validadeDias,
  armazenagemDe,
  vencimentoPrevisto,
  avisoPerecivelSemValidade,
  ARMAZENAGENS,
} from '../src/lib/perecivel';

const prod = (atributos: Record<string, any> | null | undefined) => ({ atributos });

describe('ehPerecivel', () => {
  it('só o true explícito conta', () => {
    expect(ehPerecivel(prod({ perecivel: true }))).toBe(true);
    expect(ehPerecivel(prod({ perecivel: false }))).toBe(false);
    expect(ehPerecivel(prod({}))).toBe(false);
  });

  it('produto sem ficha não é "não perecível" — é desconhecido, e não trava nada', () => {
    expect(ehPerecivel(prod(null))).toBe(false);
    expect(ehPerecivel(undefined)).toBe(false);
    expect(ehPerecivel({ atributos: 'lixo' })).toBe(false);
  });
});

describe('validadeDias', () => {
  it('lê o número', () => {
    expect(validadeDias(prod({ validade_dias: '30' }))).toBe(30);
    expect(validadeDias(prod({ validade_dias: 5 }))).toBe(5);
  });

  it('tolera o que a turma digitou antes de o campo virar numérico', () => {
    expect(validadeDias(prod({ validade_dias: '30 dias' }))).toBe(30);
    expect(validadeDias(prod({ validade_dias: ' 180 ' }))).toBe(180);
  });

  it('zero e lixo não são prazo', () => {
    expect(validadeDias(prod({ validade_dias: '0' }))).toBeNull();
    expect(validadeDias(prod({ validade_dias: 'sei lá' }))).toBeNull();
    expect(validadeDias(prod({}))).toBeNull();
  });
});

describe('armazenagemDe', () => {
  it('aceita só o vocabulário fechado', () => {
    for (const a of ARMAZENAGENS) {
      expect(armazenagemDe(prod({ armazenagem: a }))).toBe(a);
    }
    expect(armazenagemDe(prod({ armazenagem: 'Geladeira' }))).toBeNull();
    expect(armazenagemDe(prod({}))).toBeNull();
  });
});

describe('vencimentoPrevisto — a conta que a dica prometia', () => {
  it('data da entrada + validade_dias', () => {
    expect(vencimentoPrevisto(prod({ validade_dias: '30' }), '2026-08-17')).toBe('2026-09-16');
    expect(vencimentoPrevisto(prod({ validade_dias: '5' }), '2026-08-17')).toBe('2026-08-22');
  });

  it('atravessa virada de mês e de ano', () => {
    expect(vencimentoPrevisto(prod({ validade_dias: '20' }), '2026-12-20')).toBe('2027-01-09');
    expect(vencimentoPrevisto(prod({ validade_dias: '1' }), '2026-01-31')).toBe('2026-02-01');
  });

  it('acerta o ano bissexto', () => {
    expect(vencimentoPrevisto(prod({ validade_dias: '1' }), '2028-02-28')).toBe('2028-02-29');
  });

  it('não inventa data para produto sem prazo', () => {
    // É a regra que mantém a tela honesta: sem ficha, a data vai à mão.
    expect(vencimentoPrevisto(prod({}), '2026-08-17')).toBeNull();
    expect(vencimentoPrevisto(prod({ perecivel: true }), '2026-08-17')).toBeNull();
    expect(vencimentoPrevisto(null, '2026-08-17')).toBeNull();
  });

  it('recusa data de entrada malformada em vez de chutar', () => {
    expect(vencimentoPrevisto(prod({ validade_dias: '30' }), '17/08/2026')).toBeNull();
    expect(vencimentoPrevisto(prod({ validade_dias: '30' }), '')).toBeNull();
  });

  it('a soma é em UTC ao meio-dia — o Acre é UTC-5 e a borda do dia erraria', () => {
    // Se a aritmética fosse em horário local, somar dias sobre 00:00 devolveria
    // o dia anterior no Acre. 10 dias são 10 dias em qualquer hora do dia.
    expect(vencimentoPrevisto(prod({ validade_dias: '10' }), '2026-03-01')).toBe('2026-03-11');
  });
});

describe('avisoPerecivelSemValidade', () => {
  it('cobra prazo de quem foi marcado perecível', () => {
    expect(avisoPerecivelSemValidade(prod({ perecivel: true }))).toContain('sem prazo');
  });

  it('cala quando há prazo, e quando o produto não é perecível', () => {
    expect(avisoPerecivelSemValidade(prod({ perecivel: true, validade_dias: '7' }))).toBeNull();
    expect(avisoPerecivelSemValidade(prod({}))).toBeNull();
  });
});
