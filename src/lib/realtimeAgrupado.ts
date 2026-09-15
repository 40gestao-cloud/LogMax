// Assinatura de realtime com janela, sorteio e conferência de sessão — uma
// régua só para as telas que releem quando o banco muda.
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
//
// Quem precisa reagir ao payload do evento (e não reler a tabela) continua
// escrevendo o canal na mão — `useAulaConfig`, `useBlackout` e
// `useComandoRecarga` fazem isso, e está certo: não geram leitura nenhuma.
// `src/lib/reservasTrabalho.ts` também segue próprio, porque filtra o evento
// pela chave antes de decidir, coisa que só ele sabe fazer.

import { supabase } from './supabase';
import { freshToken } from './authFetch';

/** Tabela a ouvir. `filtro` é a sintaxe do PostgREST: `filial=eq.SuperMax`. */
export type AlvoRealtime = string | { tabela: string; filtro?: string };

const JANELA_MS = 1_500;
const JITTER_MS = 2_500;

export function assinarRealtime(opts: {
  /** Nome do canal; ganha sufixo único por instância. */
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
  let jaAssinou = false;
  const pendentes = new Set<string>();

  const disparar = async (tabelas: Set<string>) => {
    if (parado) return;
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

  const canalId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const canal = sb.channel(`${opts.nome}_${canalId}`);
  for (const alvo of opts.alvos) {
    const tabela = nomeTabela(alvo);
    const filtro = typeof alvo === 'string' ? undefined : alvo.filtro;
    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tabela, ...(filtro ? { filter: filtro } : {}) } as any,
      () => agendar(tabela),
    );
  }
  canal.subscribe(status => {
    if (status !== 'SUBSCRIBED') return;
    // A primeira inscrição não relê: quem chamou já carregou ao montar.
    if (jaAssinou) void disparar(todas());
    jaAssinou = true;
  });

  const auth = sb.auth.onAuthStateChange(evento => {
    if ((evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED') && semSessao) {
      void disparar(todas());
    }
  });

  return () => {
    parado = true;
    if (janela !== null) clearTimeout(janela);
    auth.data.subscription.unsubscribe();
    void sb.removeChannel(canal);
  };
}
