import { describe, it, expect } from 'vitest';
import { proximoNumeroNf } from '../src/lib/notaFiscal';

describe('proximoNumeroNf', () => {
  it('começa em 000000001 quando não há nenhuma nota ainda', () => {
    expect(proximoNumeroNf([])).toBe('000000001');
  });

  it('é o maior existente + 1, não a contagem de linhas', () => {
    // Buraco proposital: 3 números, mas o maior é 000000010.
    expect(proximoNumeroNf(['000000001', '000000010', '000000003'])).toBe('000000011');
  });

  it('ignora lixo sem dígito nenhum, sem travar a conta', () => {
    expect(proximoNumeroNf(['abc', '', null, undefined, '000000050'])).toBe('000000051');
  });

  it('extrai dígitos de texto digitado com formatação', () => {
    // '000.123' vira '000123' pelo replace(/\D/g, '') — dígitos importam, pontuação não.
    expect(proximoNumeroNf(['000.123'])).toBe('000000124');
  });

  it('não estoura o padding com número grande', () => {
    expect(proximoNumeroNf(['999999998'])).toBe('999999999');
  });

  it('só o maior número vale, mesmo repetido ou fora de ordem', () => {
    expect(proximoNumeroNf(['000000005', '000000005', '000000002'])).toBe('000000006');
  });
});
