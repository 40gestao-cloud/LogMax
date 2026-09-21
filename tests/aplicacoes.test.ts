import { describe, it, expect } from 'vitest';
import { irPct, projetarRendimento, calcularResgate, projetarResgate } from '../src/lib/aplicacoes';

// Os números fixados aqui saíram do banco, não da planilha: são o resultado do
// exercício de `aplicar_em_banco` + 2× `fechar_mes_aplicacoes` +
// `resgatar_aplicacao` rodado numa transação revertida em 21/09/2026, antes de
// a migr. 604 ser aplicada. Se a projeção da tela deixar de bater com eles, é
// a tela que está mentindo sobre o extrato.
describe('aplicações financeiras', () => {
  it('capitaliza juro composto arredondando a cada mês', () => {
    // 1.000.000 a 0,84% a.m.: mês 1 = 8.400,00; mês 2 sobre 1.008.400 = 8.470,56.
    expect(projetarRendimento(1_000_000, 0.84, 1)).toBe(8_400);
    expect(projetarRendimento(1_000_000, 0.84, 2)).toBe(16_870.56);
  });

  it('não rende nada com zero meses fechados', () => {
    expect(projetarRendimento(1_000_000, 0.84, 0)).toBe(0);
  });

  it('aplica a tabela regressiva do IR por meses fechados', () => {
    expect(irPct(0)).toBe(22.5);
    expect(irPct(6)).toBe(22.5);
    expect(irPct(7)).toBe(20);
    expect(irPct(12)).toBe(20);
    expect(irPct(13)).toBe(17.5);
    expect(irPct(24)).toBe(17.5);
    expect(irPct(25)).toBe(15);
  });

  it('desconta IR só do rendimento, nunca do principal', () => {
    const r = calcularResgate(1_000_000, 16_870.56, 2, false);
    expect(r.irPct).toBe(22.5);
    expect(r.ir).toBe(3_795.88);
    expect(r.liquido).toBe(13_074.68);
    expect(r.creditado).toBe(1_013_074.68);
  });

  it('poupança é isenta: o bruto volta inteiro', () => {
    const r = projetarResgate(100_000, 0.5, 3, true);
    expect(r.irPct).toBe(0);
    expect(r.ir).toBe(0);
    expect(r.liquido).toBe(r.bruto);
    expect(r.creditado).toBe(100_000 + r.bruto);
  });

  it('prazo maior derruba a alíquota', () => {
    const curto = projetarResgate(50_000, 0.86, 3, false);
    const longo = projetarResgate(50_000, 0.86, 25, false);
    expect(curto.irPct).toBe(22.5);
    expect(longo.irPct).toBe(15);
  });
});
