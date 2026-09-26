import { describe, it, expect } from 'vitest';
import { dividirParcelas, planoDeParcelas, somarDias, somarMeses } from '../src/lib/parcelamento';

describe('dividirParcelas — o centavo que sobra vai na última', () => {
  it('10.000,10 em 3 bate com o que a RPC gravou na Adm', () => {
    expect(dividirParcelas(10000.10, 3)).toEqual([3333.37, 3333.37, 3333.36]);
  });

  it('a soma fecha o total', () => {
    const p = dividirParcelas(100, 7);
    expect(Math.round(p.reduce((s, v) => s + v, 0) * 100) / 100).toBe(100);
  });

  it('à vista é uma parcela só', () => {
    expect(dividirParcelas(1234.5, 1)).toEqual([1234.5]);
  });
});

describe('datas — texto puro, sem fuso', () => {
  it('soma dias atravessando o mês', () => {
    expect(somarDias('2026-10-10', 30)).toBe('2026-11-09');
  });

  it('31/01 + 1 mês cai no último dia de fevereiro, como no Postgres', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('atravessa o ano', () => {
    expect(somarMeses('2026-11-05', 3)).toBe('2027-02-05');
  });
});

describe('planoDeParcelas', () => {
  it('compra divide o total e anda o intervalo', () => {
    expect(planoDeParcelas(6000, 2, '2026-11-01', { intervaloDias: 30 })).toEqual([
      { numero: 1, valor: 3000, vencimento: '2026-11-01' },
      { numero: 2, valor: 3000, vencimento: '2026-12-01' },
    ]);
  });

  it('aluguel repete o valor todo mês', () => {
    const p = planoDeParcelas(2500, 3, '2026-10-05', { repete: true });
    expect(p.map(x => x.valor)).toEqual([2500, 2500, 2500]);
    expect(p.map(x => x.vencimento)).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);
  });
});
