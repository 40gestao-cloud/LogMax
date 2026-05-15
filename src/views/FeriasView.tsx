import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, X as XIcon, Palmtree } from 'lucide-react';
import { useFetchData, dbInsert, dbSetStatus } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const statusCls = (s: string) => {
  if (s === 'Aprovada') return 'bg-green-900/30 text-green-400';
  if (s === 'Negada') return 'bg-red-900/30 text-red-400';
  if (s === 'Em Andamento') return 'bg-blue-900/30 text-blue-400';
  if (s === 'Concluída') return 'bg-gray-700/40 text-gray-400';
  return 'bg-yellow-900/30 text-yellow-400'; // Solicitada
};

const EMPTY: any = { funcionario_id: '', data_inicio: '', data_fim: '', dias: '30', status: 'Solicitada' };

export const FeriasView = ({ showToast }: any) => {
  const { data: ferias, setData, isLoading: loadingF } = useFetchData<any>('/api/feriasview');
  const { data: funcionarios, isLoading: loadingFn } = useFetchData<any>('/api/funcionariosview');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  if (loadingF || loadingFn) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const enriched = ferias.map((f: any) => ({
    ...f,
    func: funcionarios.find((fn: any) => fn.id === f.funcionario_id),
  }));

  const solicitadas = ferias.filter((f: any) => f.status === 'Solicitada').length;
  const aprovadas = ferias.filter((f: any) => f.status === 'Aprovada').length;
  const emAndamento = ferias.filter((f: any) => f.status === 'Em Andamento').length;
  const concluidas = ferias.filter((f: any) => f.status === 'Concluída').length;

  const calcDias = (inicio: string, fim: string) => {
    if (!inicio || !fim) return 0;
    const diff = new Date(fim).getTime() - new Date(inicio).getTime();
    return Math.max(Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1, 0);
  };

  const handleSave = async () => {
    if (!form.funcionario_id || !form.data_inicio) { showToast('Funcionário e data de início são obrigatórios.', 'error'); return; }
    setSaving(true);
    try {
      const rec = await dbInsert('/api/feriasview', { ...form, dias: Number(form.dias || 30) });
      setData((prev: any[]) => [rec, ...prev]);
      setForm(EMPTY);
      setShowForm(false);
      showToast('Férias solicitadas.', 'success');
    } catch { showToast('Erro ao salvar.', 'error'); }
    setSaving(false);
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await dbSetStatus('/api/feriasview', id, status);
      setData((prev: any[]) => prev.map((f: any) => f.id === id ? { ...f, status } : f));
      showToast(`Status atualizado para ${status}.`, 'success');
    } catch { showToast('Erro.', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Férias</h2>
        <p className="text-sm text-gray-400 mt-1">Gerencie solicitações e períodos de férias dos funcionários.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {[
          { label: 'Solicitadas', value: solicitadas, warn: solicitadas > 0 },
          { label: 'Aprovadas', value: aprovadas, warn: false },
          { label: 'Em Andamento', value: emAndamento, warn: false },
          { label: 'Concluídas', value: concluidas, warn: false },
        ].map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end shrink-0">
        <NeuButtonAccent variant="yellow" onClick={() => setShowForm(v => !v)}><Plus size={14} />{showForm ? 'Cancelar' : 'Solicitar Férias'}</NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 overflow-hidden">
            <h3 className="text-sm font-bold text-gray-300 mb-5">Nova Solicitação de Férias</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Funcionário *</label>
                <select value={form.funcionario_id} onChange={e => setForm((p: any) => ({ ...p, funcionario_id: e.target.value }))} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {funcionarios.filter((f: any) => f.status === 'Ativo').map((f: any) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              </div>
              {[
                { label: 'Data Início *', k: 'data_inicio', type: 'date' },
                { label: 'Data Fim', k: 'data_fim', type: 'date' },
                { label: 'Dias', k: 'dias', type: 'number' },
              ].map(({ label, k, type }) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                  <input type={type} value={form[k]} onChange={e => {
                    const v = e.target.value;
                    if (k === 'data_fim') {
                      const dias = calcDias(form.data_inicio, v);
                      setForm((p: any) => ({ ...p, data_fim: v, dias: String(dias || p.dias) }));
                    } else {
                      setForm((p: any) => ({ ...p, [k]: v }));
                    }
                  }} className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="yellow" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Solicitar'}</NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden shrink-0">
        {enriched.length === 0 ? <EmptyState message="Nenhuma férias registrada." /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Funcionário</th>
                <th className="pb-4 font-bold px-4">Início</th>
                <th className="pb-4 font-bold px-4">Fim</th>
                <th className="pb-4 font-bold px-4 text-center">Dias</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4" />
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((f: any) => (
                    <motion.tr key={f.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                        <div className="flex items-center gap-2">
                          <Palmtree size={13} className="text-green-400 shrink-0" />
                          {f.func?.nome ?? '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.data_inicio ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.data_fim ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{f.dias ?? 0}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusCls(f.status)}`}>{f.status}</span>
                      </td>
                      <td className="py-3 px-4">
                        {f.status === 'Solicitada' && (
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={() => setStatus(f.id, 'Aprovada')}
                              className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-green-400 transition-colors" title="Aprovar">
                              <Check size={13} />
                            </button>
                            <button onClick={() => setStatus(f.id, 'Negada')}
                              className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-400 transition-colors" title="Negar">
                              <XIcon size={13} />
                            </button>
                          </div>
                        )}
                        {f.status === 'Aprovada' && (
                          <button onClick={() => setStatus(f.id, 'Em Andamento')}
                            className="text-[10px] text-blue-400 hover:underline transition-colors font-bold ml-auto block">Iniciar</button>
                        )}
                        {f.status === 'Em Andamento' && (
                          <button onClick={() => setStatus(f.id, 'Concluída')}
                            className="text-[10px] text-gray-400 hover:underline transition-colors font-bold ml-auto block">Concluir</button>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
