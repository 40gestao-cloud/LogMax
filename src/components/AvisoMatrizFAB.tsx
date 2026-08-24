// FAB de Avisos da Matriz — visível em qualquer tela enquanto o gerente
// (ou colaborador) tiver aviso não confirmado. Clica → modal com o aviso →
// "Ciente" → sai da fila. Zerada a fila, o FAB some sozinho.
//
// Fica acima do PontoFAB (bottom-6) pra não colidir na tela de Início.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Megaphone, X, Check, Clock, Loader2, Building2 } from 'lucide-react';
import { formatDataHoraBR } from '../lib/dates';
import { useAvisosMatriz } from '../hooks/useAvisosMatriz';
import type { UserProfile } from '../hooks/useUserProfile';

export function AvisoMatrizFAB({ profile, showToast, hideTrigger, openSignal, onCount }: {
  profile: UserProfile; showToast?: any;
  /** FAB único de pendências (item 23): esconde o próprio botão e só reage
   *  ao `openSignal` para abrir o modal. `onCount` devolve o tamanho da fila
   *  para quem mostra a contagem — o dono da fila continua sendo este
   *  componente, para o hook não ser montado duas vezes. */
  hideTrigger?: boolean; openSignal?: number; onCount?: (n: number) => void;
}) {
  const { pendentes, darCiencia } = useAvisosMatriz(profile);
  const [open, setOpen] = useState(false);
  const [indice, setIndice] = useState(0);
  const [salvando, setSalvando] = useState(false);

  // A fila encolhe a cada "Ciente" — reancora o índice pra não estourar.
  useEffect(() => {
    if (indice > pendentes.length - 1) setIndice(Math.max(0, pendentes.length - 1));
    if (pendentes.length === 0) setOpen(false);
  }, [pendentes.length, indice]);

  useEffect(() => {
    if (!openSignal) return;
    setIndice(0);
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Antes do early return: fila vazia também é notícia para quem conta.
  useEffect(() => { onCount?.(pendentes.length); }, [pendentes.length, onCount]);
  useEffect(() => () => { onCount?.(0); }, [onCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (pendentes.length === 0) return null;

  const aviso = pendentes[indice];

  const confirmar = async () => {
    if (!aviso) return;
    setSalvando(true);
    const { error } = await darCiencia(aviso.id);
    setSalvando(false);
    if (error) return showToast?.(error, 'error');
    showToast?.('Aviso confirmado.', 'success');
  };

  return (
    <>
      {!hideTrigger && (
      <motion.button
        onClick={() => { setIndice(0); setOpen(true); }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Ver avisos da Matriz"
        className="fixed bottom-24 right-6 z-40 h-12 pl-4 pr-5 rounded-full neu-flat border border-amber-400/40 flex items-center gap-2 text-amber-200 hover:border-amber-400 hover:text-amber-100 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        style={{ background: 'var(--color-card-bg)' }}
      >
        <span className="relative flex items-center justify-center">
          <span className="absolute inline-flex w-5 h-5 rounded-full bg-amber-400/30 animate-ping" />
          <Megaphone size={18} className="relative" />
        </span>
        <span className="text-xs font-black uppercase tracking-widest">Novo Aviso</span>
        {pendentes.length > 1 && (
          <span className="text-[10px] font-black tabular-nums w-5 h-5 rounded-full bg-amber-400/20 border border-amber-400/40 flex items-center justify-center">
            {pendentes.length}
          </span>
        )}
      </motion.button>
      )}

      <AnimatePresence>
        {open && aviso && (
          <motion.div
            key="aviso-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="aviso-dialog"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              className="neu-flat rounded-3xl border border-amber-400/30 p-5 sm:p-6 w-full max-w-lg max-h-[85vh] flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/30 flex items-center justify-center shrink-0">
                    <Megaphone size={18} className="text-amber-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Aviso da Matriz</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {aviso.nome_criador ?? 'Matriz'}
                      {pendentes.length > 1 && ` · ${indice + 1} de ${pendentes.length}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Fechar"
                  className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
                <h3 className="text-lg font-black text-gray-100 leading-tight">{aviso.titulo}</h3>
                <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{aviso.descricao}</p>

                <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/5 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <Clock size={11} /> Válido até {formatDataHoraBR(aviso.expira_em)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Building2 size={11} />
                    {aviso.filiais.length === 0 ? 'Todas as filiais' : aviso.filiais.join(', ')}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                {pendentes.length > 1 ? (
                  <button
                    onClick={() => setIndice(i => (i + 1) % pendentes.length)}
                    className="text-[11px] font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200"
                  >
                    Ver outro aviso
                  </button>
                ) : <span />}
                <button
                  onClick={confirmar}
                  disabled={salvando}
                  className="text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl neu-button text-emerald-300 ring-1 ring-emerald-500/40 hover:ring-emerald-400 flex items-center gap-2 disabled:opacity-50"
                >
                  {salvando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Ciente
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
