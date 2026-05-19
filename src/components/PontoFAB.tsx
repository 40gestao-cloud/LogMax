import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, X, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner } from './ui';
import { QRScanner } from './QRScanner';

type ScanResult =
  | { ok: true; label: string; hora: string; status: string }
  | { ok: false; msg: string }
  | null;

export const PontoFAB = () => {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult>(null);

  const close = useCallback(() => {
    setOpen(false);
    setScanning(false);
    setResult(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const handleResult = useCallback(async (token: string) => {
    if (scanning) return;
    setScanning(true);
    setResult(null);
    try {
      const res = await fetch('/api/register-ponto-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) setResult({ ok: false, msg: json.error ?? 'Erro ao registrar ponto.' });
      else setResult({ ok: true, label: json.label, hora: json.hora, status: json.status });
    } catch {
      setResult({ ok: false, msg: 'Erro de conexão.' });
    } finally {
      setScanning(false);
    }
  }, [scanning, session]);

  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        whileTap={{ scale: 0.92 }}
        aria-label="Registrar ponto"
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full neu-flat border border-accent/30 flex items-center justify-center text-accent hover:text-white hover:border-accent/60 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        style={{ background: 'var(--color-card-bg)' }}
      >
        <Camera size={22} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={close}
          >
            <motion.div
              key="dialog"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="neu-flat rounded-3xl p-6 border border-white/5 w-full max-w-md"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-200">Registrar Ponto</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">Aponte para o QR Code exibido pelo administrador.</p>
                </div>
                <button onClick={close} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <AnimatePresence mode="wait">
                {scanning ? (
                  <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-center py-10">
                    <LoadingSpinner />
                  </motion.div>
                ) : result ? (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className={`flex flex-col items-center gap-3 rounded-2xl p-6 border ${result.ok ? 'bg-emerald-900/20 border-emerald-500/20' : 'bg-red-900/20 border-red-500/20'}`}
                  >
                    {result.ok ? (
                      <>
                        <CheckCircle size={36} className="text-emerald-400" />
                        <p className="text-sm font-bold text-emerald-300 text-center">Ponto registrado!</p>
                        <p className="text-xs text-emerald-500 text-center">
                          {result.label} às {result.hora}
                          {result.status && (
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${result.status === 'Atrasado' ? 'bg-red-950/60 text-red-500' : 'bg-emerald-900/40 text-emerald-400'}`}>
                              {result.status}
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={36} className="text-red-500" />
                        <p className="text-sm font-bold text-red-300 text-center">Falha no registro</p>
                        <p className="text-xs text-red-500 text-center">{result.msg}</p>
                      </>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setResult(null)}
                        className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-white transition-colors"
                      >
                        Tentar de novo
                      </button>
                      <button
                        onClick={close}
                        className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-500 hover:text-white transition-colors"
                      >
                        Fechar
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="scanner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <QRScanner onResult={handleResult} onClose={close} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
