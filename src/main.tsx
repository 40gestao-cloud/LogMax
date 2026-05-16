import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

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
