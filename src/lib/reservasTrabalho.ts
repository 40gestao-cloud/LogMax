// Acompanhamento das reservas de trabalho (migr. 537) — uma régua só para as
// quatro telas que pintam cadeado: o hook da chave ativa, as opções travadas
// de Cotações e de Cadastro de Produtos e a lista do professor.
//
// Por que existe. Cada tela ouvia a tabela inteira e RELIA a cada evento, e
// ainda relia a cada 30s. Só que quase todo evento é `renovar_trabalho`: cada
// aluno com reserva aberta faz um UPDATE de `expira_em` por minuto. Com a sala
// cheia isso virava dezenas de eventos por minuto × duas leituras por tela ×
// todas as máquinas. Em 15/09 foram ~2,4 mil requisições em 10 minutos na
// logmax-contabilidade — a maior fonte da turma no pico que terminou em 504.
//
// O que muda:
//   - Renovação (mesma chave, mesmo dono) não mexe em nada que a tela mostre:
//     só atualiza o `expira_em` guardado aqui, sem ir à rede.
//   - Evento de outra unidade/requisição/chave é descartado pela própria tela
//     (`relevante`) antes de virar leitura.
//   - DELETE só traz o `id` (replica identity padrão): só relê se o id era de
//     uma reserva que esta tela está mostrando.
//   - O que sobra entra numa janela de 1s + até 2s sorteados por máquina, sem
//     reiniciar a cada evento — a sala não relê toda no mesmo instante.
//   - A releitura de 30s virou conferência local: só vai à rede quando alguma
//     reserva mostrada já passou do prazo no relógio desta máquina.

import { supabase } from './supabase';
import { freshToken } from './authFetch';
import { observarDisjuntor, podeLerPorAutomacao } from './disjuntor';

export type ReservaLinha = {
  id: string;
  escopo: string;
  chave: string;
  filial: string | null;
  usuario_id: string;
  usuario_nome: string;
  expira_em: string;
};

export const RESERVA_COLUNAS = 'id, escopo, chave, filial, usuario_id, usuario_nome, expira_em';

const JANELA_MS = 1_000;
const JITTER_MS = 2_000;
const CONFERENCIA_PRAZO_MS = 15_000;

export function acompanharReservas<T extends ReservaLinha>(opts: {
  nome: string;
  // `null` = leitura falhou: mantém o que está na tela em vez de apagar cadeado.
  ler: () => Promise<T[] | null>;
  relevante: (r: Partial<ReservaLinha>) => boolean;
  aoMudar: (linhas: T[]) => void;
  // O hook da chave ativa lê só depois de reservar: ler antes devolveria "sem
  // dono" e apagaria por um instante o resultado da própria reserva.
  lerAoIniciar?: boolean;
}): { parar: () => void; reler: () => void } {
  let parado = false;
  let conhecidas: T[] = [];
  let janela: ReturnType<typeof setTimeout> | null = null;
  let semSessao = false;

  // Fila de uma vaga: enquanto o disjuntor está aberto basta saber que HÁ
  // leitura devendo — não importa quantas vezes foi pedida, o estado das
  // reservas é lido por inteiro de uma vez.
  let soltarAoFechar: (() => void) | null = null;
  let naFila = false;
  const pedirReleituraAoFechar = () => {
    if (naFila) return;
    naFila = true;
    let sairAgora = false;
    soltarAoFechar = observarDisjuntor(estado => {
      if (estado === 'aberto' || parado) return;
      if (soltarAoFechar) { soltarAoFechar(); soltarAoFechar = null; }
      else sairAgora = true;
      naFila = false;
      void lerAgora();
    });
    if (sairAgora && soltarAoFechar) { soltarAoFechar(); soltarAoFechar = null; }
  };

  const lerAgora = async () => {
    // Disjuntor aberto: não lê agora, e mantém o cadeado que está na tela —
    // mesma regra do "sem sessão" logo abaixo, e pelo mesmo motivo (apagar
    // diria "livre" sem saber). Este módulo tem canal próprio e não passa pelo
    // `assinarRealtime`, então o freio precisa estar escrito aqui também: no
    // dia 22 a `trabalho_reservas` levou 111 chamadas com p95 de 190 s.
    // `pedirReleituraAoFechar` refaz a leitura quando o disjuntor fecha.
    if (!podeLerPorAutomacao()) { pedirReleituraAoFechar(); return; }
    // Sem sessão não lê. Depois dos 504 de login de 15/09, máquinas com a tela
    // aberta e a sessão perdida seguiam lendo como anon e colhendo 401. O
    // cadeado que está na tela fica como está: apagar diria "livre" sem saber.
    // Quando o login volta, o onAuthStateChange lá embaixo relê.
    if (!(await freshToken())) {
      semSessao = true;
      return;
    }
    semSessao = false;
    const linhas = await opts.ler();
    if (parado || linhas === null) return;
    conhecidas = linhas;
    opts.aoMudar(linhas);
  };

  const agendar = () => {
    if (parado || janela !== null) return;
    janela = setTimeout(() => {
      janela = null;
      void lerAgora();
    }, JANELA_MS + Math.random() * JITTER_MS);
  };

  if (opts.lerAoIniciar !== false) void lerAgora();

  const canalId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const ch = supabase?.channel(`${opts.nome}_${canalId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trabalho_reservas' }, (payload: any) => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old?.id;
        if (id && conhecidas.some(r => r.id === id)) agendar();
        return;
      }
      const nova = payload.new as Partial<ReservaLinha> | undefined;
      if (!nova || !opts.relevante(nova)) return;
      const mesma = conhecidas.find(r => r.escopo === nova.escopo && r.chave === nova.chave);
      if (mesma && mesma.usuario_id === nova.usuario_id) {
        if (nova.expira_em) mesma.expira_em = nova.expira_em;
        return;
      }
      agendar();
    })
    .subscribe();

  // Só relê na volta se a sessão TINHA caído: TOKEN_REFRESHED chega de hora em
  // hora em toda máquina, e SIGNED_IN também no foco da aba.
  const auth = supabase?.auth.onAuthStateChange(evento => {
    if ((evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED') && semSessao) void lerAgora();
  });

  const conferencia = setInterval(() => {
    const agora = Date.now();
    if (conhecidas.some(r => Date.parse(r.expira_em) <= agora)) agendar();
  }, CONFERENCIA_PRAZO_MS);

  return {
    parar: () => {
      parado = true;
      if (janela !== null) clearTimeout(janela);
      if (soltarAoFechar) { soltarAoFechar(); soltarAoFechar = null; }
      clearInterval(conferencia);
      auth?.data.subscription.unsubscribe();
      if (ch) supabase?.removeChannel(ch);
    },
    reler: () => { void lerAgora(); },
  };
}
