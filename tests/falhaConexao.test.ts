import { describe, it, expect } from 'vitest';
import { ehFalhaDeConexao, comRetentativa } from '../lib/auth';

// A régua que separa "a rede caiu" de "a credencial é ruim". Ela decide se o
// endpoint responde 503 ("tente de novo") ou 401/404 ("saia e entre de novo" /
// "não existe") — errar para o lado errado foi o que fez a criação de usuário
// acusar sessão encerrada numa pane de 25 segundos (13/09/2026).

describe('ehFalhaDeConexao', () => {
  it('reconhece a assinatura da pane: mensagem "{}" sem corpo', () => {
    // supabase-js serializa com JSON.stringify quando o fetch morre sem corpo.
    expect(ehFalhaDeConexao({ message: '{}' })).toBe(true);
    expect(ehFalhaDeConexao({ message: '' })).toBe(true);
  });

  it('reconhece erro retentável do GoTrue e falha de fetch', () => {
    expect(ehFalhaDeConexao({ name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 })).toBe(true);
    expect(ehFalhaDeConexao({ name: 'TypeError', message: 'fetch failed' })).toBe(true);
    expect(ehFalhaDeConexao({ message: 'FetchError: socket hang up', code: '' })).toBe(true);
    expect(ehFalhaDeConexao({ message: 'Internal Server Error', status: 500 })).toBe(true);
    expect(ehFalhaDeConexao({ message: 'rate limited', status: 429 })).toBe(true);
  });

  it('NÃO confunde JWT vencido com pane — isso é 401 de verdade', () => {
    expect(ehFalhaDeConexao({ name: 'AuthApiError', message: 'invalid JWT: unable to parse or verify signature', status: 403 })).toBe(false);
    expect(ehFalhaDeConexao({ message: 'Auth session missing!', status: 400 })).toBe(false);
    expect(ehFalhaDeConexao({ message: 'User already registered', status: 422 })).toBe(false);
  });

  it('NÃO confunde "nenhuma linha" com pane — .single() vazio é 404 de verdade', () => {
    expect(ehFalhaDeConexao(
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      406,
    )).toBe(false);
  });

  it('erro de SQL de verdade passa batido (não é rede)', () => {
    expect(ehFalhaDeConexao({ code: '42703', message: 'column "x" does not exist' }, 400)).toBe(false);
  });

  it('sem erro, não há pane', () => {
    expect(ehFalhaDeConexao(null)).toBe(false);
    expect(ehFalhaDeConexao(undefined, 200)).toBe(false);
  });
});

describe('comRetentativa', () => {
  it('repete enquanto for pane e devolve o primeiro resultado bom', async () => {
    let chamadas = 0;
    const r = await comRetentativa(
      async () => {
        chamadas++;
        return chamadas < 3 ? { error: { message: '{}' } } : { error: null, data: 'ok' };
      },
      x => ehFalhaDeConexao(x.error),
    );
    expect(chamadas).toBe(3);
    expect((r as any).data).toBe('ok');
  });

  it('não repete o que não é pane', async () => {
    let chamadas = 0;
    await comRetentativa(
      async () => { chamadas++; return { error: { message: 'invalid JWT', status: 403 } }; },
      x => ehFalhaDeConexao(x.error),
    );
    expect(chamadas).toBe(1);
  });

  it('desiste depois de duas retentativas', async () => {
    let chamadas = 0;
    const r = await comRetentativa(
      async () => { chamadas++; return { error: { message: '{}' } }; },
      x => ehFalhaDeConexao(x.error),
    );
    expect(chamadas).toBe(3);
    expect(ehFalhaDeConexao((r as any).error)).toBe(true);
  });
});
