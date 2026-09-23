import { describe, it, expect, afterEach, vi } from 'vitest';

// Ancoragem do relógio pelo token recém-emitido.
//
// Esta é a rede de segurança do relógio: a sondagem ao banco pode falhar (rede
// engasgada no boot do laboratório), e sem nada no lugar o `auth-js` volta a
// comparar o `exp` do token com o relógio cru da máquina — que foi o defeito
// que derrubava a turma inteira de volta para a tela de login.
//
// O que se testa aqui é a regra que uma primeira versão errou: o `iat` só vale
// quando o token ACABOU de nascer. Token restaurado do localStorage é velho por
// natureza, e usá-lo acusava "relógio adiantado" em aparelho com a hora certa.

const DateReal = globalThis.Date;

afterEach(() => {
  globalThis.Date = DateReal;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** JWT de mentira: só o payload importa, e ninguém verifica assinatura aqui. */
function tokenComIat(iatSegundos: number): string {
  const payload = Buffer.from(JSON.stringify({ iat: iatSegundos, exp: iatSegundos + 3600 }))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `cabecalho.${payload}.assinatura`;
}

const carregar = () => import('../src/lib/horaServidor');

describe('ancoragem pelo token recém-emitido', () => {
  it('adota o desvio quando o servidor está 1 h à frente da máquina', async () => {
    const { ancorarComTokenFresco, offsetServidorMs } = await carregar();
    const agora = DateReal.now();

    // Servidor 1 h à frente = máquina ATRASADA 1 h.
    ancorarComTokenFresco(tokenComIat(Math.round(agora / 1000) + 3600));

    // Tolerância generosa: a conta usa o relógio real entre as duas linhas.
    expect(offsetServidorMs()).toBeGreaterThan(3600_000 - 5000);
    expect(offsetServidorMs()).toBeLessThan(3600_000 + 5000);
    // E o `Date` global passa a responder pela hora do servidor.
    expect(Date.now() - agora).toBeGreaterThan(3600_000 - 5000);
  });

  it('não mexe em nada quando a máquina está na hora', async () => {
    const { ancorarComTokenFresco, offsetServidorMs } = await carregar();

    ancorarComTokenFresco(tokenComIat(Math.round(DateReal.now() / 1000)));

    expect(offsetServidorMs()).toBe(0);
    // Máquina certa não paga por uma troca de global que não precisa.
    expect(globalThis.Date).toBe(DateReal);
  });

  it('ignora token ausente ou ilegível em vez de quebrar o boot', async () => {
    const { ancorarComTokenFresco, offsetServidorMs } = await carregar();

    ancorarComTokenFresco(null);
    ancorarComTokenFresco('');
    ancorarComTokenFresco('nao-e-jwt');
    ancorarComTokenFresco('a.b');            // payload que não é base64 de JSON
    ancorarComTokenFresco(tokenComIat(NaN)); // iat inválido

    expect(offsetServidorMs()).toBe(0);
    expect(globalThis.Date).toBe(DateReal);
  });

  it('recusa desvio absurdo (token corrompido não vira relógio)', async () => {
    const { ancorarComTokenFresco, offsetServidorMs } = await carregar();

    // ~100 anos à frente: não é relógio errado, é lixo.
    ancorarComTokenFresco(tokenComIat(Math.round(DateReal.now() / 1000) + 3_153_600_000));

    expect(offsetServidorMs()).toBe(0);
  });
});

// ─── Boot fora do navegador ────────────────────────────────────────────────
//
// O `ancorarRelogioNoServidor` é a PRIMEIRA linha do `src/lib/supabase.ts`, e
// qualquer teste que importe aquele módulo o executa. Fora do navegador
// `medirOffset()` devolve null (não há `VITE_SUPABASE_URL`), o que cai no
// caminho "sem rede no boot" — e ali havia um `window.addEventListener` cru.
//
// O estrago não era um teste vermelho, que seria fácil de ver. O
// `ReferenceError` nascia dentro de um `.then()`, virava REJEIÇÃO NÃO TRATADA, e
// o vitest a contava em "Errors": 384 testes verdes, 3 errors, exit code 1.
// Ninguém tinha visto porque o job único do CI morria antes disso, no setup.ts,
// e localmente a rejeição costuma chegar depois de o resumo fechar.
describe('boot sem window (Node, CI)', () => {
  it('não rejeita nem lança quando não há navegador', async () => {
    expect(typeof globalThis.window).toBe('undefined'); // o ambiente do grupo estatico

    // A sondagem TEM de falhar, senão o caminho do bug não é tomado — e foi
    // exatamente por isso que isto passou despercebido: na máquina de quem
    // desenvolve há `.env`, a sondagem funciona (medida: 57,5 ms de desvio) e o
    // `else` nunca roda. No CI, sem `.env`, ela devolve null e o bug aparece.
    // Stub em vez de depender do ambiente: o teste vale nos dois.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('sem rede')));

    const { ancorarRelogioNoServidor, aguardarMedicao } = await carregar();

    // Não lança na chamada...
    expect(() => ancorarRelogioNoServidor()).not.toThrow();
    // ...e a promessa do boot RESOLVE em vez de rejeitar. É este await que
    // pegaria a regressão: sem a guarda, aqui vem o ReferenceError.
    await expect(aguardarMedicao()).resolves.toBeNull();
  });
});
