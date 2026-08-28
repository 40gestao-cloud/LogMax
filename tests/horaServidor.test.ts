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
