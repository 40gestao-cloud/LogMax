import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

interface ConfirmOptions {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

const ConfirmContext = createContext<(opts: ConfirmOptions | string) => Promise<boolean>>(
  async () => false
);

const VERBO_DESTRUTIVO = /\b(excluir|inativar|cancelar|apagar|remover|descartar|estornar)\b/i;

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [visible, setVisible] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = (opts: ConfirmOptions | string): Promise<boolean> =>
    new Promise(resolve => {
      const options = typeof opts === 'string' ? { message: opts } : opts;
      const danger = options.danger ?? VERBO_DESTRUTIVO.test(options.message);
      setState(prev => {
        prev?.resolve(false);
        return { ...options, danger, resolve };
      });
    });

  useEffect(() => {
    if (state) {
      // micro-delay so the element mounts before the transition fires
      requestAnimationFrame(() => setVisible(true));
      confirmRef.current?.focus();
    } else {
      setVisible(false);
    }
  }, [state]);

  const answer = (v: boolean) => {
    state?.resolve(v);
    setVisible(false);
    setTimeout(() => setState(null), 180);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ transition: 'opacity 180ms', opacity: visible ? 1 : 0 }}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => answer(false)}
          />

          {/* card */}
          <div
            className="relative w-full max-w-sm"
            style={{
              transition: 'transform 180ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms',
              transform: visible ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(10px)',
              opacity: visible ? 1 : 0,
            }}
          >
            <div
              style={{
                background: 'rgba(10,10,10,0.82)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: '1rem',
                padding: '1.5rem',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset',
              }}
            >
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line mb-5">
                {state.message}
              </p>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => answer(false)}
                  className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ background: 'transparent' }}
                >
                  {state.cancelLabel ?? 'Cancelar'}
                </button>

                <button
                  ref={confirmRef}
                  onClick={() => answer(true)}
                  className="btn-shimmer px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
                  style={{
                    background: state.danger
                      ? 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)'
                      : 'linear-gradient(135deg, #ca9a00 0%, #D4AF37 60%, #e8c84a 100%)',
                    boxShadow: state.danger
                      ? '0 2px 12px rgba(220,38,38,0.35)'
                      : '0 2px 12px rgba(212,175,55,0.35)',
                    border: state.danger
                      ? '1px solid rgba(239,68,68,0.4)'
                      : '1px solid rgba(212,175,55,0.4)',
                  }}
                >
                  {state.confirmLabel ?? 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
