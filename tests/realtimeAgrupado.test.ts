import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Canal falso: guarda os handlers por tabela e o callback do subscribe, para o
// teste disparar evento, reconexão e mudança de sessão na mão.
const sb = vi.hoisted(() => ({
  handlers: new Map<string, (p: any) => void>(),
  aoStatus: null as null | ((s: string) => void),
  aoAuth: null as null | ((evento: string) => void),
  removidos: 0,
  token: 'tok' as string | null,
  inscricoes: [] as any[],
}));

vi.mock('../src/lib/supabase', () => {
  const ch: any = {
    on: (_t: string, cfg: any, h: (p: any) => void) => { sb.handlers.set(cfg.table, h); sb.inscricoes.push(cfg); return ch; },
    subscribe: (cb?: (s: string) => void) => { sb.aoStatus = cb ?? null; cb?.('SUBSCRIBED'); return ch; },
  };
  return {
    supabase: {
      channel: () => ch,
      removeChannel: () => { sb.removidos++; },
      auth: {
        getSession: async () => ({ data: { session: sb.token ? { access_token: sb.token } : null } }),
        onAuthStateChange: (cb: (evento: string) => void) => {
          sb.aoAuth = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    },
  };
});

import { assinarRealtime } from '../src/lib/realtimeAgrupado';

describe('assinarRealtime', () => {
  let lotes: Set<string>[];
  let parar: () => void;

  const esgotarJanela = () => vi.advanceTimersByTimeAsync(4_100);

  beforeEach(() => {
    vi.useFakeTimers();
    sb.handlers.clear();
    sb.inscricoes = [];
    sb.aoStatus = null;
    sb.aoAuth = null;
    sb.removidos = 0;
    sb.token = 'tok';
    lotes = [];
    parar = assinarRealtime({
      nome: 'teste',
      alvos: ['pedidos', { tabela: 'controle_caixa', filtro: 'filial=eq.SuperMax' }],
      aoMudar: tabelas => { lotes.push(tabelas); },
    });
  });

  afterEach(() => {
    parar();
    vi.useRealTimers();
  });

  it('a primeira inscrição não relê — quem chamou já carregou ao montar', async () => {
    await esgotarJanela();
    expect(lotes).toHaveLength(0);
  });

  it('rajada vira um lote só, com as tabelas que mudaram', async () => {
    for (let i = 0; i < 10; i++) sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    sb.handlers.get('controle_caixa')!({ eventType: 'UPDATE' });
    await esgotarJanela();
    expect(lotes).toHaveLength(1);
    expect([...lotes[0]].sort()).toEqual(['controle_caixa', 'pedidos']);
  });

  it('o filtro do PostgREST chega na inscrição', () => {
    expect(sb.inscricoes.find(c => c.table === 'controle_caixa').filter).toBe('filial=eq.SuperMax');
    expect(sb.inscricoes.find(c => c.table === 'pedidos').filter).toBeUndefined();
  });

  it('sem sessão não lê, e relê quando o login volta', async () => {
    sb.token = null;
    sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    await esgotarJanela();
    expect(lotes).toHaveLength(0);

    sb.token = 'tok';
    sb.aoAuth!('SIGNED_IN');
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(1);
    // Na volta não dá para saber o que passou: relê tudo.
    expect([...lotes[0]].sort()).toEqual(['controle_caixa', 'pedidos']);
  });

  it('refresh de rotina com a sessão intacta não relê', async () => {
    sb.aoAuth!('TOKEN_REFRESHED');
    sb.aoAuth!('SIGNED_IN');
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(0);
  });

  it('reconexão do websocket relê tudo', async () => {
    sb.aoStatus!('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(1);
    expect([...lotes[0]].sort()).toEqual(['controle_caixa', 'pedidos']);
  });

  it('depois de parar, evento pendente não vira leitura', async () => {
    sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    parar();
    await esgotarJanela();
    expect(lotes).toHaveLength(0);
    expect(sb.removidos).toBe(1);
  });
});
