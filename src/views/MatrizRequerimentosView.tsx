import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, X, Clock, CheckCircle2, XCircle, Search,
  FileIcon, Image as ImageIcon, ChevronDown, ChevronUp, Send,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, StatusBadge, CardContador, FilialBadge } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';

// ── Tipos ──────────────────────────────────────────────────────────────────
type StatusReq = 'Pendente' | 'Em Análise' | 'Aprovado' | 'Negado';

type Requerimento = {
  id: string;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  arquivo_tipo: 'imagem' | 'pdf' | null;
  status: StatusReq;
  criado_por: string | null;
  criado_por_nome: string | null;
  filial: string | null;
  resposta: string | null;
  respondido_por_nome: string | null;
  respondido_em: string | null;
  created_at: string;
};

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

const STATUS_CFG: Record<StatusReq, { color: string; icon: any }> = {
  'Pendente':   { color: 'text-gray-400 bg-gray-500/15 border-gray-500/30',         icon: Clock },
  'Em Análise': { color: 'text-blue-300 bg-blue-500/15 border-blue-500/30',         icon: FileText },
  'Aprovado':   { color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle2 },
  'Negado':     { color: 'text-red-300 bg-red-500/15 border-red-500/30',             icon: XCircle },
};

const FILIAL_COLOR: Record<string, string> = {
  SuperMax: 'text-sky-400',
  MaxLook:  'text-amber-300',
  TechMax:  'text-orange-400',
};

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Rio_Branco',
  });


function ArquivoPreview({ url, tipo }: { url: string; tipo: 'imagem' | 'pdf' }) {
  if (tipo === 'imagem') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt="anexo" className="max-h-48 rounded-xl object-cover border border-white/10 hover:opacity-90 transition-opacity" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 px-3 py-2 rounded-xl neu-pressed text-xs text-accent hover:text-accent/80 transition-colors w-fit"
    >
      <FileIcon size={14} /> Abrir PDF
    </a>
  );
}

// ── Modal de resposta ──────────────────────────────────────────────────────
function ModalResponder({
  r, profile, onClose, onSaved, showToast,
}: {
  r: Requerimento;
  profile: UserProfile | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [status, setStatus] = useState<StatusReq>(r.status === 'Pendente' ? 'Em Análise' : r.status);
  const [resposta, setResposta] = useState(r.resposta ?? '');
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    if ((status === 'Aprovado' || status === 'Negado') && !resposta.trim()) {
      showToast('Adicione uma resposta/justificativa ao decidir.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('requerimentos').update({
        status,
        resposta: resposta.trim() || null,
        respondido_por_nome: profile?.nome ?? null,
        respondido_em: new Date().toISOString(),
      }).eq('id', r.id);
      if (error) throw error;
      showToast('Requerimento atualizado.', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-lg border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto main-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Responder Requerimento</h2>
            <span className={`text-xs font-bold ${FILIAL_COLOR[r.filial ?? ''] ?? 'text-gray-400'}`}>
              {r.filial ?? '—'} · {r.criado_por_nome ?? '—'}
            </span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        {/* Detalhes do requerimento */}
        <div className="neu-pressed rounded-2xl p-4 flex flex-col gap-2">
          <p className="text-sm font-bold text-gray-100">{r.titulo}</p>
          {r.descricao && <p className="text-xs text-gray-400 whitespace-pre-wrap">{r.descricao}</p>}
          {r.arquivo_url && r.arquivo_tipo && (
            <ArquivoPreview url={r.arquivo_url} tipo={r.arquivo_tipo} />
          )}
          <p className="text-[10px] text-gray-600">{fmtDateTime(r.created_at)}</p>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Status</label>
          <div className="flex gap-2 flex-wrap">
            {(['Pendente', 'Em Análise', 'Aprovado', 'Negado'] as StatusReq[]).map(s => {
              const cfg = STATUS_CFG[s];
              const Icon = cfg.icon;
              const active = status === s;
              return (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${active ? cfg.color : 'neu-pressed text-gray-500 border-white/5 hover:text-gray-300'}`}
                >
                  <Icon size={12} />{s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Resposta */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Resposta / Justificativa {(status === 'Aprovado' || status === 'Negado') && <span className="text-red-400">*</span>}
          </label>
          <textarea
            value={resposta} onChange={e => setResposta(e.target.value)}
            rows={3}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Escreva a resposta para o solicitante..."
          />
        </div>

        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
          <Send size={14} /> Salvar Resposta
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Card na Matriz ─────────────────────────────────────────────────────────
function MatrizReqCard({ r, profile, onResponder, onExcluir }: {
  r: Requerimento;
  profile: UserProfile | null;
  onResponder: (r: Requerimento) => void;
  onExcluir: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const podeExcluir = profile?.role === 'admin' || profile?.role === 'ceo';

  return (
    <div className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={r.status} />
            {r.filial && <FilialBadge filial={r.filial} />}
            {r.arquivo_tipo === 'imagem' && <ImageIcon size={11} className="text-gray-500" />}
            {r.arquivo_tipo === 'pdf'    && <FileIcon  size={11} className="text-gray-500" />}
          </div>
          <p className="text-sm font-semibold text-gray-100 mt-1 truncate">{r.titulo}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {r.criado_por_nome ?? '—'} · {fmtDateTime(r.created_at)}
          </p>
        </div>
        {aberto ? <ChevronUp size={14} className="text-gray-500 shrink-0" /> : <ChevronDown size={14} className="text-gray-500 shrink-0" />}
      </button>

      <AnimatePresence>
        {aberto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 flex flex-col gap-3 border-t border-white/5 pt-3">
              {r.descricao && <p className="text-sm text-gray-300 whitespace-pre-wrap">{r.descricao}</p>}
              {r.arquivo_url && r.arquivo_tipo && (
                <ArquivoPreview url={r.arquivo_url} tipo={r.arquivo_tipo} />
              )}
              {r.resposta && (
                <div className="neu-pressed rounded-xl p-3 border border-accent/10">
                  <span className="text-[10px] font-black uppercase tracking-widest text-accent">Resposta enviada</span>
                  <p className="text-sm text-gray-200 mt-1">{r.resposta}</p>
                  {r.respondido_por_nome && (
                    <p className="text-[10px] text-gray-500 mt-1">
                      {r.respondido_por_nome} · {r.respondido_em ? fmtDateTime(r.respondido_em) : ''}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => onResponder(r)}
                  className="btn-solido btn-solido--dourado"
                >
                  <Send size={12} /> {r.resposta ? 'Editar Resposta' : 'Responder'}
                </button>
                {podeExcluir && (
                  <button
                    onClick={() => onExcluir(r.id)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <XCircle size={12} /> Excluir
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── View Matriz ────────────────────────────────────────────────────────────
export function MatrizRequerimentosView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const [filialFiltro, setFilialFiltro] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<StatusReq | null>(null);
  const [search, setSearch] = useState('');
  const [respondendo, setRespondendo] = useState<Requerimento | null>(null);
  const confirm = useConfirm();

  const { data: requerimentos = [], isLoading, reload } = useFetchData<Requerimento>('requerimentos');

  const filtrados = useMemo(() => {
    let list = requerimentos;
    if (filialFiltro) list = list.filter(r => r.filial === filialFiltro);
    if (statusFiltro) list = list.filter(r => r.status === statusFiltro);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(r =>
        r.titulo.toLowerCase().includes(s) ||
        (r.criado_por_nome ?? '').toLowerCase().includes(s) ||
        (r.descricao ?? '').toLowerCase().includes(s),
      );
    }
    return list;
  }, [requerimentos, filialFiltro, statusFiltro, search]);

  // Contadores por status para os pills — respeitam filial + busca (mas não
  // o próprio filtro de status, pra que os números batam com a lista renderizada
  // ao trocar de aba).
  const contadores = useMemo(() => {
    let base = requerimentos;
    if (filialFiltro) base = base.filter(r => r.filial === filialFiltro);
    if (search.trim()) {
      const s = search.toLowerCase();
      base = base.filter(r =>
        r.titulo.toLowerCase().includes(s) ||
        (r.criado_por_nome ?? '').toLowerCase().includes(s) ||
        (r.descricao ?? '').toLowerCase().includes(s),
      );
    }
    return {
      Pendente:    base.filter(r => r.status === 'Pendente').length,
      'Em Análise': base.filter(r => r.status === 'Em Análise').length,
      Aprovado:    base.filter(r => r.status === 'Aprovado').length,
      Negado:      base.filter(r => r.status === 'Negado').length,
    } as Record<StatusReq, number>;
  }, [requerimentos, filialFiltro, search]);

  const handleExcluir = async (id: string) => {
    const ok = await confirm({ message: 'Excluir este requerimento? Esta ação não pode ser desfeita.', danger: true });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('requerimentos').delete().eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Requerimento excluído.', 'success');
    reload();
  };

  const abertos = filtrados.filter(r => r.status === 'Pendente' || r.status === 'Em Análise');
  const finalizados = filtrados.filter(r => r.status === 'Aprovado' || r.status === 'Negado');

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5 pb-16"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {([
          ['Pendente', 'Pendentes', 'amarelo'],
          ['Em Análise', 'Em análise', 'azul'],
          ['Aprovado', 'Aprovados', 'verde'],
          ['Negado', 'Negados', 'vermelho'],
        ] as const).map(([st, label, tom]) => (
          <CardContador key={st} label={label} value={contadores[st]} tom={tom}
            onClick={() => setStatusFiltro(f => f === st ? null : st)} ativo={statusFiltro === st} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, solicitante…"
            className="neu-input w-full py-2.5 pl-10 pr-4 rounded-xl text-sm"
          />
        </div>
        <select
          value={filialFiltro ?? ''}
          onChange={e => setFilialFiltro(e.target.value || null)}
          className="neu-input py-2.5 px-3 rounded-xl text-sm"
          aria-label="Filtrar por unidade"
        >
          <option value="">Todas as unidades</option>
          {FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? <LoadingSpinner /> : filtrados.length === 0 ? (
        <EmptyState message="Nenhum requerimento encontrado." />
      ) : (
        <div className="flex flex-col gap-5">
          {abertos.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Aguardando análise ({abertos.length})</span>
              {abertos.map(r => (
                <MatrizReqCard key={r.id} r={r} profile={profile}
                  onResponder={setRespondendo} onExcluir={handleExcluir}
                />
              ))}
            </div>
          )}
          {finalizados.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Finalizados ({finalizados.length})</span>
              {finalizados.map(r => (
                <MatrizReqCard key={r.id} r={r} profile={profile}
                  onResponder={setRespondendo} onExcluir={handleExcluir}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {respondendo && (
          <ModalResponder
            r={respondendo}
            profile={profile}
            onClose={() => setRespondendo(null)}
            onSaved={reload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
