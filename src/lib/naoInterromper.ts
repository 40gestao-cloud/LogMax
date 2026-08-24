// Quando NÃO se pode interromper o aluno.
//
// Duas coisas nesta casa interrompem quem está a trabalhar: o modal que abre
// sozinho (avisos, documentos, requisição devolvida) e — muito pior — o reload
// da PWA quando sai versão nova. O primeiro cobre a tela; o segundo apaga o
// que a pessoa tinha digitado e não gravou.
//
// A regra é a mesma para os dois, então mora num sítio só. Antes deste arquivo
// a lista de telas de operação estava copiada em dois componentes, e a terceira
// cópia já ia nascer aqui.
//
// ── As travas ───────────────────────────────────────────────────────────────
// `emOperacao` e `digitandoAgora` são heurísticas: acertam o caso comum e não
// sabem nada sobre o que a tela guarda em memória. Uma tela que segura trabalho
// não gravado — carrinho do PDV, contagem de inventário, lote de requisições
// meio preenchido — declara isso com `useTravaAtualizacao`, e aí não é palpite.

/** Telas de OPERAÇÃO: há alguém (ou uma contagem física) esperando do outro
 *  lado, e interromper não é inconveniência, é erro de operação. */
export const VIEWS_DE_OPERACAO = new Set([
  'vendas-pdv',
  'vendas-devoluções',
  'vendas-pedidosonline',
  'financeiro-controledecaixa',
  'estoque-recebimentos',
  'estoque-expedição',
  'estoque-inventários',
]);

export function emOperacao(view?: string | null): boolean {
  return !!view && VIEWS_DE_OPERACAO.has(view);
}

/** Alguém está digitando? Vale em qualquer tela, inclusive dentro de modal. */
export function digitandoAgora(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

// ── Travas nomeadas ─────────────────────────────────────────────────────────
//
// Módulo com estado, e não Context, de propósito: quem precisa ler isto é o
// registador do service worker, que vive FORA da árvore autenticada (App.tsx
// monta o PwaUpdatePrompt acima do LogMaxAppInner). Um Context obrigaria a
// subir o provider acima de tudo só para isso.

const travas = new Map<string, string>();

/** Trava o reload automático. `chave` identifica quem travou; `motivo` é o que
 *  o utilizador lê no banner. */
export function travarAtualizacao(chave: string, motivo: string): void {
  travas.set(chave, motivo);
}

export function destravarAtualizacao(chave: string): void {
  travas.delete(chave);
}

/** Última interação real do utilizador (clique, tecla, toque, scroll). */
let ultimaInteracao = Date.now();

if (typeof window !== 'undefined') {
  const marcar = () => { ultimaInteracao = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(ev, marcar, { passive: true, capture: true });
  }
}

/** Quanto tempo parado conta como "não está no meio de nada". Curto de
 *  propósito: numa aula a pessoa para o tempo todo, e a versão nova precisa
 *  chegar no mesmo dia — foi por não chegar que meia turma ficou com o service
 *  worker antigo em 10/08. */
export const OCIOSO_MS = 20_000;

/**
 * Por que NÃO se pode recarregar agora — ou `null` se pode.
 *
 * `ignorarOcioso` serve para a aba escondida: se a pessoa saiu para outra aba,
 * o relógio de ociosidade não diz nada, e recarregar ali é o momento mais
 * seguro que existe. As travas e a tela de operação continuam valendo.
 */
export function motivoDeAdiar(opts?: { view?: string | null; ignorarOcioso?: boolean }): string | null {
  const primeira = travas.values().next();
  if (!primeira.done) return primeira.value;
  if (emOperacao(opts?.view)) return 'operação em curso nesta tela';
  if (digitandoAgora()) return 'você está a escrever';
  if (!opts?.ignorarOcioso && Date.now() - ultimaInteracao < OCIOSO_MS) return 'você está a usar o sistema agora';
  return null;
}
