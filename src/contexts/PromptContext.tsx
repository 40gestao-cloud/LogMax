import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

// Prompt in-app pra substituir window.prompt (que quebra a identidade
// visual). Segue a mesma cara do ConfirmContext, mas com <input> e
// resolve com o texto (ou null se cancelar).
//
// Também exporta uma ponte a nível de módulo (`appPrompt`) que o
// provider registra no mount — libs em src/lib/ que não são React
// component podem chamar sem passar callback por parâmetro.

interface PromptOptions {
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
}

interface PromptState extends PromptOptions {
  resolve: (v: string | null) => void;
}

type PromptFn = (opts: PromptOptions | string) => Promise<string | null>;

const PromptContext = createContext<PromptFn>(async () => null);

let _promptImpl: PromptFn | null = null;
export const appPrompt: PromptFn = async (opts) => {
  if (!_promptImpl) {
    // Fallback só se o provider não estiver montado (não deveria acontecer).
    const msg = typeof opts === 'string' ? opts : opts.message;
    const def = typeof opts === 'string' ? '' : opts.defaultValue ?? '';
    return window.prompt(msg, def);
  }
  return _promptImpl(opts);
};

export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PromptState | null>(null);
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt: PromptFn = (opts) =>
    new Promise(resolve => {
      const options = typeof opts === 'string' ? { message: opts } : opts;
      setValue(options.defaultValue ?? '');
      setState(prev => {
        prev?.resolve(null);
        return { ...options, resolve };
      });
    });

  // Registra a ponte no mount pra libs poderem chamar sem passar callback.
  useEffect(() => {
    _promptImpl = prompt;
    return () => { _promptImpl = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state) {
      requestAnimationFrame(() => {
        setVisible(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      setVisible(false);
    }
  }, [state]);

  const answer = (v: string | null) => {
    state?.resolve(v);
    setVisible(false);
    setTimeout(() => setState(null), 180);
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return; // não fecha se vazio; usuário cancela pra sair
    answer(trimmed);
  };

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ transition: 'opacity 180ms', opacity: visible ? 1 : 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => answer(null)} />

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
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line mb-4">
                {state.message}
              </p>

              <input
                ref={inputRef}
                type="text"
                value={value}
                maxLength={state.maxLength ?? 120}
                placeholder={state.placeholder}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); submit(); }
                  if (e.key === 'Escape') { e.preventDefault(); answer(null); }
                }}
                className="w-full px-3 py-2 rounded-lg text-sm text-gray-100 mb-5 outline-none"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              />

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => answer(null)}
                  className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ background: 'transparent' }}
                >
                  {state.cancelLabel ?? 'Cancelar'}
                </button>

                <button
                  onClick={submit}
                  disabled={!value.trim()}
                  className="btn-shimmer px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #ca9a00 0%, #D4AF37 60%, #e8c84a 100%)',
                    boxShadow: '0 2px 12px rgba(212,175,55,0.35)',
                    border: '1px solid rgba(212,175,55,0.4)',
                  }}
                >
                  {state.confirmLabel ?? 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PromptContext.Provider>
  );
}

export function usePrompt() {
  return useContext(PromptContext);
}
