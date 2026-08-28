// Relógio do app ancorado no servidor.
//
// Bug de 2026-08-28: "faço login e, alguns segundos depois, volto para a tela
// de login". O que os logs mostram (edge_logs, projeto da turma): 796 chamadas
// a /auth/v1/token numa hora só, TODAS com status 200, todas do mesmo IP — o do
// laboratório. Nenhuma sessão de fora daquele IP passou de 2 renovações no
// mesmo dia, e no dia de aula anterior a média era 2 por sessão.
//
// Renovação que dá 200 é servidor entregando token novo de boa vontade: quem
// insiste é o cliente. O `exp` do token vem do servidor em tempo ABSOLUTO e o
// `auth-js` o compara com o `Date.now()` local (`GoTrueClient.js`,
// `__loadSession` e `_autoRefreshToken`). Relógio adiantado além de `jwt_exp`
// − 90 s ⇒ todo token nasce vencido ⇒ renovação em laço ⇒ estoura o limite do
// endpoint (150 por 5 min POR IP, e o laboratório inteiro sai por um IP só) ⇒
// 429, depois 400 no token já rotacionado, e SIGNED_OUT. Derruba junto quem
// está na máquina do lado com o relógio certo — era isso que fazia o defeito
// parecer aleatório.
//
// A primeira tentativa foi uma tarja avisando "seu relógio está adiantado".
// Ruim: acusa a máquina e manda acertar o Windows quem não tem permissão para
// mexer nele. O conserto certo é o app parar de perguntar a hora para o
// sistema operacional.
//
// É o que este módulo faz: mede uma vez, no boot, a diferença entre o relógio
// local e o do servidor, e passa a somar essa diferença em `Date.now()` e no
// `new Date()` sem argumentos. A partir daí a conta de expiração do `auth-js`
// sai certa, e de quebra `todayBR()`, ponto e lançamentos param de sair na hora
// errada na máquina desregulada.
//
// De onde vem a hora do servidor: do header `Date` de uma resposta do NOSSO
// domínio. O Supabase não serve — as respostas dele não trazem
// `Access-Control-Expose-Headers`, então o browser esconde o `Date` delas. Um
// `HEAD /api/hora` cai no rewrite do `vercel.json` (`/(.*)` → `/index.html`),
// respondido pelo CDN: não gasta invocação de function (estamos em 12/12 no
// plano Hobby) e o service worker não intercepta, porque não há
// `runtimeCaching` no `vite.config.ts` e `fetch()` não é requisição de
// navegação. Sem rede, o relógio local continua valendo — é degradar, não
// quebrar.

/** Abaixo disto o desvio não atrapalha nada e não vale mexer em global. */
const TOLERANCIA_MS = 60_000;

/** Desvio adotado, para o boot seguinte já nascer ancorado. */
const CHAVE = 'logmax:offsetServidorMs';

/** Referências originais — capturadas antes de qualquer troca. */
const DateOriginal = Date;
const nowOriginal = Date.now.bind(Date);

/** Quanto somar ao relógio local para chegar no do servidor. */
let offsetMs = 0;
let instalado = false;
let jaAncorou = false;

/** Diagnóstico (TI/console): desvio em vigor, em ms. */
export function offsetServidorMs(): number {
  return offsetMs;
}

/** Instante real da máquina, sem o offset — para medir durações. */
export function agoraLocalMs(): number {
  return nowOriginal();
}

/**
 * Troca `Date` global por uma versão que já nasce ancorada.
 *
 * Só é instalado quando existe desvio de verdade: numa máquina com a hora
 * certa nada é tocado. Depois de instalado, mudar `offsetMs` basta — a classe
 * lê a variável a cada chamada.
 *
 * `extends Date` preserva `instanceof`, `Date.parse`, `Date.UTC` e tudo o mais
 * por herança; o único comportamento alterado é o construtor SEM argumentos,
 * que é justamente "que horas são agora".
 */
function instalar(): void {
  if (instalado) return;
  instalado = true;

  class DataAncorada extends DateOriginal {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) super(nowOriginal() + offsetMs);
      // Repasse cru dos overloads de Date (ms, ISO, y/m/d…).
      else super(...(args as [number]));
    }
    static now(): number {
      return nowOriginal() + offsetMs;
    }
  }

  globalThis.Date = DataAncorada as DateConstructor;
}

function adotar(novo: number): void {
  const relevante = Math.abs(novo) > TOLERANCIA_MS;
  if (relevante) instalar();
  // Só zera de fato quando o desvio some: assim a máquina acertada no meio do
  // expediente volta ao relógio próprio sem esperar o próximo boot.
  offsetMs = relevante ? novo : 0;
  try {
    if (relevante) localStorage.setItem(CHAVE, String(Math.round(novo)));
    else localStorage.removeItem(CHAVE);
  } catch { /* modo privado */ }
}

/**
 * Mede o desvio contra o header `Date` da resposta.
 *
 * O header tem resolução de 1 s e é carimbado em algum ponto entre o envio e a
 * chegada; por isso a hora do servidor é comparada com o MEIO da viagem de
 * rede. Erro final na casa da centena de ms, contra um desvio que interessa a
 * partir de um minuto.
 */
async function medirOffset(): Promise<number | null> {
  try {
    const t0 = nowOriginal();
    const resp = await fetch(`/api/hora?_=${t0}`, { method: 'HEAD', cache: 'no-store' });
    const t1 = nowOriginal();

    const header = resp.headers.get('date');
    if (!header) return null;
    let servidor = DateOriginal.parse(header);
    if (!Number.isFinite(servidor)) return null;

    // Resposta servida do cache de borda: `Age` diz há quanto tempo aquele
    // `Date` foi carimbado. Sem isto, um HIT de CDN mediria um passado.
    const idade = Number(resp.headers.get('age'));
    if (Number.isFinite(idade) && idade > 0) servidor += idade * 1000;

    // Hora do servidor no instante t1 ≈ carimbo + meia viagem de rede.
    return servidor + (t1 - t0) / 2 - t1;
  } catch {
    return null;
  }
}

/**
 * Chamado uma vez, no boot, ANTES de criar o client do Supabase.
 *
 * O desvio guardado da última visita entra na hora (síncrono), porque a
 * primeira leitura de sessão acontece bem antes de qualquer resposta de rede
 * chegar. A medição nova refina logo em seguida — e some sozinha se a máquina
 * tiver sido acertada.
 */
export function ancorarRelogioNoServidor(): void {
  if (jaAncorou) return;
  jaAncorou = true;

  try {
    const salvo = Number(localStorage.getItem(CHAVE));
    if (Number.isFinite(salvo) && Math.abs(salvo) > TOLERANCIA_MS) {
      instalar();
      offsetMs = salvo;
    }
  } catch { /* modo privado */ }

  void medirOffset().then(medido => {
    if (medido !== null) {
      adotar(medido);
      return;
    }
    // Sem rede no boot (comum no laboratório): tenta de novo quando voltar.
    const aoVoltar = async () => {
      const tardio = await medirOffset();
      if (tardio !== null) {
        adotar(tardio);
        window.removeEventListener('online', aoVoltar);
      }
    };
    window.addEventListener('online', aoVoltar);
  });
}
