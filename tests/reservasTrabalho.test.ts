import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Canal falso: guarda o handler do postgres_changes para o teste disparar
// eventos na mão, sem Supabase de verdade.
const canal = vi.hoisted(() => ({
  handler: null as null | ((p: any) => void),
  removido: false,
  token: 'tok' as string | null,
  aoAuth: null as null | ((evento: string) => void),
}));

vi.mock('../src/lib/supabase', () => {
  const ch: any = {
    on: (_t: string, _f: unknown, h: (p: any) => void) => { canal.handler = h; return ch; },
    subscribe: () => ch,
  };
  return {
    supabase: {
      channel: () => ch,
      removeChannel: () => { canal.removido = true; },
      auth: {
        getSession: async () => ({ data: { session: canal.token ? { access_token: canal.token } : null } }),
        onAuthStateChange: (cb: (evento: string) => void) => {
          canal.aoAuth = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    },
  };
});

import { acompanharReservas, type ReservaLinha } from '../src/lib/reservasTrabalho';

const futuro = () => new Date(Date.now() + 180_000).toISOString();
const linha = (over: Partial<ReservaLinha> = {}): ReservaLinha => ({
  id: 'r1', escopo: 'cotacao', chave: 'req1:forn1', filial: 'SuperMax',
  usuario_id: 'u1', usuario_nome: 'Ana', expira_em: futuro(), ...over,
});

const esgotarJanela = async () => {
  await vi.advanceTimersByTimeAsync(3_100);
};

describe('acompanharReservas', () => {
  let leituras: number;
  let banco: ReservaLinha[];
  let parar: () => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    canal.handler = null;
    canal.removido = false;
    canal.token = 'tok';
    canal.aoAuth = null;
    leituras = 0;
    banco = [linha()];
    ({ parar } = acompanharReservas({
      nome: 'teste',
      ler: async () => { leituras++; return banco.map(r => ({ ...r })); },
      relevante: r => r.escopo === 'cotacao' && String(r.chave ?? '').startsWith('req1:'),
      aoMudar: () => {},
    }));
    await vi.advanceTimersByTimeAsync(0);
    leituras = 0;
  });

  afterEach(() => {
    parar();
    vi.useRealTimers();
  });

  it('renovação do mesmo dono não vai à rede', async () => {
    canal.handler!({ eventType: 'UPDATE', new: linha({ expira_em: futuro() }), old: { id: 'r1' } });
    await esgotarJanela();
    expect(leituras).toBe(0);
  });

  it('evento de outra requisição é descartado', async () => {
    canal.handler!({ eventType: 'INSERT', new: linha({ id: 'r9', chave: 'req2:forn1', usuario_id: 'u2' }) });
    await esgotarJanela();
    expect(leituras).toBe(0);
  });

  it('DELETE só relê se o id estava na tela', async () => {
    canal.handler!({ eventType: 'DELETE', old: { id: 'desconhecido' } });
    await esgotarJanela();
    expect(leituras).toBe(0);

    canal.handler!({ eventType: 'DELETE', old: { id: 'r1' } });
    await esgotarJanela();
    expect(leituras).toBe(1);
  });

  it('rajada de eventos relevantes vira uma leitura só', async () => {
    for (let i = 0; i < 10; i++) {
      canal.handler!({ eventType: 'INSERT', new: linha({ id: `n${i}`, chave: `req1:f${i}`, usuario_id: 'u2' }) });
    }
    await esgotarJanela();
    expect(leituras).toBe(1);
  });

  it('reserva vencida no relógio local provoca releitura, e só uma vez', async () => {
    banco = [];
    await vi.advanceTimersByTimeAsync(181_000 + 15_000);
    expect(leituras).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(leituras).toBe(1);
  });

  it('refresh de rotina com a sessão intacta não relê', async () => {
    canal.aoAuth!('TOKEN_REFRESHED');
    canal.aoAuth!('SIGNED_IN');
    await vi.advanceTimersByTimeAsync(0);
    expect(leituras).toBe(0);
  });

  it('sem sessão não vai à rede, e relê quando o login volta', async () => {
    canal.token = null;
    canal.handler!({ eventType: 'DELETE', old: { id: 'r1' } });
    await esgotarJanela();
    expect(leituras).toBe(0);

    canal.token = 'tok';
    canal.aoAuth!('SIGNED_IN');
    await vi.advanceTimersByTimeAsync(0);
    expect(leituras).toBe(1);
  });

  it('parar remove o canal', () => {
    parar();
    expect(canal.removido).toBe(true);
  });
});
