import React, { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Clock, Wifi, WifiOff } from 'lucide-react';

const CHECKPOINT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  entrada: { label: 'Entrada',              color: 'text-emerald-400', bg: 'bg-emerald-900/20' },
  retorno: { label: 'Retorno do Intervalo', color: 'text-yellow-400',  bg: 'bg-yellow-900/20'  },
  saida:   { label: 'Saída',                color: 'text-blue-400',    bg: 'bg-blue-900/20'    },
};

export const QRTotemView = () => {
  const [tokenData, setTokenData] = useState<any>(null);
  const [clock, setClock] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [countdown, setCountdown] = useState(120);

  const fetchToken = useCallback(async () => {
    setRefreshing(true);
    setError(false);
    try {
      const res = await fetch('/api/qr-token');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTokenData(data);
      setCountdown(120);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Relógio
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Countdown e refresh automático a cada 2 minutos
  useEffect(() => {
    fetchToken();
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { fetchToken(); return 120; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchToken]);

  const cfg = tokenData?.checkpoint ? CHECKPOINT_CONFIG[tokenData.checkpoint] : null;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center h-full gap-8 py-8"
    >
      {/* Cabeçalho */}
      <div className="text-center">
        <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-1">LogMax — Ponto Eletrônico</p>
        <p className="text-5xl font-black text-gray-100 tabular-nums tracking-tight">
          {clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          {clock.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* QR ou mensagem de fora do horário */}
      <AnimatePresence mode="wait">
        {error ? (
          <motion.div key="error" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4">
            <WifiOff size={48} className="text-red-500/50" />
            <p className="text-red-400 text-sm font-bold">Erro de conexão com o servidor</p>
            <button onClick={fetchToken} className="neu-button px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-2">
              <RefreshCw size={12} /> Tentar novamente
            </button>
          </motion.div>
        ) : tokenData?.checkpoint && tokenData?.token ? (
          <motion.div key={tokenData.token} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-5">
            {cfg && (
              <div className={`px-4 py-1.5 rounded-full ${cfg.bg} border border-white/10`}>
                <span className={`text-sm font-black uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
              </div>
            )}
            <div className="p-5 neu-flat rounded-3xl border border-white/5">
              <QRCodeSVG
                value={tokenData.token}
                size={240}
                bgColor="transparent"
                fgColor="#e5e7eb"
                level="M"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Clock size={12} />
              <span>Atualiza em <span className="tabular-nums text-gray-400 font-bold">{countdown}s</span></span>
              <button onClick={fetchToken} disabled={refreshing} className="ml-1 hover:text-gray-300 transition-colors disabled:opacity-40">
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </motion.div>
        ) : tokenData && !tokenData.checkpoint ? (
          <motion.div key="no-checkpoint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 text-center">
            <div className="w-20 h-20 neu-pressed rounded-full flex items-center justify-center">
              <Clock size={32} className="text-gray-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-400">Nenhum checkpoint ativo</p>
              {tokenData.next && (
                <p className="text-sm text-gray-600 mt-1">
                  Próximo: <span className="text-yellow-400 font-bold">{tokenData.next.label}</span> às <span className="text-yellow-400 font-bold">{tokenData.next.at}</span>
                </p>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="loading" className="w-20 h-20 neu-pressed rounded-full flex items-center justify-center">
            <RefreshCw size={24} className="text-gray-600 animate-spin" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Horários dos checkpoints */}
      <div className="flex gap-4">
        {[
          { label: 'Entrada', time: '07:40', color: 'text-emerald-400' },
          { label: 'Retorno', time: '09:20', color: 'text-yellow-400' },
          { label: 'Saída',   time: '11:20', color: 'text-blue-400'   },
        ].map(cp => (
          <div key={cp.label} className="neu-flat rounded-2xl px-5 py-3 border border-white/5 text-center">
            <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold">{cp.label}</p>
            <p className={`text-lg font-black tabular-nums ${cp.color}`}>{cp.time}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-gray-700">
        <Wifi size={10} />
        <span>QR Code dinâmico — válido por 2 minutos</span>
      </div>
    </motion.div>
  );
};
