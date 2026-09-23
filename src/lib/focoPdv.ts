// Foco de teclado do PDV — régua única para as três lojas.
//
// Num caixa o Tab é da OPERAÇÃO, não da janela: o operador tabula para andar
// entre os campos do cupom, e em hipótese nenhuma o foco pode ser entregue à
// barra do navegador, à sidebar do app ou a qualquer coisa atrás do PDV (que
// roda em `fixed inset-0` — o que está atrás continua no DOM e continua
// tabulável, invisível sob o overlay).
//
// Vive aqui, e não em cada view, porque SuperMax (PDVViewSupermax) e os nichos
// MaxLook/TechMax (PDVView) têm de se comportar igual — é a mesma régua do
// MaxPOS, onde os três modos são um único componente.

// Focáveis: input/button/select/textarea/link + qualquer [tabindex] >= 0,
// ignorando desabilitados e quem está fora da ordem do Tab.
export const FOCUSABLE_SELECTOR =
  'input:not([disabled]):not([tabindex="-1"]),button:not([disabled]):not([tabindex="-1"]),select:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),a[href]:not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])';

const focaveisDe = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => el.offsetParent !== null || el === document.activeElement);

/**
 * Prende Tab/Shift+Tab dentro de `container`: só intercepta nas PONTAS, então
 * no meio da lista o foco continua andando naturalmente e, no último, volta ao
 * primeiro em vez de vazar. Serve tanto para modal quanto para a raiz do PDV.
 *
 * Quando age, o evento para aqui. Sem isso, o Tab de um modal subia até o trap
 * da raiz do PDV — e se o último focável do modal era também o último do PDV
 * (o X do Manual, único focável dele), a raiz via "fim da lista" e mandava o
 * foco para o cabeçalho. O foco saía do modal e o Esc dele parava de fechar.
 */
export function trapTab(
  e: Pick<React.KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault' | 'stopPropagation'>,
  container: HTMLElement | null,
) {
  if (e.key !== 'Tab' || !container) return;
  const focusables = focaveisDe(container);
  if (focusables.length === 0) { e.preventDefault(); e.stopPropagation(); return; }
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const dentro = !!active && container.contains(active);
  if (e.shiftKey) {
    if (!dentro || active === first) { e.preventDefault(); e.stopPropagation(); last.focus(); }
  } else {
    if (!dentro || active === last) { e.preventDefault(); e.stopPropagation(); first.focus(); }
  }
}

/**
 * Rede de segurança para o Tab quando o foco JÁ ESTÁ FORA do PDV.
 *
 * O `trapTab` da raiz é um onKeyDown do React, e onKeyDown só dispara para
 * evento cujo target está dentro da subárvore. Quando o foco cai em
 * `document.body` — clique numa área não focável, modal que fechou levando
 * consigo o elemento focado, primeiro Tab antes do autofocus — o target é o
 * body, o handler da raiz nunca roda, e o Tab entrega a operação ao que estiver
 * atrás do overlay e depois ao navegador. Daí este handler morar num listener
 * de `window` em fase de captura, o único lugar que vê a tecla mesmo sem foco
 * dentro do PDV.
 *
 * Devolve `true` quando tratou a tecla.
 */
export function devolverTabAoPdv(
  e: KeyboardEvent,
  raiz: HTMLElement | null,
  reentrada?: HTMLElement | null,
): boolean {
  if (e.key !== 'Tab' || !raiz) return false;
  const target = e.target as Node | null;
  // Foco dentro do PDV: quem trata é o trap do escopo (modal ou raiz), que já
  // conhece o container certo. Aqui não se mexe.
  if (target && raiz.contains(target)) return false;
  e.preventDefault();
  e.stopPropagation();
  // Reentrada preferencial é o campo de leitura: é o único lugar do caixa onde
  // o Tab pode recomeçar sem inventar destino. Sem ele, o primeiro focável.
  const destino = (reentrada && reentrada.offsetParent !== null)
    ? reentrada
    : (e.shiftKey ? focaveisDe(raiz).pop() : focaveisDe(raiz)[0]);
  destino?.focus();
  return true;
}
