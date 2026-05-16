import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X, Sparkles } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Banner de atualização do PWA — visível em todas as rotas (login e logado).
 * Quando o service worker detecta nova versão deployada, exibe barra fixa no
 * topo com botão para recarregar. Usuário pode adiar fechando no X.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW() {
      // hook para futuros logs/Sentry; intencionalmente vazio.
    },
    onRegisterError(err) {
      console.warn('[PWA] Erro ao registar service worker:', err);
    },
  });

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          initial={{ y: -64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -64, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
            color: 'var(--color-accent-text)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: '0 auto',
              padding: '0.6rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <Sparkles size={16} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, flex: 1, letterSpacing: '0.02em' }}>
              Nova versão do LogMax disponível.
            </span>
            <button
              type="button"
              onClick={() => updateServiceWorker(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'rgba(0,0,0,0.18)',
                color: 'inherit',
                border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: '0.6rem',
                padding: '0.4rem 0.8rem',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.05em',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} />
              Atualizar agora
            </button>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              aria-label="Adiar atualização"
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                opacity: 0.7,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
