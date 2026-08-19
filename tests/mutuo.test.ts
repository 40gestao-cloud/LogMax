import { describe, it, expect } from 'vitest';
import { tabelaPrice } from '../src/lib/mutuo';

// O caso que motivou a migr. 473: a Matriz aplica R$ 50.000 na filial a 2,3%
// ao mês em 12 parcelas. Antes, o sistema cobrava a taxa UMA VEZ sobre o
// contrato inteiro (R$ 1.150 de juros); a conta certa dá R$ 7.786,23.
//
// Os números abaixo estão fixados de propósito: se alguém trocar o regime de
// juros sem querer, o teste diz exatamente quanto de dinheiro mudou.
describe('tabelaPrice — mútuo Matriz → filial', () => {
  const t = tabelaPrice(50000, 2.3, 12);

  it('parcela fixa de R$ 4.815,52', () => {
    expect(t.valorParcela).toBe(4815.52);
    // Todas iguais menos a última, que absorve o resto dos centavos.
    for (const p of t.parcelas.slice(0, 11)) expect(p.parcela).toBe(4815.52);
  });

  it('cobra R$ 7.786,23 de juros, não R$ 1.150', () => {
    expect(t.totalJuros).toBe(7786.23);
    expect(t.totalPago).toBe(57786.23);
  });

  it('o primeiro juro é a taxa sobre o principal cheio', () => {
    expect(t.parcelas[0].juros).toBe(1150);
    expect(t.parcelas[0].amortizacao).toBe(3665.52);
  });

  it('o juro cai e a amortização sobe ao longo do contrato', () => {
    for (let k = 1; k < t.parcelas.length; k++) {
      expect(t.parcelas[k].juros).toBeLessThan(t.parcelas[k - 1].juros);
      expect(t.parcelas[k].amortizacao).toBeGreaterThan(t.parcelas[k - 1].amortizacao);
    }
  });

  it('as amortizações somam o principal exato e o saldo fecha em zero', () => {
    const soma = t.parcelas.reduce((s, p) => s + p.amortizacao, 0);
    expect(Math.round(soma * 100) / 100).toBe(50000);
    expect(t.parcelas[t.parcelas.length - 1].saldo).toBe(0);
  });
});

describe('tabelaPrice — bordas', () => {
  it('taxa zero vira rateio simples, sem divisão por zero', () => {
    const t = tabelaPrice(1200, 0, 12);
    expect(t.valorParcela).toBe(100);
    expect(t.totalJuros).toBe(0);
    expect(t.totalPago).toBe(1200);
  });

  it('parcela única cobra o juro de um mês', () => {
    const t = tabelaPrice(1000, 10, 1);
    expect(t.parcelas).toHaveLength(1);
    expect(t.parcelas[0].juros).toBe(100);
    expect(t.parcelas[0].amortizacao).toBe(1000);
    expect(t.totalPago).toBe(1100);
  });

  it('principal zerado não gera parcela', () => {
    expect(tabelaPrice(0, 2.3, 12).parcelas).toHaveLength(0);
  });
});
