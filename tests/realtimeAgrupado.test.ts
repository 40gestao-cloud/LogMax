import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Canal falso: guarda os handlers por tabela e o callback do subscribe, para o
// teste disparar evento, reconexão e mudança de sessão na mão.
const sb = vi.hoisted(() => ({
  handlers: new Map<string, (p: any) => void>(),
  aoStatus: null as null | ((s: string) => void),
  aoAuth: null as null | ((evento: string) => void),
  removidos: 0,
  criados: 0,
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
      channel: () => { sb.criados++; return ch; },
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
import { _resetDisjuntor, medirResposta } from '../src/lib/disjuntor';

describe('assinarRealtime', () => {
  let lotes: Set<string>[];
  let parar: () => void;

  // Tem de passar do PIOR caso: janela + o máximo que o sorteio pode somar
  // (4s + 6s na régua atual). Estava em 4 100 ms, que cobria a régua antiga de
  // 1,5s + 2,5s — ao abrir a janela para espalhar a manada, os testes de lote
  // passaram a medir a máquina que ainda não tinha lido. Se `JANELA_MS` ou
  // `JITTER_MS` mudarem de novo, é este número que acompanha.
  const esgotarJanela = () => vi.advanceTimersByTimeAsync(10_100);

  beforeEach(() => {
    vi.useFakeTimers();
    _resetDisjuntor();
    sb.handlers.clear();
    sb.inscricoes = [];
    sb.aoStatus = null;
    sb.aoAuth = null;
    sb.removidos = 0;
    sb.criados = 0;
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
    // Um canal por alvo: `pedidos` e `controle_caixa` com filtro.
    expect(sb.removidos).toBe(2);
  });

  // ─── Canal compartilhado ─────────────────────────────────────────────────
  // Na mesma máquina, `requisicoes` tinha três ouvintes independentes (badges,
  // aviso de devolvida, tela) — três assinaturas que o servidor confere a cada
  // mudança para entregar o mesmo evento três vezes.

  it('segundo assinante da mesma tabela entra no canal que já existe', () => {
    const antes = sb.criados;
    const parar2 = assinarRealtime({ nome: 'outro', alvos: ['pedidos'], aoMudar: () => {} });
    expect(sb.criados).toBe(antes); // nenhum canal novo
    parar2();
  });

  it('filtro diferente é outra assinatura', () => {
    const antes = sb.criados;
    const parar2 = assinarRealtime({
      nome: 'outra-filial',
      alvos: [{ tabela: 'controle_caixa', filtro: 'filial=eq.TechMax' }],
      aoMudar: () => {},
    });
    expect(sb.criados).toBe(antes + 1);
    parar2();
  });

  it('o canal só fecha quando o último sai', async () => {
    const outros: Set<string>[] = [];
    const parar2 = assinarRealtime({
      nome: 'outro', alvos: ['pedidos'], aoMudar: t => { outros.push(t); },
    });

    parar();                       // o primeiro sai
    expect(sb.removidos).toBe(1);  // só `controle_caixa`, que era só dele

    sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    await esgotarJanela();
    expect(outros).toHaveLength(1); // quem ficou continua ouvindo

    parar2();
    expect(sb.removidos).toBe(2);
  });

  // ─── Freio do disjuntor ──────────────────────────────────────────────────
  // O ponto destes testes não é "para de ler" — é "para de ler E NÃO PERDE o
  // que ia ler". Um disjuntor que descarta a releitura troca tela travada por
  // tela velha em silêncio, e aí o F5 volta a ser a única saída do aluno, que
  // é exatamente o que o disjuntor existe para evitar.

  const abrirDisjuntor = () => { medirResposta(1_000, 504); };

  it('disjuntor aberto: o lote não vai à rede, mas fica guardado', async () => {
    abrirDisjuntor();
    sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    await esgotarJanela();
    expect(lotes).toHaveLength(0);
  });

  it('e sai inteiro quando o disjuntor fecha', async () => {
    abrirDisjuntor();
    sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    sb.handlers.get('controle_caixa')!({ eventType: 'UPDATE' });
    await esgotarJanela();
    expect(lotes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(40_100);  // aberto → meio-aberto
    medirResposta(120, 200);                    // sonda sadia → fecha
    await vi.advanceTimersByTimeAsync(0);

    expect(lotes).toHaveLength(1);
    // As DUAS tabelas do lote guardado, não só a última.
    expect([...lotes[0]].sort()).toEqual(['controle_caixa', 'pedidos']);
  });

  it('eventos que chegam com o disjuntor aberto entram no mesmo lote guardado', async () => {
    abrirDisjuntor();
    sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    await esgotarJanela();
    sb.handlers.get('controle_caixa')!({ eventType: 'UPDATE' });
    await esgotarJanela();
    expect(lotes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(40_100);
    medirResposta(120, 200);
    await vi.advanceTimersByTimeAsync(0);

    // Um lote só, com tudo — e não dois, nem só um dos dois.
    expect(lotes).toHaveLength(1);
    expect([...lotes[0]].sort()).toEqual(['controle_caixa', 'pedidos']);
  });

  it('parar com lote guardado não dispara leitura quando o disjuntor fecha', async () => {
    abrirDisjuntor();
    sb.handlers.get('pedidos')!({ eventType: 'INSERT' });
    await esgotarJanela();
    parar();

    await vi.advanceTimersByTimeAsync(40_100);
    medirResposta(120, 200);
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(0);
  });

  it('a reconexão do websocket também respeita o freio, e guarda', async () => {
    abrirDisjuntor();
    sb.aoStatus!('SUBSCRIBED');          // reconexão → relê tudo
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(40_100);
    medirResposta(120, 200);
    await vi.advanceTimersByTimeAsync(0);
    expect(lotes).toHaveLength(1);
    expect([...lotes[0]].sort()).toEqual(['controle_caixa', 'pedidos']);
  });
});
