import { describe, it, expect } from 'vitest';
import { luhnCheckDigit, validarImei, gerarImeis } from '../src/lib/imei';

describe('luhnCheckDigit', () => {
  // IMEI de exemplo amplamente usado em documentação de teste.
  it('fecha um IMEI conhecido', () => {
    expect(luhnCheckDigit('49015420323751')).toBe(8);
  });
});

describe('validarImei', () => {
  it('aceita 15 dígitos com Luhn correto', () => {
    expect(validarImei('490154203237518')).toBe(true);
  });
  it('aceita com espaço e hífen — é o que sai de leitor', () => {
    expect(validarImei('49-0154 2032 37518')).toBe(true);
  });
  it('recusa dígito verificador errado', () => {
    expect(validarImei('490154203237511')).toBe(false);
  });
  it('recusa comprimento diferente de 15', () => {
    expect(validarImei('4901542032375')).toBe(false);
    expect(validarImei('')).toBe(false);
    expect(validarImei(null)).toBe(false);
  });
});

describe('gerarImeis', () => {
  it('gera a quantidade pedida, toda válida e sem repetir', () => {
    const lista = gerarImeis(30, 'produto-abc');
    expect(lista).toHaveLength(30);
    expect(lista.every(validarImei)).toBe(true);
    expect(new Set(lista).size).toBe(30);
  });

  // O TAC identifica o MODELO: a segunda carga do mesmo tablet tem de nascer
  // com os mesmos 8 primeiros dígitos da primeira.
  it('mantém o TAC estável por produto', () => {
    const a = gerarImeis(3, 'produto-abc');
    const b = gerarImeis(3, 'produto-abc');
    const c = gerarImeis(3, 'produto-xyz');
    const tac = (s: string) => s.slice(0, 8);
    expect(new Set([...a, ...b].map(tac)).size).toBe(1);
    expect(tac(c[0])).not.toBe(tac(a[0]));
  });

  it('trata quantidade inválida sem estourar', () => {
    expect(gerarImeis(0, 'x')).toEqual([]);
    expect(gerarImeis(-5, 'x')).toEqual([]);
    expect(gerarImeis(NaN, 'x')).toEqual([]);
  });
});
