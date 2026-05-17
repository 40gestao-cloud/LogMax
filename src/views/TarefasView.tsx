import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, ChevronRight, AlertCircle } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const STATUS_FLOW = ['Pendente', 'Ciente', 'Em Andamento', 'Concluído'] as const;
type TarefaStatus = typeof STATUS_FLOW[number];

const STATUS_STYLE: Record<string, string> = {
  'Pendente':     'bg-gray-500/10 text-gray-400 border-gray-500/20',
  'Ciente':       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Em Andamento': 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Concluído':    'bg-accent/10 text-accent border-accent/20',
};

const PRIO_STYLE: Record<string, string> = {
  'Alta':  'text-red-500',
  'Média': 'text-yellow-400',
  'Baixa': 'text-gray-500',
};

const MODULE_LABEL: Record<string, string> = {
  empresa:    'Empresa',
  compras:    'Compras',
  estoque:    'Estoque',
  financeiro: 'Financeiro',
  rh:         'Recursos Humanos',
  vendas:     'Vendas',
};

const EMPTY_FORM = { titulo: '', descricao: '', prioridade: 'Média', prazo: '' };

type TarefasViewProps = {
  showToast: (msg: string, type?: string) => void;
  profile: any;
  modulo: 'empresa' | 'compras' | 'estoque' | 'financeiro' | 'rh' | 'vendas';
};

export const TarefasView = ({ showToast, profile, modulo }: TarefasViewProps) => {
  // Filtra por módulo no servidor — a tabela `tarefas` é compartilhada.
  const filter = useMemo(() => ({ modulo }), [modulo]);
  const { data: tarefas, setData, isLoading } = useFetchData<any>('/api/tarefasview', filter);

  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState<any>(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const canCreate = profile?.role === 'admin' || profile?.role === 'ceo';
  const moduloLabel = MODULE_LABEL[modulo] ?? modulo;

  const pendentes   = tarefas.filter((t: any) => t.status === 'Pendente').length;
  const emAndamento = tarefas.filter((t: any) => t.status === 'Em Andamento').length;
  const concluidas  = tarefas.filter((t: any) => t.status === 'Concluído').length;

  const kpis = [
    { label: 'Total de Tarefas', value: tarefas.length, warn: false },
    { label: 'Pendentes',        value: pendentes,      warn: pendentes > 0 },
    { label: 'Em Andamento',     value: emAndamento,    warn: false },
    { label: 'Concluídas',       value: concluidas,     warn: false },
  ];

  const nextStatus = (current: string): TarefaStatus | null => {
    const idx = STATUS_FLOW.indexOf(current as TarefaStatus);
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
  };

  const handleSave = async () => {
    if (!form.titulo) { showToast('Título é obrigatório.', 'error'); return; }
    setSaving(true);
    try {
      const created = await dbInsert('/api/tarefasview', {
        ...form,
        modulo,
        prazo:        form.prazo || null,
        status:       'Pendente',
        nome_criador: profile?.nome ?? '',
      });
      setData((prev: any[]) => [created, ...prev]);
      showToast('Tarefa criada.', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch {
      showToast('Erro ao criar tarefa.', 'error');
    }
    setSaving(false);
  };

  const handleAdvance = async (tarefa: any) => {
    const next = nextStatus(tarefa.status);
    if (!next) return;
    setUpdatingId(tarefa.id);
    try {
      const updated = await dbUpdate('/api/tarefasview', tarefa.id, { status: next });
      setData((prev: any[]) => prev.map((t: any) => t.id === tarefa.id ? { ...t, ...updated } : t));
      showToast(`Status atualizado: ${next}`, 'success');
    } catch {
      showToast('Erro ao atualizar status.', 'error');
    }
    setUpdatingId(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await dbDelete('/api/tarefasview', id);
      setData((prev: any[]) => prev.filter((t: any) => t.id !== id));
      showToast('Tarefa removida.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Tarefas] erro ao remover:', err);
      showToast(`Erro ao remover: ${msg}`, 'error');
    }
  };

  const isVencida = (t: any) =>
    t.prazo && new Date(t.prazo) < new Date() && t.status !== 'Concluído';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
          Tarefas de {moduloLabel}
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Demandas para a equipe — fluxo: Pendente → Ciente → Em Andamento → Concluído.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {canCreate && (
        <div className="flex justify-end shrink-0">
          <NeuButtonAccent variant="" onClick={() => setShowForm(v => !v)}>
            <Plus size={14} />Nova Tarefa
          </NeuButtonAccent>
        </div>
      )}

      <AnimatePresence>
        {showForm && canCreate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Nova Tarefa</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Título *</label>
                <input type="text" value={form.titulo} onChange={e => setForm((f: any) => ({ ...f, titulo: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Conferir lote de mercadoria X" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Prioridade</label>
                <select value={form.prioridade} onChange={e => setForm((f: any) => ({ ...f, prioridade: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {['Alta', 'Média', 'Baixa'].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                <input type="text" value={form.descricao} onChange={e => setForm((f: any) => ({ ...f, descricao: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Detalhes da demanda..." />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Prazo</label>
                <input type="date" value={form.prazo} onChange={e => setForm((f: any) => ({ ...f, prazo: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                {saving ? 'Criando...' : 'Criar Tarefa'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-3 shrink-0">
        {tarefas.length === 0 ? (
          <EmptyState message="Nenhuma tarefa cadastrada" />
        ) : (
          <AnimatePresence>
            {tarefas.map((t: any) => {
              const next       = nextStatus(t.status);
              const isUpdating = updatingId === t.id;
              const vencida    = isVencida(t);

              return (
                <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[10px] font-black uppercase tracking-wide ${PRIO_STYLE[t.prioridade] ?? 'text-gray-500'}`}>
                        {t.prioridade}
                      </span>
                      {vencida && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-red-500">
                          <AlertCircle size={10} />Vencida
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-gray-200 truncate">{t.titulo}</p>
                    {t.descricao && <p className="text-xs text-gray-500 mt-0.5 truncate">{t.descricao}</p>}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[t.status] ?? ''}`}>
                        {t.status}
                      </span>
                      {t.prazo && (
                        <span className={`text-[10px] font-mono ${vencida ? 'text-red-500' : 'text-gray-600'}`}>
                          Prazo: {t.prazo}
                        </span>
                      )}
                      {t.nome_criador && (
                        <span className="text-[10px] text-gray-600">Por: {t.nome_criador}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {next && (
                      <button onClick={() => handleAdvance(t)} disabled={isUpdating}
                        className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 transition-all disabled:opacity-40 flex items-center gap-1.5">
                        {isUpdating ? '...' : <><ChevronRight size={12} />{next}</>}
                      </button>
                    )}
                    {canCreate && (
                      <button onClick={() => handleDelete(t.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500 transition-colors">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
};
