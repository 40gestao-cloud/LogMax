import { useEffect, useRef } from 'react';

// Tela cheia de verdade nos PDVs — a do navegador, não só o overlay CSS.
//
// O modo "tela cheia" dos três PDVs sempre foi `fixed inset-0 z-[100]`: cobre a
// sidebar e a topbar do app, e para por aí. A barra de endereço do navegador e
// a barra de tarefas do sistema continuavam na tela, que é justamente o que um
// caixa não quer ver — tanto pela área perdida quanto porque dali o aluno sai
// do PDV sem querer.
//
// O overlay continua fazendo o trabalho de layout; este hook só pede ao
// navegador que o documento inteiro ocupe o monitor.
//
// LIMITE DO NAVEGADOR, e não dá pra contornar: `requestFullscreen` exige gesto
// do usuário. Os PDVs entram com `fullscreen = true` já na montagem, e essa
// chamada só é aceita se ainda valer a ativação transitória do clique que
// abriu a tela (alguns segundos, em geral suficiente). Quando não valer, a
// promessa é rejeitada, o overlay segue normal e o operador tem o botão de
// tela cheia ali no header. Por isso toda falha aqui é silenciosa: é um
// upgrade da experiência, nunca um erro que mereça toast.

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const emFullscreen = (): boolean => {
  const doc = document as FullscreenDoc;
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
};

// Keyboard Lock (Chrome/Edge): em tela cheia, o Esc deixa de ser do navegador
// e chega à página — só o Esc SEGURADO sai por fora. É o que permite ao PDV
// SuperMax usar a tela cheia de verdade sem perder o Esc da operação (cancelar
// venda, fechar modal), que foi o motivo de ela ter sido tirada de lá.
type TecladoTravavel = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const teclado = (): TecladoTravavel | undefined =>
  (navigator as Navigator & { keyboard?: TecladoTravavel }).keyboard;

const podeTravarEsc = () => typeof teclado()?.lock === 'function';

const entrar = (travarEsc: boolean) => {
  const el = document.documentElement as FullscreenEl;
  const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (!req) return;
  // Sem como travar o Esc (Firefox, Safari), quem pediu a trava fica no
  // overlay CSS: tela cheia nativa ali devolveria o bug do Esc roubado.
  if (travarEsc && !podeTravarEsc()) return;
  try {
    if (travarEsc) teclado()!.lock!(['Escape']).catch(() => {});
    const r = req.call(el) as Promise<void> | void;
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
  } catch { /* navegador recusou — overlay CSS continua valendo */ }
};

const sair = () => {
  const doc = document as FullscreenDoc;
  try { teclado()?.unlock?.(); } catch { /* sem trava para soltar */ }
  if (!emFullscreen()) return;
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  if (!exit) return;
  try {
    const r = exit.call(doc) as Promise<void> | void;
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
  } catch { /* idem */ }
};

/**
 * Casa o estado `ativo` do PDV com a tela cheia do navegador.
 *
 * `onSair` é chamado quando o usuário sai por fora (F11, Esc do navegador,
 * troca de aba em alguns casos) — sem isso o overlay ficaria cobrindo a tela
 * com a barra do navegador de volta por cima, que é o pior dos dois mundos.
 *
 * `travarEsc` deixa o Esc com a página enquanto durar a tela cheia (ver
 * Keyboard Lock acima); onde o navegador não oferece a trava, vale só o overlay.
 */
export function useFullscreenNativo(ativo: boolean, onSair: () => void, travarEsc = false) {
  const onSairRef = useRef(onSair);
  onSairRef.current = onSair;

  useEffect(() => {
    if (ativo) {
      if (!emFullscreen()) entrar(travarEsc);
    } else {
      sair();
    }
  }, [ativo, travarEsc]);

  useEffect(() => {
    const handler = () => {
      if (!emFullscreen()) onSairRef.current();
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  // Sair do PDV (trocar de tela, fechar o caixa) devolve a janela ao normal.
  // Sem isto, o resto do app ficaria em tela cheia sem ninguém ter pedido.
  useEffect(() => () => { sair(); }, []);
}
