// Disjuntor — o freio que faltava.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// Duas vezes a logmax-contabilidade travou no meio da aula (15/09 e 22/09): a
// API parou de responder em tempo útil e a sala inteira ficou minutos com a
// tela "só carregando", login incluído. As duas vezes o conserto foi baixar
// carga — embrulhar a RLS, agrupar canal, abrir a janela do realtime. As duas
// vezes a carga voltou a caber, e a queda voltou a acontecer.
//
// Olhando os números do dia 22 dá para ver por quê. A sala saudável rodava ~9
// requisições por segundo a 22 ms. O pico foi ~23/s — mais baixo do que às
// 18:15, que passou ilesa. O volume não explica oito minutos de queda. O que
// explica é o LAÇO:
//
//     fila cresce → resposta demora → aluno aperta F5 → +9 requisições de boot
//        → fila cresce mais → ...
//
// Oito minutos não foi o tempo de digerir a carga. Foi o tempo que a sala levou
// para desistir de tentar.
//
// E o app não tinha nada que olhasse para o relógio e decidisse parar. Todos os
// mecanismos empurravam para o mesmo lado: o realtime relê, a volta ao foco
// relê, o F5 recarrega tudo. Realimentação positiva, sem freio. Reduzir a
// amplitude da manada (migr. 618, janela de 4→10s) deixa o laço mais difícil de
// começar; não o faz terminar sozinho.
//
// Este módulo é o freio. Quando as respostas passam a demorar, ele CORTA o
// tráfego que a máquina gera por conta própria — releitura de realtime,
// releitura de foco, contagem de bolinha — e deixa passar o que a pessoa pediu
// e tudo que ESCREVE. Depois volta devagar, em horário sorteado por máquina.
//
// O objetivo não é a turma não sentir nada. É a queda durar trinta segundos em
// vez de oito minutos, e terminar sem ninguém intervir.
//
// ─── O QUE ELE NÃO FAZ, DE PROPÓSITO ────────────────────────────────────────
//
// · Não corta escrita. O aluno lançando recebimento é o trabalho da aula; um
//   disjuntor que engole INSERT troca uma queda visível por perda de dado
//   silenciosa, que é pior. Escrita é 1/17 do tráfego desta tela — não é dela
//   que vem o afogamento.
// · Não corta a primeira leitura de uma tela. Abrir um menu é intenção da
//   pessoa; tela em branco por decisão nossa é a mesma frustração do
//   travamento, com a diferença de que a culpa é nossa.
// · Não aborta requisição em voo. Um `AbortController` em cima de escrita deixa
//   o aluno sem saber se gravou, e o wrapper de `fetch` não sabe distinguir
//   intenção. Fica para depois, se a medição mostrar que precisa.
// · Não mede upload de imagem. `/storage/` é lento por natureza (6,4 s numa
//   foto de produto no dia 22, com o banco saudável) e viraria alarme falso.
//   Medimos `/rest/v1/` e `/auth/v1/`, que são as que TÊM de ser rápidas.

/** Estado do disjuntor. */
export type EstadoDisjuntor = 'fechado' | 'aberto' | 'meio-aberto';

/**
 * Acima disto a resposta conta como falta. 5s é folgado de propósito: o p95
 * saudável da turma é ~300ms e o pior dia normal bateu 2,5s. Não queremos
 * disparar em pico de aula, e sim no começo do laço.
 */
const LIMIAR_LENTO_MS = 5_000;

/** Uma só resposta assim já abre: não há cenário saudável aqui. */
const LIMIAR_IMEDIATO_MS = 15_000;

/** Faltas seguidas para abrir. Seguidas, não acumuladas: uma consulta lenta
 *  isolada (relatório, primeira carga de tela grande) não deve abrir nada. */
const FALTAS_PARA_ABRIR = 3;

/**
 * Descanso antes de tentar de novo, escalando a cada reincidência. A turma
 * inteira sorteia dentro da janela (`JITTER_ESPERA_MS`) para não voltar em
 * bloco — o mesmo princípio da manada do realtime: o que mata é o instante.
 */
const ESPERAS_MS = [20_000, 45_000, 90_000, 180_000];
const JITTER_ESPERA_MS = 20_000;

type Ouvinte = (estado: EstadoDisjuntor) => void;

let estadoAtual: EstadoDisjuntor = 'fechado';
let faltasSeguidas = 0;
let nivel = 0; // índice em ESPERAS_MS — sobe a cada reincidência
let voltaEm: ReturnType<typeof setTimeout> | null = null;
const ouvintes = new Set<Ouvinte>();

const avisar = () => { for (const o of [...ouvintes]) o(estadoAtual); };

/** Observa o estado. Chama na hora com o valor atual e devolve como sair. */
export function observarDisjuntor(cb: Ouvinte): () => void {
  ouvintes.add(cb);
  cb(estadoAtual);
  return () => { ouvintes.delete(cb); };
}

export const estadoDisjuntor = (): EstadoDisjuntor => estadoAtual;

/**
 * A pergunta que os geradores de tráfego automático fazem antes de ler.
 *
 * `false` NÃO significa "desista": significa "guarde o que você ia fazer e
 * refaça quando eu fechar". Quem chama precisa acumular o pendente — senão a
 * tela fica velha em silêncio, que é o bug que este módulo não pode criar.
 */
export const podeLerPorAutomacao = (): boolean => estadoAtual !== 'aberto';

function abrir() {
  const jaEstava = estadoAtual === 'aberto';
  estadoAtual = 'aberto';
  faltasSeguidas = 0;
  if (voltaEm !== null) clearTimeout(voltaEm);

  const espera = ESPERAS_MS[Math.min(nivel, ESPERAS_MS.length - 1)]
    + Math.random() * JITTER_ESPERA_MS;
  // Reincidir sobe o degrau: se voltamos e caiu de novo, o problema não passou
  // e insistir de dez em dez segundos é participar do afogamento.
  nivel = Math.min(nivel + 1, ESPERAS_MS.length - 1);

  voltaEm = setTimeout(() => {
    voltaEm = null;
    estadoAtual = 'meio-aberto';
    avisar();
  }, espera);

  if (!jaEstava) {
    console.warn(
      `[disjuntor] aberto — leitura automática suspensa por ~${Math.round(espera / 1000)}s. `
      + 'Escrita e ação da pessoa seguem passando.',
    );
    avisar();
  }
}

function fechar() {
  if (estadoAtual === 'fechado') return;
  if (voltaEm !== null) { clearTimeout(voltaEm); voltaEm = null; }
  estadoAtual = 'fechado';
  faltasSeguidas = 0;
  nivel = 0;
  console.info('[disjuntor] fechado — leitura automática liberada.');
  avisar();
}

/**
 * Registra o resultado de uma requisição. Chamado pelo `fetch` do cliente
 * Supabase (ver `supabase.ts`), que é o único lugar por onde tudo passa.
 *
 * `status` é `null` quando o `fetch` nem chegou a responder (rede caiu,
 * requisição estourou no gateway) — isso conta como falta.
 */
export function medirResposta(ms: number, status: number | null): void {
  const falta =
    status === null
    || status === 408 || status === 429 || status === 503 || status === 504
    || ms >= LIMIAR_LENTO_MS;

  if (!falta) {
    // Em meio-aberto, uma resposta sadia basta para fechar: a sonda passou.
    if (estadoAtual === 'meio-aberto') fechar();
    else faltasSeguidas = 0;
    return;
  }

  if (ms >= LIMIAR_IMEDIATO_MS || status === 504) { abrir(); return; }

  // Em meio-aberto não há segunda chance: a sonda falhou, volta a abrir com o
  // degrau mais alto.
  if (estadoAtual === 'meio-aberto') { abrir(); return; }

  faltasSeguidas += 1;
  if (faltasSeguidas >= FALTAS_PARA_ABRIR) abrir();
}

/** Só para teste: devolve o módulo ao estado de partida. */
export function _resetDisjuntor(): void {
  if (voltaEm !== null) clearTimeout(voltaEm);
  voltaEm = null;
  estadoAtual = 'fechado';
  faltasSeguidas = 0;
  nivel = 0;
  ouvintes.clear();
}

/**
 * Envolve um `fetch` para medir o que interessa. Só `/rest/v1/` e `/auth/v1/`
 * entram na conta — ver o cabeçalho sobre `/storage/`.
 */
export function fetchMedido(base: typeof fetch = fetch): typeof fetch {
  return async (entrada: any, init?: any) => {
    const url = typeof entrada === 'string' ? entrada
      : entrada instanceof URL ? entrada.toString()
      : entrada?.url ?? '';
    const conta = url.includes('/rest/v1/') || url.includes('/auth/v1/');
    if (!conta) return base(entrada, init);

    const t0 = Date.now();
    try {
      const r = await base(entrada, init);
      medirResposta(Date.now() - t0, r.status);
      return r;
    } catch (e) {
      medirResposta(Date.now() - t0, null);
      throw e;
    }
  };
}
