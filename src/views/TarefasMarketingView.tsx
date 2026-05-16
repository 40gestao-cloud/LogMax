import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, ChevronRight, AlertCircle, ExternalLink, Send, Link2 } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const STATUS_FLOW = ['Pendente', 'Ciente', 'Em Produção', 'Concluído', 'Postado'] as const;
type TarefaStatus = typeof STATUS_FLOW[number];

const STATUS_STYLE: Record<string, string> = {
  'Pendente':    'bg-gray-500/10 text-gray-400 border-gray-500/20',
  'Ciente':      'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Em Produção': 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Concluído':   'bg-accent/10 text-accent border-accent/20',
  'Postado':     'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const LINK_STATUS_STYLE: Record<string, string> = {
  'Sem Link':             'bg-gray-500/10 text-gray-500 border-gray-500/20',
  'Aguardando Aprovação': 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Aprovado':             'bg-accent/10 text-accent border-accent/20',
  'Reprovado':            'bg-red-500/10 text-red-500 border-red-500/20',
};

const PRIO_STYLE: Record<string, string> = {
  'Alta':  'text-red-500',
  'Média': 'text-yellow-400',
  'Baixa': 'text-gray-500',
};

const EMPTY_FORM = { titulo: '', descricao: '', prioridade: 'Média', prazo: '' };

export const TarefasMarketingView = ({ showToast, profile }: any) => {
  const { data: tarefas, setData, isLoading } = useFetchData<any>('/api/marketingtarefasview');
  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState<any>(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [updatingId, setUpdatingId]   = useState<string | null>(null);
  const [linkingId, setLinkingId]     = useState<string | null>(null);
  const [linkInput, setLinkInput]     = useState<Record<string, string>>({});
  const [submittingLink, setSubmittingLink] = useState<string | null>(null);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const canCreate = profile?.role === 'admin' || profile?.role === 'gerente';

  const pendentes   = tarefas.filter((t: any) => t.status === 'Pendente').length;
  const emProd      = tarefas.filter((t: any) => t.status === 'Em Produção').length;
  const finalizadas = tarefas.filter((t: any) => t.status === 'Concluído' || t.status === 'Postado').length;

  const kpis = [
    { label: 'Total de Tarefas', value: tarefas.length,  warn: false },
    { label: 'Pendentes',        value: pendentes,        warn: pendentes > 0 },
    { label: 'Em Produção',      value: emProd,           warn: false },
    { label: 'Finalizadas',      value: finalizadas,      warn: false },
  ];

  const nextStatus = (current: string): TarefaStatus | null => {
    const idx = STATUS_FLOW.indexOf(current as TarefaStatus);
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
  };

  const handleSave = async () => {
    if (!form.titulo) { showToast('Título é obrigatório.', 'error'); return; }
    setSaving(true);
    try {
      const created = await dbInsert('/api/marketingtarefasview', {
        ...form,
        prazo:        form.prazo || null,
        status:       'Pendente',
        status_link:  'Sem Link',
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
      const updated = await dbUpdate('/api/marketingtarefasview', tarefa.id, { status: next });
      setData((prev: any[]) => prev.map((t: any) => t.id === tarefa.id ? { ...t, ...updated } : t));
      showToast(`Status atualizado: ${next}`, 'success');
    } catch {
      showToast('Erro ao atualizar status.', 'error');
    }
    setUpdatingId(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await dbDelete('/api/marketingtarefasview', id);
      setData((prev: any[]) => prev.filter((t: any) => t.id !== id));
      showToast('Tarefa removida.', 'success');
    } catch {
      showToast('Erro ao remover.', 'error');
    }
  };

  const handleSubmitLink = async (tarefaId: string) => {
    const url = linkInput[tarefaId]?.trim();
    if (!url) { showToast('Informe o link.', 'error'); return; }
    setSubmittingLink(tarefaId);
    try {
      const updated = await dbUpdate('/api/marketingtarefasview', tarefaId, {
        link_propaganda: url,
        status_link:     'Aguardando Aprovação',
        obs_link:        null,
      });
      setData((prev: any[]) => prev.map((t: any) => t.id === tarefaId ? { ...t, ...updated } : t));
      setLinkingId(null);
      setLinkInput(prev => { const n = { ...prev }; delete n[tarefaId]; return n; });
      showToast('Link enviado para aprovação!', 'success');
    } catch {
      showToast('Erro ao enviar link.', 'error');
    }
    setSubmittingLink(null);
  };

  const isVencida = (t: any) =>
    t.prazo && new Date(t.prazo) < new Date() && t.status !== 'Concluído' && t.status !== 'Postado';

  const canAddLink = (t: any) =>
    !t.status_link || t.status_link === 'Sem Link' || t.status_link === 'Reprovado';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Tarefas de Marketing</h2>
        <p className="text-sm text-gray-400 mt-1">Gerencie demandas e acompanhe o fluxo: Pendente → Ciente → Em Produção → Concluído → Postado.</p>
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
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Criar arte para lançamento do Produto X" />
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
              const next        = nextStatus(t.status);
              const isUpdating  = updatingId === t.id;
              const vencida     = isVencida(t);
              const linkStatus  = t.status_link ?? 'Sem Link';
              const isLinking   = linkingId === t.id;
              const isSubmitting = submittingLink === t.id;

              return (
                <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">

                  {/* Linha principal: info + botões de status */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
                  </div>

                  {/* Seção de link de propaganda */}
                  <div className="border-t border-white/5 pt-3">
                    {/* Mostra link existente (não-editável) */}
                    {t.link_propaganda && !isLinking && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link2 size={12} className="text-gray-500 shrink-0" />
                          <a href={t.link_propaganda} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-accent hover:underline truncate max-w-[10rem] sm:max-w-[260px] flex items-center gap-1">
                            {t.link_propaganda}
                            <ExternalLink size={10} className="shrink-0" />
                          </a>
                          <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${LINK_STATUS_STYLE[linkStatus]}`}>
                            {linkStatus}
                          </span>
                        </div>
                        {t.obs_link && linkStatus === 'Reprovado' && (
                          <p className="text-[10px] text-red-400 pl-5">Motivo: {t.obs_link}</p>
                        )}
                        {/* Permite reenviar se reprovado */}
                        {linkStatus === 'Reprovado' && (
                          <button onClick={() => { setLinkingId(t.id); setLinkInput(prev => ({ ...prev, [t.id]: t.link_propaganda ?? '' })); }}
                            className="text-[10px] text-gray-500 hover:text-accent transition-colors pl-5 text-left w-fit">
                            Atualizar e reenviar link
                          </button>
                        )}
                      </div>
                    )}

                    {/* Input para adicionar/atualizar link */}
                    {isLinking ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="url"
                          value={linkInput[t.id] ?? ''}
                          onChange={e => setLinkInput(prev => ({ ...prev, [t.id]: e.target.value }))}
                          placeholder="https://drive.google.com/... ou outro link"
                          className="neu-input rounded-xl px-3 py-2 text-xs flex-1"
                          autoFocus
                        />
                        <button onClick={() => handleSubmitLink(t.id)} disabled={isSubmitting}
                          className="neu-button py-2 px-3 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 flex items-center gap-1 disabled:opacity-40">
                          {isSubmitting ? '...' : <><Send size={11} />Enviar</>}
                        </button>
                        <button onClick={() => setLinkingId(null)}
                          className="w-7 h-7 flex items-center justify-center neu-button rounded-lg text-gray-500 hover:text-white">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      // Botão para abrir input (quando não tem link ou status permite reenvio)
                      !t.link_propaganda && canAddLink(t) && (
                        <button onClick={() => setLinkingId(t.id)}
                          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-accent transition-colors">
                          <Link2 size={12} />Adicionar link de propaganda
                        </button>
                      )
                    )}

                    {/* Link sem input expandido: aguardando ou aprovado (apenas leitura) */}
                    {!t.link_propaganda && !isLinking && !canAddLink(t) && (
                      <span className="text-[10px] text-gray-600">Nenhum link adicionado.</span>
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
