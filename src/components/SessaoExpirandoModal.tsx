import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  /** Epoch (ms) em que a sessão cai. */
  expiraEm: number;
  onContinuar: () => void;
  onSairAgora: () => void;
}

/**
 * Aviso de 60s antes do logout por inatividade.
 *
 * A contagem regressiva vive AQUI, e não no `useIdleLogout`: se o segundo
 * restante fosse estado do App, a árvore inteira (sidebar, view ativa, FABs)
 * re-renderizaria 60 vezes seguidas.
 *
 * Não fecha por clique no backdrop nem por Esc de propósito — quem está saindo
 * precisa escolher explicitamente entre ficar e sair.
 */
export function SessaoExpirandoModal({ expiraEm, onContinuar, onSairAgora }: Props) {
  const restante = () => Math.max(0, Math.ceil((expiraEm - Date.now()) / 1000));
  const [segundos, setSegundos] = useState(restante);
  const [visivel, setVisivel] = useState(false);
  const continuarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = setInterval(() => setSegundos(restante()), 250);
    requestAnimationFrame(() => setVisivel(true));
    continuarRef.current?.focus();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiraEm]);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sessao-expirando-titulo"
      style={{ transition: 'opacity 180ms', opacity: visivel ? 1 : 0 }}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-sm"
        style={{
          transition: 'transform 180ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms',
          transform: visivel ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(10px)',
          opacity: visivel ? 1 : 0,
        }}
      >
        <div
          style={{
            background: 'rgba(10,10,10,0.88)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '1rem',
            padding: '1.5rem',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset',
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.30)' }}
            >
              <Clock size={18} style={{ color: '#D4AF37' }} />
            </div>
            <div>
              <h2 id="sessao-expirando-titulo" className="text-sm font-bold text-gray-100">
                Sua sessão vai expirar
              </h2>
              <p className="text-xs text-gray-500">Por inatividade</p>
            </div>
          </div>

          <p className="text-sm text-gray-300 leading-relaxed mb-1">
            Você será desconectado em{' '}
            <span
              className="font-bold tabular-nums"
              style={{ color: segundos <= 10 ? '#f87171' : '#D4AF37' }}
              aria-live="polite"
            >
              {segundos}s
            </span>.
          </p>
          <p className="text-xs text-gray-500 leading-relaxed mb-5">
            Se este computador é compartilhado, saia para que o próximo aluno
            não use a sua conta.
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={onSairAgora}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 transition-colors"
              style={{ background: 'transparent' }}
            >
              Sair agora
            </button>
            <button
              ref={continuarRef}
              onClick={onContinuar}
              className="btn-shimmer px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{
                background: 'linear-gradient(135deg, #ca9a00 0%, #D4AF37 60%, #e8c84a 100%)',
                border: '1px solid rgba(212,175,55,0.4)',
              }}
            >
              Continuar conectado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
