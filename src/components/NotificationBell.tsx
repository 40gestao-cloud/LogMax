import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, X, Check, CheckCheck, AlertCircle, Inbox,
  Megaphone, ClipboardList, Monitor,
} from 'lucide-react';
import { useNotificacoes, type Notificacao } from '../hooks/useNotificacoes';

type Props = {
  setor: string | undefined | null;
  /** Restringe o sino a um setor específico (sino local de página). */
  filterSetor?: string;
  /** Callback opcional ao clicar numa notificação com link_view. */
  onNavigate?: (view: string) => void;
};

const TIPO_ICON: Record<Notificacao['tipo'], any> = {
  aprovacao_pendente: AlertCircle,
  aprovado:           Check,
  reprovado:          X,
  mensagem_setor:     Megaphone,
  tarefa_atribuida:   ClipboardList,
  tarefa_concluida:   CheckCheck,
  ti_chamado:         Monitor,
  ti_resolvido:       Check,
  info:               Bell,
};

const TIPO_COLOR: Record<Notificacao['tipo'], string> = {
  aprovacao_pendente: 'text-yellow-400',
  aprovado:           'text-accent',
  reprovado:          'text-red-500',
  mensagem_setor:     'text-blue-400',
  tarefa_atribuida:   'text-purple-400',
  tarefa_concluida:   'text-accent',
  ti_chamado:         'text-blue-400',
  ti_resolvido:       'text-accent',
  info:               'text-gray-400',
};

const TIPO_LABEL: Record<Notificacao['tipo'], string> = {
  aprovacao_pendente: 'Aprovação pendente',
  aprovado:           'Aprovado',
  reprovado:          'Reprovado',
  mensagem_setor:     'Mensagem',
  tarefa_atribuida:   'Tarefa atribuída',
  tarefa_concluida:   'Tarefa concluída',
  ti_chamado:         'Chamado de TI',
  ti_resolvido:       'TI resolvido',
  info:               'Aviso',
};

const formatRelative = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)    return 'agora';
  if (diff < 3600)  return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
};

export const NotificationBell = ({ setor, filterSetor, onNavigate }: Props) => {
  const { data, unreadCount, markRead, markAllRead } = useNotificacoes(setor);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Sino local de página: filtra só o setor relevante (ignora 'all').
  const visible = filterSetor
    ? data.filter(n => n.setor === filterSetor)
    : data;
  const badgeCount = filterSetor
    ? visible.filter(n => !n.lido).length
    : unreadCount;

  const handleClick = (n: Notificacao) => {
    if (!n.lido) markRead(n.id);
    if (n.link_view && onNavigate) {
      onNavigate(n.link_view);
      setOpen(false);
    }
  };

  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Notificações"
        aria-expanded={open}
        title={filterSetor ? `Notificações de ${filterSetor}` : 'Notificações'}
        className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent transition-colors relative"
      >
        <Bell size={16} />
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center border-2 border-[var(--color-bg-base)]">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-[min(92vw,360px)] neu-flat rounded-2xl border border-white/10 z-50 shadow-2xl overflow-hidden"
            style={{ background: 'var(--color-bg-base)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div>
                <p className="text-sm font-bold text-gray-200">Notificações</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                  {filterSetor ? `Setor: ${filterSetor}` : 'Todas as áreas que você acompanha'}
                </p>
              </div>
              {badgeCount > 0 && (
                <button
                  onClick={() => markAllRead()}
                  className="text-[10px] font-bold text-accent hover:text-accent/80 uppercase tracking-widest"
                >
                  Marcar todas
                </button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
              {visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-2">
                  <Inbox size={28} className="text-gray-600" />
                  <p className="text-sm text-gray-400 font-semibold">Sem notificações por aqui</p>
                  <p className="text-[11px] text-gray-600">Avisos de aprovação, tarefas e mensagens entre setores aparecem aqui.</p>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {visible.map(n => {
                    const Icon = TIPO_ICON[n.tipo] ?? Bell;
                    const color = TIPO_COLOR[n.tipo] ?? 'text-gray-400';
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => handleClick(n)}
                          className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/[0.03] transition-colors flex gap-3 ${
                            !n.lido ? 'bg-accent/[0.04]' : ''
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-xl neu-pressed flex items-center justify-center shrink-0 ${color}`}>
                            <Icon size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[9px] font-bold uppercase tracking-widest ${color}`}>
                                {TIPO_LABEL[n.tipo]}
                              </span>
                              {!n.lido && <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" />}
                              <span className="text-[10px] text-gray-600 ml-auto">{formatRelative(n.created_at)}</span>
                            </div>
                            <p className="text-sm font-semibold text-gray-200 truncate">{n.titulo}</p>
                            {n.mensagem && (
                              <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{n.mensagem}</p>
                            )}
                            {n.tipo === 'reprovado' && n.motivo && (
                              <p className="text-[11px] text-red-400 mt-1"><span className="font-bold">Motivo:</span> {n.motivo}</p>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
