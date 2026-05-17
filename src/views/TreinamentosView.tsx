import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, BookOpen, X } from 'lucide-react';
import { useFetchData, dbInsert, dbSetStatus } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const statusCls = (s: string) => {
  if (s === 'Concluído') return 'bg-green-900/30 text-green-400';
  if (s === 'Em Andamento') return 'bg-blue-900/30 text-blue-400';
  if (s === 'Cancelado') return 'bg-red-950/50 text-red-500';
  return 'bg-yellow-900/30 text-yellow-400'; // Agendado
};

const statusNext = (s: string) =>
  s === 'Agendado' ? 'Em Andamento' : s === 'Em Andamento' ? 'Concluído' : s;

const EMPTY: any = { nome: '', instrutor: '', data_inicio: '', data_fim: '', vagas: '', inscritos: '0', status: 'Agendado' };

export const TreinamentosView = ({ showToast }: any) => {
  const { data: treinamentos, setData, isLoading } = useFetchData<any>('/api/treinamentosview');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const agendados = treinamentos.filter((t: any) => t.status === 'Agendado').length;
  const emAndamento = treinamentos.filter((t: any) => t.status === 'Em Andamento').length;
  const vagasDisp = treinamentos
    .filter((t: any) => t.status === 'Agendado')
    .reduce((acc: number, t: any) => acc + Math.max(Number(t.vagas || 0) - Number(t.inscritos || 0), 0), 0);
  const concluidos = treinamentos.filter((t: any) => t.status === 'Concluído').length;

  const filtered = treinamentos.filter((t: any) =>
    [t.nome, t.instrutor, t.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSave = async () => {
    if (!form.nome) { showToast('Nome do treinamento é obrigatório.', 'error'); return; }
    setSaving(true);
    try {
      const rec = await dbInsert('/api/treinamentosview', { ...form, vagas: Number(form.vagas || 0), inscritos: Number(form.inscritos || 0) });
      setData((prev: any[]) => [rec, ...prev]);
      setForm(EMPTY);
      setShowForm(false);
      showToast('Treinamento criado.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Treinamentos] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error');
    }
    setSaving(false);
  };

  const handleStatusAdvance = async (t: any) => {
    if (t.status === 'Concluído' || t.status === 'Cancelado') return;
    const next = statusNext(t.status);
    try {
      await dbSetStatus('/api/treinamentosview', t.id, next);
      setData((prev: any[]) => prev.map((x: any) => x.id === t.id ? { ...x, status: next } : x));
    } catch { showToast('Erro ao avançar status.', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Treinamentos</h2>
        <p className="text-sm text-gray-400 mt-1">Gerencie treinamentos internos e externos com controle de vagas.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {[
          { label: 'Agendados', value: agendados, warn: false },
          { label: 'Em Andamento', value: emAndamento, warn: false },
          { label: 'Vagas Disponíveis', value: vagasDisp, warn: vagasDisp === 0 && agendados > 0 },
          { label: 'Concluídos', value: concluidos, warn: false },
        ].map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="relative">
          <BookOpen size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Buscar treinamento..." value={search} onChange={e => setSearch(e.target.value)}
            className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52" />
        </div>
        <NeuButtonAccent variant="" onClick={() => setShowForm(v => !v)}><Plus size={14} />{showForm ? 'Cancelar' : 'Novo Treinamento'}</NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Novo Treinamento</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Nome *', k: 'nome', type: 'text' },
                { label: 'Instrutor', k: 'instrutor', type: 'text' },
                { label: 'Data Início', k: 'data_inicio', type: 'date' },
                { label: 'Data Fim', k: 'data_fim', type: 'date' },
                { label: 'Vagas', k: 'vagas', type: 'number' },
                { label: 'Inscritos', k: 'inscritos', type: 'number' },
              ].map(({ label, k, type }) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                  <input type={type} value={form[k]} onChange={e => setForm((p: any) => ({ ...p, [k]: e.target.value }))} className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</label>
                <select value={form.status} onChange={e => setForm((p: any) => ({ ...p, status: e.target.value }))} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {['Agendado', 'Em Andamento', 'Concluído', 'Cancelado'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Criar'}</NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Treinamento</th>
                <th className="pb-4 font-bold px-4">Instrutor</th>
                <th className="pb-4 font-bold px-4">Início</th>
                <th className="pb-4 font-bold px-4">Fim</th>
                <th className="pb-4 font-bold px-4 text-center">Vagas</th>
                <th className="pb-4 font-bold px-4 text-center">Inscritos</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((t: any) => {
                    const vagasLiv = Math.max(Number(t.vagas || 0) - Number(t.inscritos || 0), 0);
                    return (
                      <motion.tr key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{t.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{t.instrutor ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{t.data_inicio ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{t.data_fim ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{t.vagas ?? 0}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-xs font-mono font-bold ${vagasLiv === 0 ? 'text-red-500' : 'text-green-400'}`}>
                            {t.inscritos ?? 0} <span className="text-gray-600 font-normal">/ {t.vagas ?? 0}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button onClick={() => handleStatusAdvance(t)}
                            disabled={t.status === 'Concluído' || t.status === 'Cancelado'}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-opacity ${statusCls(t.status)} ${!(t.status === 'Concluído' || t.status === 'Cancelado') ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}>
                            {t.status}
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
