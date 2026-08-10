import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Forward wheel — Chrome trata qualquer elemento com overflow-x != visible
// como consumidor de wheel vertical, mesmo se overflow-y for `clip`/`visible`.
// Isso trava scroll quando o cursor esta sobre uma tabela em wrapper
// `overflow-x-auto` (padrao em ~40 telas do LogMax). Aqui detectamos wheel
// preso por wrapper horizontal e rolamos o proximo ancestral que consegue.
window.addEventListener('wheel', (e) => {
  if (e.defaultPrevented || e.deltaY === 0 || e.ctrlKey) return;
  let el: HTMLElement | null = e.target as HTMLElement;
  let trappedByX = false;
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const canScrollY = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
    if (canScrollY) {
      // Existe scroll container legitimo antes do trap — deixa o browser rolar.
      // Se estivermos abaixo de um trap, precisamos rolar manualmente esse ancestral.
      if (trappedByX) el.scrollTop += e.deltaY;
      return;
    }
    // Elemento com overflow-x que nao rola Y "prende" o wheel no Chrome.
    if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) trappedByX = true;
    el = el.parentElement;
  }
}, { passive: true, capture: true });

// Apaga o cache 'supabase-api' deixado pelo service worker antigo.
//
// A entrada de runtimeCaching saiu do vite.config em 2026-08-10 (servia
// resposta de API velha quando a rede falhava, e a turma via o menu de antes
// do Modo Aula). Tirar a regra impede novas gravações, mas `cleanupOutdated-
// Caches` do workbox só varre o precache: o cache já gravado sobreviveria à
// atualização e continuaria sendo consultado pelo SW antigo até ele morrer.
//
// Some sozinho depois que todos os dispositivos rodarem esta versão; até lá
// custa uma chamada assíncrona no boot.
if ('caches' in window) {
  caches.delete('supabase-api').catch(() => { /* sem SW, ou modo privado */ });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Sentry carregado via dynamic import em produção — sai do main bundle
// (-50-100KB) em troca de ~50-100ms de janela pré-paint sem captura.
// Web Vitals e erros de runtime continuam capturados normalmente.
if (import.meta.env.PROD) {
  import('./lib/sentry').then(({ initSentry }) => initSentry());
}
