import * as Sentry from '@sentry/react';

/**
 * Inicializa o Sentry para error tracking + performance monitoring.
 *
 * Comportamento:
 * - DSN ausente (typical em dev): no-op, app funciona normalmente
 * - `import.meta.env.PROD === false` (dev): também no-op (não poluir o dashboard
 *   com erros de desenvolvimento). Para forçar em dev, comentar o `enabled` abaixo.
 * - Em produção com DSN: captura JS errors, unhandled rejections, network failures.
 *   10% dos pageloads/navegações são instrumentados para performance tracing.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    enabled: import.meta.env.PROD,
    environment: import.meta.env.MODE, // 'development' | 'production'

    // Integrações: BrowserTracing automático (capta Web Vitals, fetch, route changes)
    integrations: [
      Sentry.browserTracingIntegration(),
    ],

    // Performance: 10% de amostragem — fica muito abaixo da quota free (100k spans/mês
    // para 50 alunos a navegar ~10 routes/sessão = ~5k spans/mês)
    tracesSampleRate: 0.1,

    // Não enviar PII por defeito (cookies, headers de auth, etc.)
    sendDefaultPii: false,

    // Ignorar erros de extensão de browser e outros ruídos comuns
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // Erros injectados por extensões
      /^Extension context invalidated/,
      /^Non-Error promise rejection captured/,
    ],
  });
}

// Re-export para uso em ErrorBoundary e outros sítios
export { Sentry };
