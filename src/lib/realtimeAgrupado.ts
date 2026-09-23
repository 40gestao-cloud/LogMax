// Assinatura de realtime com janela, sorteio, conferência de sessão e canal
// compartilhado — uma régua só para as telas que releem quando o banco muda.
//
// Por que existe. Cada hook assinava a tabela e RELIA na hora, sem espera. Com
// a turma inteira aberta, um INSERT de um aluno virava uma leitura em cada
// máquina no mesmo instante — dezenas de consultas cravadas no mesmo segundo,
// repetidas a cada movimento de qualquer um. Em 15/09 esse padrão (badges e
// reservas de trabalho) esgotou a logmax-contabilidade: a API respondeu 504 em
// tudo por seis minutos, login incluído. Mesmo depois de corrigir aqueles dois,
// o p95 da turma seguia em 3 s com rajadas de 16 s.
//
// O que esta régua garante:
//   - Janela, não debounce: o primeiro evento marca a hora da leitura e os
//     seguintes entram no mesmo lote sem empurrar o prazo. Debounce que
//     reinicia nunca chega ao fim numa sala que escreve sem parar.
//   - Atraso sorteado por máquina: espalha o que antes era simultâneo.
//   - Sem sessão não lê. Depois dos 504 de login, máquinas com a sessão
//     perdida seguiam consultando como anon e colhendo 401 (42501).
//   - Volta do login relê — só se a sessão TINHA caído. TOKEN_REFRESHED chega
//     de hora em hora em toda máquina, e SIGNED_IN também no foco da aba.
//   - Reconexão do websocket relê: o que mudou enquanto o socket esteve fora
//     não é reenviado, e sem isso a tela fica velha até alguém apertar F5.
//   - Uma assinatura por tabela+filtro na máquina, dividida por quem pedir.
//
// ─── POR QUE A ASSINATURA É COMPARTILHADA ──────────────────────────────────
//
// A mesma tabela tinha três ouvintes independentes na mesma máquina. Em
// Cotações, `requisicoes` era assinada pelos badges do menu, pelo aviso de
// requisição devolvida e pelo `useFetchData` da tela — três canais, três
// registros que o servidor de realtime confere a CADA mudança, três checagens
// de RLS para entregar o mesmo evento três vezes. Contando tudo, uma máquina
// chegava a ~28 assinaturas antes de a pessoa abrir qualquer coisa.
//
// Agora o registro abaixo é por `tabela|filtro`: o primeiro a pedir abre o
// canal, os seguintes entram na lista de ouvintes dele, e o último a sair o
// fecha. Cada um mantém a SUA janela e o SEU sorteio — o que se divide é a
// escuta, não a decisão de quando reler. Duas telas que ouvem a mesma tabela
// continuam relendo cada uma a sua consulta, que é o certo: os dados são
// diferentes.
//
// Quem precisa reagir ao payload do evento (e não reler a tabela) continua
// escrevendo o canal na mão — `useAulaConfig`, `useBlackout` e
// `useComandoRecarga` fazem isso, e está certo: não geram leitura nenhuma.
// `src/lib/reservasTrabalho.ts` também segue próprio, porque filtra o evento
// pela chave antes de decidir, coisa que só ele sabe fazer.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { freshToken } from './authFetch';
import { observarDisjuntor, podeLerPorAutomacao } from './disjuntor';

/** Tabela a ouvir. `filtro` é a sintaxe do PostgREST: `filial=eq.SuperMax`. */
export type AlvoRealtime = string | { tabela: string; filtro?: string };

// A régua padrão: 4s de janela + até 6s sorteados por máquina.
//
// Era 1,5s + 2,5s, e ficou curto. Os badges já usavam 4+6 porque 1,5+2,5 não
// tinha bastado para eles em 15/09 — mas o default curto continuou valendo
// para TODO o resto, inclusive o `useFetchData`, que é o hook mais usado do
// app. Em 22/09 a turma da tarde fez recebimento em massa: as escritas subiram
// 55 → 79 → 92 → 114 por minuto, cada uma voltando multiplicada pela sala, e
// a chegada saltou de ~90 requisições por 10s para 234. O pool de 10 conexões
// do PostgREST encheu (`PGRST003 — Timed out acquiring connection from
// connection pool`) e a sala passou oito minutos com a tela pendurada, login
// incluído. Aluno com tela travada aperta F5, e cada F5 é um pacote de boot
// novo — foi assim que oito minutos se sustentaram.
//
// 4+6 espalha o mesmo lote por dez segundos em vez de quatro: o pico de
// chegada cai para perto de 40% do que era, sem que nenhuma tela deixe de
// atualizar. É o que os badges já provaram em produção desde 15/09.
//
// O número não é regra de negócio, é orçamento de conexão: com pool de 10 e
// consulta de ~25ms, o que derruba a aula não é o volume do dia, é o instante.
// Tela que precise de resposta mais rápida que isso passa `janelaMs` próprio —
// e deve ter um motivo escrito, como o `reservasTrabalho`.
const JANELA_MS = 4_000;
const JITTER_MS = 6_000;

/** O que um assinante quer saber. `reconectou` chega quando o websocket volta
 *  — nesse caso não dá para saber o que passou, então relê tudo. */
type Ouvinte = {
  mudou: (tabela: string) => void;
  reconectou: () => void;
};

type Assinatura = {
  canal: RealtimeChannel;
  ouvintes: Set<Ouvinte>;
  /** Primeiro SUBSCRIBED é a assinatura inicial e não relê: quem chamou
   *  acabou de carregar. Do segundo em diante é reconexão. */
  jaAssinou: boolean;
};

const registro = new Map<string, Assinatura>();

const idUnico = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/**
 * Põe `ouvinte` na assinatura de `tabela` (com `filtro`, se houver),
 * abrindo o canal se for o primeiro. Devolve como sair dela.
 */
function ouvirTabela(tabela: string, filtro: string | undefined, ouvinte: Ouvinte): () => void {
  const sb = supabase;
  if (!sb) return () => {};

  const chave = `${tabela}|${filtro ?? ''}`;
  let assinatura = registro.get(chave);

  if (!assinatura) {
    const nova: Assinatura = {
      canal: sb.channel(`rt_${tabela}_${idUnico()}`),
      ouvintes: new Set(),
      jaAssinou: false,
    };
    nova.canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tabela, ...(filtro ? { filter: filtro } : {}) } as any,
      () => { for (const o of [...nova.ouvintes]) o.mudou(tabela); },
    );
    nova.canal.subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      if (nova.jaAssinou) { for (const o of [...nova.ouvintes]) o.reconectou(); }
      nova.jaAssinou = true;
    });
    registro.set(chave, nova);
    assinatura = nova;
  }

  assinatura.ouvintes.add(ouvinte);

  return () => {
    const atual = registro.get(chave);
    if (!atual) return;
    atual.ouvintes.delete(ouvinte);
    if (atual.ouvintes.size === 0) {
      registro.delete(chave);
      void sb.removeChannel(atual.canal);
    }
  };
}

export function assinarRealtime(opts: {
  /** Nome do assinante. Só aparece em log — o canal é nomeado pela tabela,
   *  porque ele agora é de quem quiser ouvi-la. */
  nome: string;
  alvos: AlvoRealtime[];
  /** Recebe as tabelas que mudaram no lote. Na volta do login e na reconexão,
   *  recebe todas — não dá para saber o que passou enquanto ninguém ouvia. */
  aoMudar: (tabelas: Set<string>) => void | Promise<void>;
  janelaMs?: number;
  jitterMs?: number;
}): () => void {
  const sb = supabase;
  if (!sb) return () => {};

  const nomeTabela = (a: AlvoRealtime) => (typeof a === 'string' ? a : a.tabela);
  const todas = () => new Set(opts.alvos.map(nomeTabela));

  let parado = false;
  let janela: ReturnType<typeof setTimeout> | null = null;
  let semSessao = false;
  const pendentes = new Set<string>();

  // Disjuntor aberto: a leitura não acontece agora, mas NÃO se perde. As
  // tabelas do lote voltam para `pendentes` e saem juntas quando ele fechar.
  //
  // Guardar é o ponto todo. Um disjuntor que simplesmente descarta a releitura
  // troca tela travada por tela velha em silêncio — o aluno passa a ver saldo
  // de um minuto atrás sem nada na tela dizendo isso, e aí o F5 (que é o que
  // queremos evitar) volta a ser a única saída que ele tem.
  let soltarAoFechar: (() => void) | null = null;
  let naFila = false;
  const esperarDisjuntor = () => {
    if (naFila) return; // já estamos na fila
    naFila = true;
    // `observarDisjuntor` chama de volta na hora com o estado atual, ANTES de
    // devolver o cancelador. Por isso o cancelamento é marcado por bandeira e
    // executado depois: ler `soltarAoFechar` dentro do próprio callback pegaria
    // `null` e deixaria o ouvinte pendurado — e ouvinte pendurado aqui significa
    // lote que nunca sai.
    let sairAgora = false;
    soltarAoFechar = observarDisjuntor(estado => {
      if (estado === 'aberto' || parado) return;
      if (soltarAoFechar) { soltarAoFechar(); soltarAoFechar = null; }
      else sairAgora = true;
      naFila = false;
      if (pendentes.size === 0) return;
      const lote = new Set(pendentes);
      pendentes.clear();
      void disparar(lote);
    });
    if (sairAgora && soltarAoFechar) { soltarAoFechar(); soltarAoFechar = null; }
  };

  const disparar = async (tabelas: Set<string>) => {
    if (parado) return;
    if (!podeLerPorAutomacao()) {
      for (const t of tabelas) pendentes.add(t);
      esperarDisjuntor();
      return;
    }
    if (!(await freshToken())) {
      semSessao = true;
      return;
    }
    semSessao = false;
    if (parado) return;
    await opts.aoMudar(tabelas);
  };

  const agendar = (tabela: string) => {
    if (parado) return;
    pendentes.add(tabela);
    if (janela !== null) return;
    janela = setTimeout(() => {
      janela = null;
      const lote = new Set(pendentes);
      pendentes.clear();
      void disparar(lote);
    }, (opts.janelaMs ?? JANELA_MS) + Math.random() * (opts.jitterMs ?? JITTER_MS));
  };

  const ouvinte: Ouvinte = {
    mudou: tabela => agendar(tabela),
    reconectou: () => { void disparar(todas()); },
  };

  const sair = opts.alvos.map(alvo =>
    typeof alvo === 'string'
      ? ouvirTabela(alvo, undefined, ouvinte)
      : ouvirTabela(alvo.tabela, alvo.filtro, ouvinte),
  );

  const auth = sb.auth.onAuthStateChange(evento => {
    if ((evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED') && semSessao) {
      void disparar(todas());
    }
  });

  return () => {
    parado = true;
    if (janela !== null) clearTimeout(janela);
    if (soltarAoFechar) { soltarAoFechar(); soltarAoFechar = null; }
    auth.data.subscription.unsubscribe();
    for (const f of sair) f();
  };
}
