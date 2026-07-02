import React, { createContext, useContext, useState } from 'react';

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

// Heurística: verbos destrutivos ligam o botão vermelho por default.
// Override explícito via { danger: false } continua funcionando.
const VERBO_DESTRUTIVO = /\b(excluir|inativar|cancelar|apagar|remover|descartar|estornar)\b/i;

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = (opts: ConfirmOptions | string): Promise<boolean> =>
    new Promise(resolve => {
      const options = typeof opts === 'string' ? { message: opts } : opts;
      const danger = options.danger ?? VERBO_DESTRUTIVO.test(options.message);
      setState({ ...options, danger, resolve });
    });

  const answer = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => answer(false)} />
          <div className="relative neu-card rounded-xl p-6 w-full max-w-sm shadow-2xl border border-white/10">
            <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{state.message}</p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => answer(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
              >
                {state.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                onClick={() => answer(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  state.danger
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-accent hover:bg-accent/80 text-white'
                }`}
              >
                {state.confirmLabel ?? 'Confirmar'}
              </button>
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
