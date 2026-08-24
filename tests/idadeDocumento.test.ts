// "Parada há N dias" nas filas de aprovação (plano de requisições, item 18).
//
// O que estes testes seguram é o fuso: `requisicoes.data` é coluna `date` e
// chega como 'YYYY-MM-DD', que JÁ é o dia local. Ler isso com `new Date()` a
// trataria como meia-noite UTC — 19h do dia ANTERIOR no Acre (UTC-5) —, e a
// requisição aberta hoje aparecia como "parada há 1 dia", com o âmbar de dois
// dias acendendo com um. O carimbo `timestamptz` (`correcao_solicitada_em`)
// não tem esse problema e precisa continuar sem ter.

import { describe, it, expect } from 'vitest';
import { diasDesde, paradaHaDias, todayBR, daysAgoBR } from '../src/lib/dates';

describe('diasDesde', () => {
  it('lê coluna `date` como dia local — hoje é zero, não um', () => {
    expect(diasDesde(todayBR())).toBe(0);
  });

  it('conta os dias de uma `date` no passado', () => {
    expect(diasDesde(daysAgoBR(1))).toBe(1);
    expect(diasDesde(daysAgoBR(3))).toBe(3);
  });

  it('conta o instante `timestamptz` de agora como zero dia', () => {
    expect(diasDesde(new Date().toISOString())).toBe(0);
  });

  it('conta um `timestamptz` de dois dias atrás como dois', () => {
    const doisDias = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(diasDesde(doisDias)).toBe(2);
  });

  it('devolve null sem data — a fila simplesmente não mostra idade', () => {
    expect(diasDesde(null)).toBeNull();
    expect(diasDesde(undefined)).toBeNull();
    expect(diasDesde('')).toBeNull();
    expect(diasDesde('nao é data')).toBeNull();
  });
});

describe('paradaHaDias', () => {
  it('não diz "parada" no dia em que o documento nasceu', () => {
    expect(paradaHaDias(todayBR())).toBe('aberta hoje');
  });

  it('usa singular no primeiro dia', () => {
    expect(paradaHaDias(daysAgoBR(1))).toBe('parada há 1 dia');
  });

  it('usa plural do segundo em diante — é onde o âmbar acende', () => {
    expect(paradaHaDias(daysAgoBR(2))).toBe('parada há 2 dias');
  });
});
