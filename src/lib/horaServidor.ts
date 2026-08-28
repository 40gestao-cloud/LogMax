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
// De onde vem a hora do servidor: da RPC `hora_servidor()` do Supabase, que
// devolve o `now()` do Postgres no CORPO da resposta.
//
// A primeira versão lia o header `Date` de um `HEAD` no próprio domínio, e
// estava errada — reportou celular e desktop certos como "10 min atrasados".
// O caminho passa pelo CDN da Vercel, e ali o `Date` não é relógio: medido em
// 28/08, a MESMA rota devolveu `HIT` com carimbo preservado e velho (15 min no
// passado, com `Age: 901`) e, noutra sondagem, `HIT` com carimbo fresco e
// `Age: 770`. Somar o `Age` conserta o primeiro caso e estraga o segundo;
// ignorá-lo faz o inverso. Não há fórmula que sirva para os dois.
//
// O corpo de uma resposta ninguém reescreve no caminho, e o `Date` do Supabase
// seria ilegível de qualquer forma (as respostas dele não trazem
// `Access-Control-Expose-Headers`). De quebra, o relógio consultado passa a ser
// exatamente o que assina o `exp` do token — que é o que derruba a sessão. Não
// gasta function da Vercel (12/12 no Hobby) e o service worker não cacheia a
// API do Supabase, por decisão registrada no `vite.config.ts`.
//
// Sem rede, o relógio local continua valendo — é degradar, não quebrar.

/** Abaixo disto o desvio não atrapalha nada e não vale mexer em global. */
const TOLERANCIA_MS = 60_000;

/**
 * Desvio maior que isto não é relógio errado, é lixo (localStorage corrompido,
 * medição absurda). Mesmo teto que a RPC de diagnóstico aplica: ~10 anos.
 */
const LIMITE_ABSURDO_MS = 315_360_000_000;

/**
 * Validade do desvio guardado. Passado isso ele não é aplicado no boot.
 *
 * Sem prazo, uma máquina que foi ACERTADA e abre o app sem rede continua
 * ancorada no desvio antigo — e passa a errar a hora para o outro lado, o dia
 * inteiro, sem nada que a corrija. Um dia é folgado para o uso diário do
 * laboratório e curto o bastante para o conserto do técnico valer no dia
 * seguinte.
 */
const VALIDADE_SALVO_MS = 24 * 60 * 60 * 1000;

/** Desvio adotado, para o boot seguinte já nascer ancorado. */
const CHAVE = 'logmax:offsetServidorMs';

/** Quando aquele desvio foi medido, pelo relógio CRU da máquina. */
const CHAVE_MEDIDO_EM = 'logmax:offsetServidorEm';

/**
 * Id da ESTAÇÃO (não da pessoa). Sorteado uma vez por navegador e guardado
 * aqui, é o que deixa a tela de TI dizer "a máquina 3f2a está 1 h adiantada"
 * em vez de "alguém, em algum lugar, está".
 */
const CHAVE_MAQUINA = 'logmax:maquinaId';

/** Referências originais — capturadas antes de qualquer troca. */
const DateOriginal = Date;
const nowOriginal = Date.now.bind(Date);

/** Quanto somar ao relógio local para chegar no do servidor. */
let offsetMs = 0;
let instalado = false;
let jaAncorou = false;

/** Resolve quando a medição do boot termina (null = não deu para medir). */
let medicaoBoot: Promise<number | null> = Promise.resolve(null);

/** Espera a medição do boot — quem for reportar o diagnóstico precisa dela. */
export function aguardarMedicao(): Promise<number | null> {
  return medicaoBoot;
}

/**
 * Avisa quando uma medição é adotada — inclusive a tardia, depois de a rede
 * voltar.
 *
 * Existe por um furo real: quando as sondagens do boot falhavam, quem reporta o
 * diagnóstico (`relogioDiagnostico.ts`) recebia null e nunca mais era chamado,
 * porque `medicaoBoot` já estava resolvida. A máquina de rede instável — a mais
 * suspeita de todas — sumia do painel de TI a sessão inteira.
 */
type OuvinteMedicao = (offsetMs: number) => void;
const ouvintes = new Set<OuvinteMedicao>();

export function aoMedir(cb: OuvinteMedicao): () => void {
  ouvintes.add(cb);
  return () => ouvintes.delete(cb);
}

/**
 * Id desta estação, criado na primeira visita. Limpar os dados do navegador
 * cria um id novo: o erro por excesso é uma linha órfã na tela de TI; o erro
 * por falta seria duas máquinas contando a mesma história.
 */
export function idDaMaquina(): string | null {
  try {
    const salvo = localStorage.getItem(CHAVE_MAQUINA);
    if (salvo && salvo.length >= 8) return salvo;
    const novo = (crypto.randomUUID?.() ?? String(nowOriginal()) + Math.random().toString(16).slice(2));
    localStorage.setItem(CHAVE_MAQUINA, novo);
    return novo;
  } catch {
    return null;  // modo privado: sem id estável, não há o que registrar
  }
}

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
  const relevante = Math.abs(novo) > TOLERANCIA_MS && Math.abs(novo) <= LIMITE_ABSURDO_MS;
  if (relevante) instalar();
  // Só zera de fato quando o desvio some: assim a máquina acertada no meio do
  // expediente volta ao relógio próprio sem esperar o próximo boot.
  offsetMs = relevante ? novo : 0;
  try {
    if (relevante) {
      localStorage.setItem(CHAVE, String(Math.round(novo)));
      // Carimbo pelo relógio CRU: os dois lados da comparação de validade usam
      // a mesma régua, então ela funciona mesmo na máquina desregulada.
      localStorage.setItem(CHAVE_MEDIDO_EM, String(nowOriginal()));
    } else {
      localStorage.removeItem(CHAVE);
      localStorage.removeItem(CHAVE_MEDIDO_EM);
    }
  } catch { /* modo privado */ }

  ouvintes.forEach(cb => { try { cb(offsetMs); } catch { /* ouvinte quebrado não derruba a medição */ } });
}

/**
 * Uma sondagem: pergunta a hora ao servidor e devolve o desvio estimado.
 *
 * O header `Date` tem resolução de 1 s e é carimbado em algum ponto entre o
 * envio e a chegada; por isso a hora do servidor é comparada com o MEIO da
 * viagem de rede. Erro final na casa da centena de ms, contra um desvio que
 * interessa a partir de um minuto.
 */
type Sondagem = { offset: number; rtt: number };

async function sondar(): Promise<Sondagem | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;

  try {
    const t0 = nowOriginal();
    // `fetch` cru, e não o client do Supabase: este módulo é chamado por
    // `supabase.ts` antes do `createClient`, e importá-lo aqui fecharia um
    // ciclo de import. A anon key basta — a RPC existe para responder antes de
    // haver sessão, que é justamente quando o relógio precisa estar ancorado.
    const resp = await fetch(`${url}/rest/v1/rpc/hora_servidor`, {
      method:  'POST',
      cache:   'no-store',
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: '{}',
    });
    const t1 = nowOriginal();
    if (!resp.ok) return null;

    // timestamptz sai do PostgREST como string ISO.
    const iso = await resp.json();
    const servidor = DateOriginal.parse(typeof iso === 'string' ? iso : '');
    if (!Number.isFinite(servidor)) return null;

    // Hora do servidor no instante t1 ≈ carimbo + meia viagem de rede.
    return { offset: servidor + (t1 - t0) / 2 - t1, rtt: t1 - t0 };
  } catch {
    return null;
  }
}

/** Quanto duas sondagens podem discordar e ainda serem a mesma verdade. */
const TOLERANCIA_ENTRE_SONDAS_MS = 5000;

/**
 * Duas sondagens que precisam concordar.
 *
 * Uma sozinha acredita no que a borda disser, e borda erra: foi um `Date` de
 * cache que fez um celular com a hora certa aparecer "10 min atrasado" na tela
 * de TI. Desvio de relógio é estável — mede duas vezes e dá o mesmo. Artefato
 * de cache não sobrevive à segunda pergunta.
 *
 * Discordando, devolve null: ficar sem âncora (e sem linha na tela de TI) é
 * melhor do que publicar um número inventado, que foi exatamente o estrago da
 * primeira versão.
 */
async function medirOffset(): Promise<number | null> {
  const a = await sondar();
  if (a === null) return null;
  await new Promise(r => setTimeout(r, 300));
  const b = await sondar();
  if (b === null) return null;
  if (Math.abs(a.offset - b.offset) > TOLERANCIA_ENTRE_SONDAS_MS) return null;
  // A de MENOR VIAGEM DE REDE é a menos contaminada — o erro da estimativa é
  // metade do RTT. Escolher pelo menor módulo (como fazia antes) puxaria a
  // leitura para zero de propósito nenhum, e subestimaria o desvio se alguém
  // apertasse a tolerância mais tarde.
  return (a.rtt <= b.rtt ? a : b).offset;
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
    const salvo  = Number(localStorage.getItem(CHAVE));
    const medido = Number(localStorage.getItem(CHAVE_MEDIDO_EM));
    // Três perguntas antes de acreditar no que ficou guardado: é número de
    // verdade, cabe numa faixa plausível e foi medido há pouco. A terceira é a
    // que impede a máquina ACERTADA e sem rede de continuar ancorada no desvio
    // de ontem, errando a hora para o outro lado o dia inteiro.
    const plausivel = Number.isFinite(salvo)
      && Math.abs(salvo) > TOLERANCIA_MS
      && Math.abs(salvo) <= LIMITE_ABSURDO_MS;
    // Carimbo ausente é herança da versão anterior: vale uma vez, e a medição
    // do boot regrava com data.
    const recente = !Number.isFinite(medido) || medido <= 0
      || nowOriginal() - medido < VALIDADE_SALVO_MS;

    if (plausivel && recente) {
      instalar();
      offsetMs = salvo;
    } else if (!plausivel || !recente) {
      localStorage.removeItem(CHAVE);
      localStorage.removeItem(CHAVE_MEDIDO_EM);
    }
  } catch { /* modo privado */ }

  medicaoBoot = medirOffset().then(medido => {
    if (medido !== null) {
      adotar(medido);
      return medido;
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
    return null;
  });
}
