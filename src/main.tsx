import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initSentry } from './lib/sentry';

// Sentry tem de inicializar ANTES do React montar para apanhar erros de bootstrap.
initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
