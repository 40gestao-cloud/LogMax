import React from 'react';
import { Search, Loader2, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
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
  } else if (['Cancelado','Negado','Divergente','Atrasado'].includes(status)) {
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

export const PageLoadingFallback = () => (
  <div className="flex flex-col items-center justify-center w-full h-full min-h-[300px] gap-4">
    <Loader2 size={36} className="animate-spin" style={{ color: '#FACC15' }} />
    <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#FACC15', opacity: 0.65 }}>
      Carregando módulo...
    </span>
  </div>
);

export const Pagination = ({
  page,
  totalCount,
  pageSize = 50,
  isLoading,
  onPrev,
  onNext,
  onReload,
}: {
  page: number;
  totalCount: number | null;
  pageSize?: number;
  isLoading?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onReload?: () => void;
}) => {
  const hasNext = totalCount !== null && (page + 1) * pageSize < totalCount;
  const hasPrev = page > 0;
  // Em mobile, mostra sempre o botão de refresh mesmo quando há só uma página.
  if (!hasPrev && !hasNext && !onReload) return null;
  const from = totalCount ? page * pageSize + 1 : 0;
  const to   = totalCount ? Math.min((page + 1) * pageSize, totalCount) : 0;
  return (
    <div className="flex items-center justify-between gap-2 pt-4 border-t border-white/5 mt-2 flex-wrap">
      <span className="text-xs text-gray-500">
        {totalCount !== null ? `${from}–${to} de ${totalCount} registros` : `Página ${page + 1}`}
      </span>
      <div className="flex gap-2 items-center">
        {onReload && (
          <button
            onClick={onReload}
            disabled={isLoading}
            title="Atualizar"
            className="neu-button w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        )}
        <button
          onClick={onPrev}
          disabled={!hasPrev || isLoading}
          className="neu-button px-3 sm:px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← <span className="hidden sm:inline">Anterior</span>
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext || isLoading}
          className="neu-button px-3 sm:px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span className="hidden sm:inline">Próximo</span> →
        </button>
      </div>
    </div>
  );
};

// Mostra "nada encontrado" OU, se `error` for passado, um banner vermelho
// com a mensagem do PostgREST/Supabase. Sem `error`, comporta-se igual ao
// antigo (back-compat). Views que destructuram `error` do useFetchData
// devem repassar aqui — caso contrário, problemas de RLS/coluna/4xx ficam
// indistinguíveis de "tabela realmente vazia" (foi o que mascarou o bug
// das artes promocionais por dois passos).
export const EmptyState = ({ message = 'Nenhum registro encontrado', error }: { message?: string; error?: string | null }) => {
  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center p-10 w-full text-center rounded-2xl border-dashed border-2"
        style={{
          borderColor: 'rgba(239, 68, 68, 0.45)',         // red-500 @ 45%
          background:  'rgba(239, 68, 68, 0.06)',          // red-500 @ 6%
        }}
      >
        <AlertCircle size={32} className="text-red-500 mb-3" />
        <span className="text-sm font-bold text-red-400 mb-1">Erro ao carregar dados</span>
        <span className="text-xs text-gray-400 max-w-md break-words">{error}</span>
      </div>
    );
  }
  return (
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
};

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

// Badge da unidade de negócio (Holding). Aceita string livre — se for um valor
// conhecido (SuperMax/MaxLook/TechMax/Matriz), aplica a cor estável; caso
// contrário cai num cinza neutro.
export const FilialBadge = ({ filial }: { filial?: string | null }) => {
  // Classes CSS dedicadas (.filial-badge--*) com variantes claro/escuro em
  // index.css. No light mode os tons ficam mais escuros para garantir contraste.
  const f = (filial ?? '').toString().trim();
  if (!f) return <span className="text-gray-700 text-xs">—</span>;
  const variantMap: Record<string, string> = {
    SuperMax: 'supermax',
    MaxLook:  'maxlook',
    TechMax:  'techmax',
    Matriz:   'matriz',
  };
  const variant = variantMap[f] ?? 'unknown';
  return <span className={`filial-badge filial-badge--${variant}`}>{f}</span>;
};

// Miniatura/imagem de produto com fallback amigável quando não há imagem.
// Aceita tamanhos pré-definidos (`xs` 40px → tabela, `sm` 56px → mobile,
// `md` 72px → cards PDV, `lg` 96px → preview no formulário). Mantém aspecto
// quadrado e canto arredondado consistentes com o resto da UI neumorfa.
export const ProdutoThumb = ({
  url,
  alt,
  size = 'sm',
  rounded = 'rounded-xl',
}: {
  url?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  rounded?: string;
}) => {
  const dim: Record<string, string> = {
    xs: 'w-10 h-10',
    sm: 'w-14 h-14',
    md: 'w-20 h-20',
    lg: 'w-24 h-24',
  };
  const iconSize: Record<string, number> = { xs: 16, sm: 20, md: 26, lg: 32 };
  const base = `${dim[size]} ${rounded} shrink-0 overflow-hidden flex items-center justify-center neu-pressed border border-white/5`;
  if (url) {
    return (
      <div className={base}>
        <img
          src={url}
          alt={alt ?? 'Imagem do produto'}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={(e) => {
            // Se a URL quebrar, esconde a <img> e o fallback de fundo aparece.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }
  return (
    <div className={`${base} text-gray-600`}>
      <Package size={iconSize[size]} strokeWidth={1.5} />
    </div>
  );
};

export const PlaceholderView = ({ title, desc }: { title: string; desc?: string }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
    <div>
      <h2 className="text-3xl font-bold text-accent tracking-tight">{title}</h2>
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
