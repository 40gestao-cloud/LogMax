import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetDisjuntor, estadoDisjuntor, fetchMedido, medirResposta,
  observarDisjuntor, podeLerPorAutomacao,
} from '../src/lib/disjuntor';

// O que estes testes protegem, em uma frase: o disjuntor tem de ABRIR quando a
// rede engasga, VOLTAR sozinho, e não abrir por bobagem. As três falhas
// possíveis têm custo diferente e todas doem:
//
//   · não abrir      → a queda de 22/09 de novo, oito minutos
//   · não fechar     → a turma fica com tela velha até apertar F5, e a gente
//                      trocou um travamento por um congelamento
//   · abrir demais   → pisca "rede lenta" em aula saudável e ninguém confia
//                      mais no selo

const LENTO = 6_000;    // acima do limiar de 5s, abaixo do imediato de 15s
const RAPIDO = 120;

describe('disjuntor', () => {
  beforeEach(() => { vi.useFakeTimers(); _resetDisjuntor(); });
  afterEach(() => { _resetDisjuntor(); vi.useRealTimers(); });

  it('começa fechado e deixando a automação ler', () => {
    expect(estadoDisjuntor()).toBe('fechado');
    expect(podeLerPorAutomacao()).toBe(true);
  });

  it('uma consulta lenta isolada não abre nada', () => {
    // Primeira carga de tela grande, relatório, pico de aula. Se isto abrisse,
    // o selo viveria aceso e não significaria mais nada.
    medirResposta(LENTO, 200);
    medirResposta(RAPIDO, 200);
    medirResposta(LENTO, 200);
    expect(estadoDisjuntor()).toBe('fechado');
  });

  it('três faltas SEGUIDAS abrem e cortam a leitura automática', () => {
    medirResposta(LENTO, 200);
    medirResposta(LENTO, 200);
    expect(estadoDisjuntor()).toBe('fechado');
    medirResposta(LENTO, 200);
    expect(estadoDisjuntor()).toBe('aberto');
    expect(podeLerPorAutomacao()).toBe(false);
  });

  it('um 504 abre na hora, sem esperar as três', () => {
    // 504 é o que a turma colheu 272 vezes. Não há leitura de cortesia aqui.
    medirResposta(1_000, 504);
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('resposta catastroficamente lenta abre na hora, mesmo com 200', () => {
    // No dia 22 as respostas VOLTARAM 200, depois de 19s. Medir só o status
    // deixaria o disjuntor dormindo no meio da queda.
    medirResposta(19_000, 200);
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('falha de rede (sem status) conta como falta', () => {
    medirResposta(80, null);
    medirResposta(80, null);
    medirResposta(80, null);
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('vai para meio-aberto sozinho e fecha na primeira resposta sadia', () => {
    medirResposta(1_000, 504);
    expect(estadoDisjuntor()).toBe('aberto');

    // Espera base 20s + até 20s sorteados.
    vi.advanceTimersByTime(40_100);
    expect(estadoDisjuntor()).toBe('meio-aberto');
    // Em meio-aberto a automação já pode tentar — é assim que a sonda acontece.
    expect(podeLerPorAutomacao()).toBe(true);

    medirResposta(RAPIDO, 200);
    expect(estadoDisjuntor()).toBe('fechado');
  });

  it('sonda que falha reabre sem dar as três chances de novo', () => {
    medirResposta(1_000, 504);
    vi.advanceTimersByTime(40_100);
    expect(estadoDisjuntor()).toBe('meio-aberto');

    medirResposta(LENTO, 200);
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('reincidir aumenta a espera, em vez de insistir no mesmo ritmo', () => {
    // Insistir de 20 em 20s quando o problema não passou é participar do
    // afogamento. O degrau sobe: 20s, 45s, 90s, 180s.
    medirResposta(1_000, 504);
    vi.advanceTimersByTime(40_100);
    medirResposta(LENTO, 200);            // sonda falhou → 2º degrau (45s)
    expect(estadoDisjuntor()).toBe('aberto');

    vi.advanceTimersByTime(40_100);       // o que bastava no 1º degrau
    expect(estadoDisjuntor()).toBe('aberto');

    vi.advanceTimersByTime(30_000);       // 45s + jitter
    expect(estadoDisjuntor()).toBe('meio-aberto');
  });

  it('fechar de volta zera o degrau', () => {
    medirResposta(1_000, 504);
    vi.advanceTimersByTime(40_100);
    medirResposta(RAPIDO, 200);
    expect(estadoDisjuntor()).toBe('fechado');

    // Nova queda mais tarde volta a esperar o degrau curto.
    medirResposta(1_000, 504);
    vi.advanceTimersByTime(40_100);
    expect(estadoDisjuntor()).toBe('meio-aberto');
  });

  it('avisa quem observa, na hora e a cada mudança', () => {
    const vistos: string[] = [];
    const sair = observarDisjuntor(e => vistos.push(e));
    expect(vistos).toEqual(['fechado']); // chama já com o estado atual

    medirResposta(1_000, 504);
    vi.advanceTimersByTime(40_100);
    medirResposta(RAPIDO, 200);
    expect(vistos).toEqual(['fechado', 'aberto', 'meio-aberto', 'fechado']);

    sair();
    medirResposta(1_000, 504);
    expect(vistos).toHaveLength(4); // saiu, não ouve mais
  });
});

describe('fetchMedido', () => {
  beforeEach(() => { vi.useFakeTimers(); _resetDisjuntor(); });
  afterEach(() => { _resetDisjuntor(); vi.useRealTimers(); });

  const respostaEm = (ms: number, status: number) => (async () => {
    vi.advanceTimersByTime(ms);
    return { status } as Response;
  }) as unknown as typeof fetch;

  it('mede /rest/v1/ e abre quando ele engasga', async () => {
    const f = fetchMedido(respostaEm(LENTO, 200));
    for (let i = 0; i < 3; i++) await f('https://x.supabase.co/rest/v1/recebimentos');
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('não mede upload de storage — foto de produto é lenta por natureza', async () => {
    // 6,4s numa foto com o banco saudável (dia 22). Se isto contasse, o selo
    // acenderia toda vez que a turma cadastra produto com imagem.
    const f = fetchMedido(respostaEm(LENTO, 200));
    for (let i = 0; i < 5; i++) await f('https://x.supabase.co/storage/v1/object/produto-imagens/a.jpg');
    expect(estadoDisjuntor()).toBe('fechado');
  });

  it('mede /auth/v1/ — login pendurado é o sintoma mais grave', async () => {
    // Nas duas quedas o login foi junto. É o que o professor percebe primeiro.
    const f = fetchMedido(respostaEm(1_000, 504));
    await f('https://x.supabase.co/auth/v1/token');
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('erro de rede conta e o erro continua subindo para quem chamou', async () => {
    const falhar = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const f = fetchMedido(falhar);
    for (let i = 0; i < 3; i++) {
      await expect(f('https://x.supabase.co/rest/v1/pedidos')).rejects.toThrow('offline');
    }
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('devolve a resposta intacta — medir não pode mexer no corpo', async () => {
    const f = fetchMedido(respostaEm(RAPIDO, 201));
    const r = await f('https://x.supabase.co/rest/v1/pedidos');
    expect(r.status).toBe(201);
  });

  it('poe teto na leitura: GET pendurado e abortado e conta como falta', async () => {
    // No dia 22 o gateway soltou 504 so aos 190s. A maquina esperava tres
    // minutos por uma resposta que nao ia servir.
    const pendurado = ((_u: any, init: any) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('abortado')));
    })) as unknown as typeof fetch;
    const f = fetchMedido(pendurado);
    const p = f('https://x.supabase.co/rest/v1/pedidos', { method: 'GET' });
    const esperado = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(25_100);
    await esperado;
    // Falha de rede (status null) conta — e 25s passa do limiar imediato.
    expect(estadoDisjuntor()).toBe('aberto');
  });

  it('NUNCA poe teto em escrita — POST pendurado segue pendurado', async () => {
    // A garantia central: nao existe caminho em que isto aborte um INSERT e
    // deixe o aluno sem saber se gravou.
    let injetouSignal: boolean | null = null;
    const pendurado = ((_u: any, init: any) => {
      injetouSignal = Boolean(init && init.signal);
      return new Promise(() => {}); // nunca resolve
    }) as unknown as typeof fetch;
    const f = fetchMedido(pendurado);
    let acabou = false;
    void f('https://x.supabase.co/rest/v1/recebimentos', { method: 'POST' })
      .then(() => { acabou = true; }, () => { acabou = true; });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(acabou).toBe(false);      // ninguem abortou
    expect(injetouSignal).toBe(false); // nem signal foi injetado
  });

  it('PATCH e DELETE tambem ficam fora do teto', async () => {
    const vistos: string[] = [];
    const pendurado = ((_u: any, init: any) => {
      vistos.push(init?.signal ? 'com-signal' : 'sem-signal');
      return new Promise(() => {});
    }) as unknown as typeof fetch;
    const f = fetchMedido(pendurado);
    void f('https://x.supabase.co/rest/v1/recebimentos', { method: 'PATCH' }).catch(() => {});
    void f('https://x.supabase.co/rest/v1/recebimentos', { method: 'DELETE' }).catch(() => {});
    void f('https://x.supabase.co/rest/v1/rpc/contar_pendencias', { method: 'POST' }).catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vistos).toEqual(['sem-signal', 'sem-signal', 'sem-signal']);
  });

  it('nao descarta o signal de quem chamou', async () => {
    // Alguma tela pode usar `.abortSignal()` do supabase-js. Os dois valem.
    const pendurado = ((_u: any, init: any) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('abortado')));
    })) as unknown as typeof fetch;
    const f = fetchMedido(pendurado);
    const meu = new AbortController();
    const p = f('https://x.supabase.co/rest/v1/pedidos', { method: 'GET', signal: meu.signal });
    const esperado = expect(p).rejects.toThrow();
    meu.abort();                          // muito antes dos 25s
    await esperado;
  });

  it('GET rapido nao e afetado pelo teto', async () => {
    const f = fetchMedido(respostaEm(RAPIDO, 200));
    const r = await f('https://x.supabase.co/rest/v1/pedidos', { method: 'GET' });
    expect(r.status).toBe(200);
    expect(estadoDisjuntor()).toBe('fechado');
  });
});
