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
// `emOperacao`, `digitandoAgora` e `temCampoPreenchido` são heurísticas de
// alcance geral: apanham qualquer tela, inclusive a que nascer amanhã, sem
// ninguém precisar lembrar de nada. O que elas NÃO veem é o que a tela guarda
// só em memória, sem campo na tela para mostrar — o carrinho do PDV, as linhas
// já adicionadas a um orçamento, o lote de requisições. Essas telas declaram o
// que seguram com `useTravaAtualizacao`, e aí não é palpite.

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

// ── Campo preenchido que ainda está na tela ─────────────────────────────────
//
// A rede que apanha as outras trinta e cinco telas sem tocar em nenhuma.
//
// O padrão desta casa é `showForm` + um objeto `form` — mas ler "formulário
// aberto" como trabalho não gravado erraria para os dois lados: um formulário
// recém-aberto e vazio não tem nada a perder, e trabalho não gravado também
// aparece fora de formulário (um campo editado direto numa linha da tabela).
//
// O que interessa é mais simples e não depende de convenção nenhuma: existe
// na tela algum campo em que a PESSOA escreveu e que ainda tem conteúdo?
// Guardamos os elementos que receberam input de verdade — não os que já vieram
// preenchidos por defeito — e a limpeza é automática: quando o formulário
// fecha (gravado ou desistido), o nó sai do documento e deixa de contar.
//
// Busca e filtro ficam de fora: são a caixa que a pessoa preenche e esquece,
// e travariam a atualização o dia inteiro sem nada em risco. A convenção
// "Buscar…" no placeholder já os identifica; onde não der, marque o campo (ou
// um ancestral) com `data-trava-atualizacao="nao"`.

const sujos = new Set<Element>();

function ehCampo(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function ehBuscaOuFiltro(el: HTMLElement): boolean {
  if (el.closest('[data-trava-atualizacao="nao"]')) return true;
  const inp = el as HTMLInputElement;
  if (inp.type === 'search') return true;
  const texto = [inp.name, inp.placeholder, el.getAttribute('aria-label'), el.id]
    .filter(Boolean).join(' ').toLowerCase();
  return /busc|pesquis|procur|filtr|search/.test(texto);
}

function aindaTemConteudo(el: HTMLElement): boolean {
  if (el.isContentEditable) return (el.innerText ?? '').trim() !== '';
  const inp = el as HTMLInputElement;
  if (inp.type === 'checkbox' || inp.type === 'radio') return inp.checked;
  return String(inp.value ?? '').trim() !== '';
}

if (typeof window !== 'undefined') {
  const marcarSujo = (e: Event) => {
    const el = e.target;
    if (!ehCampo(el)) return;
    if (ehBuscaOuFiltro(el)) return;
    // Poda oportunista: sem isto o Set cresceria a sessão inteira com nós que
    // já saíram do documento.
    if (sujos.size > 200) for (const antigo of sujos) if (!antigo.isConnected) sujos.delete(antigo);
    sujos.add(el);
  };
  // `change` além de `input` por causa do <select>, que em alguns navegadores
  // não emite `input` ao escolher com o teclado.
  window.addEventListener('input', marcarSujo, { capture: true, passive: true });
  window.addEventListener('change', marcarSujo, { capture: true, passive: true });
}

/** Há campo escrito pela pessoa, ainda no documento e ainda com conteúdo? */
export function temCampoPreenchido(): boolean {
  for (const el of [...sujos]) {
    if (!el.isConnected) { sujos.delete(el); continue; }
    if (aindaTemConteudo(el as HTMLElement)) return true;
    // Esvaziou (ou foi limpo pelo reset do formulário): não há o que perder.
    sujos.delete(el);
  }
  return false;
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
  if (temCampoPreenchido()) return 'há um formulário preenchido nesta tela';
  if (!opts?.ignorarOcioso && Date.now() - ultimaInteracao < OCIOSO_MS) return 'você está a usar o sistema agora';
  return null;
}
