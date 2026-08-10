import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X, Sparkles } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Intervalo entre verificações de nova versão. O navegador só checa o SW por
// conta própria na navegação e a cada ~24h — numa PWA instalada, que a turma
// deixa aberta a manhã inteira, isso é tempo demais para um fix chegar.
const INTERVALO_CHECAGEM_MS = 30 * 60 * 1000;

/**
 * Registra o service worker do PWA e, se preciso, mostra o banner de nova
 * versão. Visível em todas as rotas (login e logado).
 *
 * Desde 2026-08-10 o `registerType` é 'autoUpdate': a nova versão assume
 * sozinha e o banner praticamente não aparece mais. O componente CONTINUA
 * obrigatório — é o `useRegisterSW` daqui que registra o service worker, e
 * sem ele não há PWA nenhuma. O banner fica como rede de segurança para o
 * caso de o registerType voltar a 'prompt'.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Checagem periódica + ao voltar para a aba. Sem isto, 'autoUpdate' só
      // atualiza na próxima navegação — e uma PWA instalada quase não navega.
      const checar = () => { registration.update().catch(() => { /* offline */ }); };
      setInterval(checar, INTERVALO_CHECAGEM_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checar();
      });
    },
    onRegisterError(err) {
      console.warn('[PWA] Erro ao registar service worker:', err);
    },
  });
  const [updating, setUpdating] = useState(false);

  const handleUpdate = () => {
    setUpdating(true);
    // updateServiceWorker(true) só recarrega se o evento `controllerchange`
    // disparar. Em alguns estados (SW waiting preso, primeira visita após
    // registro, dev) isso não acontece e o clique fica silencioso. Disparamos
    // o skip-waiting e, em paralelo, agendamos um reload de fallback.
    try { updateServiceWorker(true); } catch (e) { console.warn('[PWA] update falhou:', e); }
    setTimeout(() => window.location.reload(), 1500);
  };

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
              onClick={handleUpdate}
              disabled={updating}
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
                cursor: updating ? 'wait' : 'pointer',
                opacity: updating ? 0.7 : 1,
              }}
            >
              <RefreshCw size={12} className={updating ? 'animate-spin' : ''} />
              {updating ? 'Atualizando...' : 'Atualizar agora'}
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
