import { describe, it, expect } from 'vitest';
import { proximoNumeroNfDeMaior } from '../src/lib/notaFiscal';

// O que este arquivo cobre encolheu de propósito. A extração de dígitos e a
// busca do maior número passaram para o banco (RPC `resumo_recebimentos`,
// migr. 618) — o navegador não traz mais a lista de NFs da unidade só para
// reduzi-la a um máximo. O que sobra aqui é o que ainda é decisão do front:
// somar 1 e vestir o padding, e não quebrar com o que o banco devolve de ruim.
describe('proximoNumeroNfDeMaior', () => {
  it('começa em 000000001 quando a unidade não emitiu nota nenhuma', () => {
    // 0 é o que a RPC devolve nesse caso (coalesce(max(...), 0)).
    expect(proximoNumeroNfDeMaior(0)).toBe('000000001');
  });

  it('é o maior existente + 1, não a contagem de linhas', () => {
    expect(proximoNumeroNfDeMaior(10)).toBe('000000011');
  });

  it('não estoura o padding com número grande', () => {
    expect(proximoNumeroNfDeMaior(999999998)).toBe('999999999');
  });

  it('trata ausência e lixo como zero, sem travar o botão Gerar', () => {
    // RPC fora do ar, campo faltando no jsonb, resposta antiga sem a chave.
    expect(proximoNumeroNfDeMaior(null)).toBe('000000001');
    expect(proximoNumeroNfDeMaior(undefined)).toBe('000000001');
    expect(proximoNumeroNfDeMaior(NaN)).toBe('000000001');
    expect(proximoNumeroNfDeMaior(-5)).toBe('000000001');
  });

  it('corta a fração em vez de arredondar para cima', () => {
    // Não deveria chegar fracionário, mas se chegar, 7,9 não pode virar 9.
    expect(proximoNumeroNfDeMaior(7.9)).toBe('000000008');
  });
});
