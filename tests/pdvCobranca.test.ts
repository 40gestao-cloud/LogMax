import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Espera do Pix e da maquininha (src/lib/pdv/cobranca.ts), com Supabase falso.
// O que importa aqui é dinheiro: a confirmação chega pelo realtime E pelo
// polling, muitas vezes juntos — e cada disparo a mais é uma venda a mais.

const sb = vi.hoisted(() => ({
  handler: null as null | ((p: any) => void),
  canal: '' as string,
  filtro: null as any,
  removidos: 0,
  status: 'aguardando' as string,
  consultas: 0,
  updates: [] as { tabela: string; valores: any; filtros: [string, string, any][] }[],
  inserts: [] as { tabela: string; valores: any }[],
  erroUpdate: null as null | { message: string },
}));

vi.mock('../src/lib/supabase', () => {
  const ch: any = {
    on: (_t: string, cfg: any, h: (p: any) => void) => { sb.filtro = cfg; sb.handler = h; return ch; },
    subscribe: () => ch,
  };
  const from = (tabela: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => { sb.consultas++; return { data: { status: sb.status } }; },
      }),
    }),
    update: (valores: any) => {
      const reg = { tabela, valores, filtros: [] as [string, string, any][] };
      sb.updates.push(reg);
      const q: any = {
        eq: (c: string, v: any) => { reg.filtros.push(['eq', c, v]); return q; },
        lt: (c: string, v: any) => { reg.filtros.push(['lt', c, v]); return q; },
        then: (res: any) => res({ error: sb.erroUpdate }),
      };
      return q;
    },
    insert: (valores: any) => {
      sb.inserts.push({ tabela, valores });
      return { select: () => ({ single: async () => ({ data: { id: 'novo', ...valores, valor: String(valores.valor) }, error: null }) }) };
    },
  });
  return {
    supabase: {
      channel: (nome: string) => { sb.canal = nome; return ch; },
      removeChannel: () => { sb.removidos++; },
      from,
    },
  };
});

import {
  aguardarCobranca, cancelarAguardandoAntigas, inserirPixPendente, inserirCartaoPendente, cancelarCobranca,
} from '../src/lib/pdv/cobranca';

const tick = () => new Promise(r => setTimeout(r, 0));

describe('aguardarCobranca', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    Object.assign(sb, { handler: null, canal: '', filtro: null, removidos: 0, status: 'aguardando', consultas: 0 });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('escuta a linha certa, com o canal pedido', () => {
    const parar = aguardarCobranca('pix_pendentes', 'p1', 'smx_pix_p1', () => {});
    expect(sb.canal).toBe('smx_pix_p1');
    expect(sb.filtro).toMatchObject({ event: 'UPDATE', table: 'pix_pendentes', filter: 'id=eq.p1' });
    parar();
    expect(sb.removidos).toBe(1);
  });

  it('realtime com status confirmado dispara; outro status não', () => {
    const fn = vi.fn();
    aguardarCobranca('cartao_pendentes', 'c1', 'x', fn);
    sb.handler!({ new: { status: 'aguardando' } });
    sb.handler!({ new: { status: 'pago' } }); // 'pago' é do Pix, não do cartão
    expect(fn).not.toHaveBeenCalled();
    sb.handler!({ new: { status: 'autorizado' } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('realtime e polling juntos disparam UMA vez', async () => {
    const fn = vi.fn();
    aguardarCobranca('pix_pendentes', 'p1', 'x', fn);
    sb.status = 'pago';
    sb.handler!({ new: { status: 'pago' } });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    sb.handler!({ new: { status: 'pago' } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('polling de 2s acha a confirmação que o realtime perdeu', async () => {
    const fn = vi.fn();
    aguardarCobranca('pix_pendentes', 'p1', 'x', fn);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).not.toHaveBeenCalled();
    sb.status = 'pago';
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falha devolvendo false: a trava solta e o próximo polling tenta de novo', async () => {
    const fn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    aguardarCobranca('pix_pendentes', 'p1', 'x', fn);
    sb.status = 'pago';
    sb.handler!({ new: { status: 'pago' } });
    await tick();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('falha sem devolver false (cartão, nichos) não tenta de novo', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    aguardarCobranca('cartao_pendentes', 'c1', 'x', fn);
    sb.status = 'autorizado';
    sb.handler!({ new: { status: 'autorizado' } });
    await tick();
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('depois de parar, nem realtime nem polling disparam', async () => {
    const fn = vi.fn();
    const parar = aguardarCobranca('pix_pendentes', 'p1', 'x', fn);
    sb.status = 'pago';
    parar();
    sb.handler!({ new: { status: 'pago' } });
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn).not.toHaveBeenCalled();
    expect(sb.consultas).toBe(0);
  });
});

describe('gravações da cobrança', () => {
  beforeEach(() => { sb.updates = []; sb.inserts = []; sb.erroUpdate = null; });

  it('cancela só as aguardando do operador com mais de 30s', async () => {
    await cancelarAguardandoAntigas('cartao_pendentes', 'op1');
    expect(sb.updates).toHaveLength(1);
    const u = sb.updates[0];
    expect(u.tabela).toBe('cartao_pendentes');
    expect(u.valores).toEqual({ status: 'cancelado' });
    expect(u.filtros.slice(0, 2)).toEqual([['eq', 'operador_id', 'op1'], ['eq', 'status', 'aguardando']]);
    expect(u.filtros[2][0]).toBe('lt');
    expect(u.filtros[2][1]).toBe('created_at');
  });

  it('sem operador não cancela nada', async () => {
    await cancelarAguardandoAntigas('pix_pendentes', null);
    expect(sb.updates).toHaveLength(0);
  });

  it('Pix nasce aguardando, na filial do caixa, com valor numérico de volta', async () => {
    const p = await inserirPixPendente({ valor: 26.5, clienteId: null, operadorId: 'op1', filial: 'SuperMax' });
    expect(sb.inserts[0]).toEqual({
      tabela: 'pix_pendentes',
      valores: { valor: 26.5, cliente_id: null, status: 'aguardando', operador_id: 'op1', filial: 'SuperMax' },
    });
    expect(p).toEqual({ id: 'novo', valor: 26.5 });
  });

  it('cartão leva método e parcelas', async () => {
    const c = await inserirCartaoPendente({ valor: 100, metodo: 'credito', parcelas: 3, operadorId: null, filial: 'TechMax' });
    expect(sb.inserts[0].valores).toEqual({
      valor: 100, metodo: 'credito', parcelas: 3, status: 'aguardando', operador_id: null, filial: 'TechMax',
    });
    expect(c).toEqual({ id: 'novo', valor: 100, metodo: 'credito', parcelas: 3 });
  });

  it('cancelar marca a linha e devolve o erro do banco', async () => {
    expect(await cancelarCobranca('pix_pendentes', 'p1')).toBeNull();
    expect(sb.updates[0]).toMatchObject({ tabela: 'pix_pendentes', valores: { status: 'cancelado' }, filtros: [['eq', 'id', 'p1']] });
    sb.erroUpdate = { message: 'RLS' };
    expect((await cancelarCobranca('cartao_pendentes', 'c1'))?.message).toBe('RLS');
  });
});
