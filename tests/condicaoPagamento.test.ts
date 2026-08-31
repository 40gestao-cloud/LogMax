import { describe, it, expect } from 'vitest';
import {
  calcularCondicao, parcelasMaximas, rotuloCondicao, vencimentosPrevistos,
  type FormaPagamento,
} from '../src/lib/condicaoPagamento';

// Os números esperados aqui NÃO foram calculados a mão: saíram do gatilho
// `fn_orcamento_condicao_pagamento` rodando no banco (migr. 568), num INSERT
// real revertido por ROLLBACK. É esse o ponto do arquivo — a prévia da tela e
// a conta do banco têm de dar o MESMO número, e é aqui que a divergência
// aparece antes de o aluno ver dois valores diferentes na mesma proposta.

const cartao: FormaPagamento = {
  id: 'f-cartao',
  descricao: 'Cartão de Credito',
  taxa: 3,
  prazo: 1,
  desconto_percentual: 0,
  juros_mensal: 2.99,
  parcelas_max: 12,
  parcelas_sem_juros: 3,
  intervalo_dias: 30,
};

const pix: FormaPagamento = {
  id: 'f-pix',
  descricao: 'Pix',
  taxa: 0,
  prazo: 0,
  desconto_percentual: 5,
  juros_mensal: 0,
  parcelas_max: 1,
  parcelas_sem_juros: 1,
  intervalo_dias: 30,
};

const crediario: FormaPagamento = {
  id: 'f-crediario',
  descricao: 'Crediário da Loja',
  taxa: 0,
  prazo: 30,
  desconto_percentual: 0,
  juros_mensal: 3.5,
  parcelas_max: 10,
  parcelas_sem_juros: 1,
  intervalo_dias: 30,
  exige_limite_credito: true,
};

describe('calcularCondicao', () => {
  it('cartão em 6x cobra juros pela Tabela Price e a taxa sai do líquido', () => {
    const r = calcularCondicao(1000, 0, cartao, 6);
    expect(r.valorTotal).toBe(1107.22);
    expect(r.acrescimoJuros).toBe(107.22);
    expect(r.valorParcela).toBe(184.54);
    // 3% de taxa da adquirente: custo da loja, NÃO somado ao preço do cliente.
    expect(r.taxaAdquirente).toBe(33.22);
    expect(r.valorLiquido).toBe(1074);
  });

  it('dentro das parcelas sem juros o preço não muda', () => {
    const r = calcularCondicao(1000, 0, cartao, 3);
    expect(r.valorTotal).toBe(1000);
    expect(r.acrescimoJuros).toBe(0);
    expect(r.valorParcela).toBe(333.33);
  });

  it('Pix à vista abate o desconto da condição', () => {
    const r = calcularCondicao(1000, 0, pix, 1);
    expect(r.descontoCondicao).toBe(50);
    expect(r.valorTotal).toBe(950);
    expect(r.valorLiquido).toBe(950);
  });

  it('o desconto comercial entra antes do desconto da forma', () => {
    // 1000 − 100 (negociação) = 900; 5% de 900 = 45; total 855.
    const r = calcularCondicao(1000, 100, pix, 1);
    expect(r.base).toBe(900);
    expect(r.descontoCondicao).toBe(45);
    expect(r.valorTotal).toBe(855);
  });

  it('crediário em 4x bate com o que o banco gravou', () => {
    const r = calcularCondicao(1000, 0, crediario, 4);
    expect(r.valorTotal).toBe(1089);
    expect(r.acrescimoJuros).toBe(89);
    expect(r.valorParcela).toBe(272.25);
  });

  it('sem forma escolhida o preço é só mercadoria menos desconto', () => {
    const r = calcularCondicao(1000, 250, null, 5);
    expect(r.valorTotal).toBe(750);
    expect(r.parcelas).toBe(1);
    expect(r.taxaAdquirente).toBe(0);
  });

  it('parcelas acima do teto da forma são achatadas no teto', () => {
    expect(parcelasMaximas(pix)).toBe(1);
    expect(calcularCondicao(1000, 0, pix, 8).parcelas).toBe(1);
    expect(calcularCondicao(1000, 0, cartao, 99).parcelas).toBe(12);
  });

  it('desconto maior que a mercadoria não vira preço negativo', () => {
    const r = calcularCondicao(100, 500, pix, 1);
    expect(r.valorTotal).toBe(0);
  });
});

describe('vencimentosPrevistos', () => {
  it('a 1ª vence em D+prazo e as seguintes a cada intervalo', () => {
    const hoje = new Date(2026, 7, 31); // 31/08/2026
    const v = vencimentosPrevistos(cartao, 3, hoje);
    expect(v.map(d => d.toISOString().slice(0, 10)))
      .toEqual(['2026-09-01', '2026-10-01', '2026-10-31']);
  });

  it('Pix vence no mesmo dia', () => {
    const hoje = new Date(2026, 7, 31);
    expect(vencimentosPrevistos(pix, 1, hoje)[0].toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('rotuloCondicao', () => {
  it('descreve à vista e parcelado', () => {
    expect(rotuloCondicao('Pix', 1, 950)).toBe('Pix — à vista');
    expect(rotuloCondicao('Cartão de Credito', 6, 184.54)).toBe('Cartão de Credito — 6x de R$ 184,54');
    expect(rotuloCondicao(null, 3, 10)).toBe('—');
  });
});
