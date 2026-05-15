import React from 'react';
import { Search, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Package } from 'lucide-react';

export const StatusBadge = ({ status }: { status: string }) => {
  let colorClass = 'text-gray-400';
  let style: React.CSSProperties = { background: 'var(--color-badge-neutral-bg)' };

  if (['Aprovado','Vinculada','Entregue','Autorizado','Despachado','Recebido','Pago'].includes(status)) {
    colorClass = 'bg-accent/20 text-accent font-bold shadow-[0_0_8px_var(--color-accent)]';
    style = {};
  } else if (['Em Cotação','Em Faturamento','Emitida','Em Andamento','Aberto','Pendente'].includes(status)) {
    colorClass = 'bg-accent/10 text-accent';
    style = {};
  } else if (['Cancelado','Negado','Negada','Divergente','Atrasado'].includes(status)) {
    colorClass = 'bg-red-500/15 text-red-500';
    style = {};
  }

  return (
    <span
      className={`px-2.5 py-1 rounded-md text-[10px] uppercase tracking-widest ${colorClass}`}
      style={style}
    >
      {status}
    </span>
  );
};

export const NeuButtonAccent = ({ children, onClick, isLoading, type = 'button', disabled = false, variant }: any) => (
  <button
    type={type}
    onClick={onClick}
    disabled={isLoading || disabled}
    className={`${variant === 'yellow' ? 'bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-[#0A0A0A]' : 'neu-button-accent'} btn-shimmer py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${(isLoading || disabled) ? 'opacity-60 scale-95 cursor-not-allowed' : ''}`}
  >
    {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
    {children}
  </button>
);

export const Toast = ({ message, visible, type = 'info' }: any) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-50 neu-flat rounded-2xl px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 border border-white/5 max-w-[calc(100vw-2rem)]"
      >
        {type === 'error'
          ? <AlertCircle size={18} className="text-red-500" />
          : type === 'success'
          ? <CheckCircle size={18} className="text-accent" />
          : <div className="w-3 h-3 rounded-full bg-accent animate-pulse shadow-[0_0_8px_var(--color-accent)]" />
        }
        <span className="text-sm font-semibold text-gray-200 tracking-wide">{message}</span>
      </motion.div>
    )}
  </AnimatePresence>
);

export const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center p-12 w-full text-center">
    <Loader2 size={32} className="text-accent animate-spin mb-4" />
    <span className="text-xs text-gray-400 font-bold tracking-widest uppercase">Carregando dados...</span>
  </div>
);

export const EmptyState = ({ message = 'Nenhum registro encontrado' }: { message?: string }) => (
  <div
    className="flex flex-col items-center justify-center p-12 w-full text-center rounded-2xl border-dashed border-2"
    style={{
      borderColor: 'var(--color-border-md)',
      background: 'var(--color-surface)',
    }}
  >
    <Search size={32} className="text-gray-600 mb-4" />
    <span className="text-sm font-semibold text-gray-400">{message}</span>
  </div>
);

export const FormField = ({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</label>
    {children}
    {error && (
      <span className="flex items-center gap-1 text-[10px] text-red-500 font-semibold">
        <AlertCircle size={10} /> {error}
      </span>
    )}
  </div>
);

export const ExportButton = ({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon: any }) => (
  <button
    onClick={onClick}
    className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-1.5"
  >
    <Icon size={13} />
    {label}
  </button>
);

export const UrgenciaBadge = ({ urgencia }: { urgencia: string }) => {
  const cls: Record<string, string> = {
    'Normal':  'text-gray-400',
    'Alta':    'bg-yellow-500/15 text-yellow-500',
    'Urgente': 'bg-red-500/15 text-red-500',
  };
  const style: React.CSSProperties =
    urgencia === 'Normal' ? { background: 'var(--color-badge-neutral-bg)' } : {};

  return (
    <span
      className={`px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold ${cls[urgencia] ?? cls['Normal']}`}
      style={style}
    >
      {urgencia}
    </span>
  );
};

export const PlaceholderView = ({ title, desc }: { title: string; desc?: string }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
    <div>
      <h2 className="text-3xl font-bold text-gray-100 tracking-tight">{title}</h2>
      {desc && <p className="text-sm text-gray-400 mt-1">{desc}</p>}
    </div>
    <div className="flex h-full items-center justify-center flex-col gap-4 text-center">
      <div className="neu-pressed w-20 h-20 rounded-full flex items-center justify-center shadow-inner">
        <Package size={28} className="text-gray-600" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-gray-300">Módulo em Desenvolvimento</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-sm">
          Esta visualização estará disponível em breve. Continue navegando pela plataforma.
        </p>
      </div>
    </div>
  </motion.div>
);
