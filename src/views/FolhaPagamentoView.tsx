import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, CheckCircle, Clock, DollarSign, X } from 'lucide-react';
import { useFetchData, dbInsert, dbSetStatus } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const statusCls = (s: string) =>
  s === 'Paga' ? 'text-green-400' : s === 'Processada' ? 'text-blue-400' : 'text-yellow-400';

const statusNext = (s: string): string | null =>
  s === 'Pendente' ? 'Processada' : s === 'Processada' ? 'Paga' : null;

const EMPTY: any = { funcionario_id: '', mes_ref: '', salario_bruto: '', descontos: '', status: 'Pendente' };

export const FolhaPagamentoView = ({ showToast }: any) => {
  const { data: folhas, setData, isLoading: loadingF } = useFetchData<any>('/api/folhapagamentoview');
  const { data: funcionarios, isLoading: loadingFn } = useFetchData<any>('/api/funcionariosview');

  const hoje = new Date().toISOString().slice(0, 7);
  const [mesFiltro, setMesFiltro] = useState(hoje);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  if (loadingF || loadingFn) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const folhasFiltradas = folhas.filter((f: any) => f.mes_ref === mesFiltro);
  const enriched = folhasFiltradas.map((f: any) => ({
    ...f,
    func: funcionarios.find((fn: any) => fn.id === f.funcionario_id),
  }));

  const totalBruto = folhasFiltradas.reduce((acc: number, f: any) => acc + Number(f.salario_bruto || 0), 0);
  const totalDesc = folhasFiltradas.reduce((acc: number, f: any) => acc + Number(f.descontos || 0), 0);
  const totalLiq = folhasFiltradas.reduce((acc: number, f: any) => acc + Number(f.salario_liquido || 0), 0);
  const pendentes = folhasFiltradas.filter((f: any) => f.status === 'Pendente').length;

  const handleSave = async () => {
    if (!form.funcionario_id || !form.mes_ref) { showToast('Funcionário e mês são obrigatórios.', 'error'); return; }
    const bruto = Number(form.salario_bruto || 0);
    const desc = Number(form.descontos || 0);
    setSaving(true);
    try {
      const rec = await dbInsert('/api/folhapagamentoview', {
        ...form,
        salario_bruto: bruto,
        descontos: desc,
        salario_liquido: bruto - desc,
      });
      setData((prev: any[]) => [rec, ...prev]);
      setForm(EMPTY);
      setShowForm(false);
      showToast('Folha registrada.', 'success');
    } catch { showToast('Erro ao salvar.', 'error'); }
    setSaving(false);
  };

  const handleStatusCycle = async (f: any) => {
    const next = statusNext(f.status);
    if (!next) return; // 'Paga' é estado terminal — sem reversão
    try {
      await dbSetStatus('/api/folhapagamentoview', f.id, next);
      setData((prev: any[]) => prev.map((x: any) => x.id === f.id ? { ...x, status: next } : x));
    } catch { showToast('Erro ao atualizar status.', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Folha de Pagamento</h2>
        <p className="text-sm text-gray-400 mt-1">Gerencie a folha mensal dos funcionários.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {[
          { label: 'Total Bruto', value: `R$ ${totalBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, warn: false },
          { label: 'Total Descontos', value: `R$ ${totalDesc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, warn: false },
          { label: 'Total Líquido', value: `R$ ${totalLiq.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, warn: false },
          { label: 'Folhas Pendentes', value: pendentes, warn: pendentes > 0 },
        ].map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className={`text-xl font-black leading-tight ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500 font-bold uppercase tracking-widest">Mês de Referência</label>
          <input type="month" value={mesFiltro} onChange={e => setMesFiltro(e.target.value)}
            className="neu-input rounded-xl px-3 py-2 text-sm" />
        </div>
        <NeuButtonAccent variant="yellow" onClick={() => setShowForm(v => !v)}><Plus size={14} />{showForm ? 'Cancelar' : 'Nova Folha'}</NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 overflow-hidden">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Registrar Folha</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                { label: 'Mês Ref. *', k: 'mes_ref', type: 'month' },
                { label: 'Salário Bruto (R$)', k: 'salario_bruto', type: 'number' },
                { label: 'Descontos (R$)', k: 'descontos', type: 'number' },
              ].map(({ label, k, type }) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                  <input type={type} value={form[k]} onChange={e => setForm((p: any) => ({ ...p, [k]: e.target.value }))} className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Líquido Estimado</label>
                <p className="neu-input rounded-xl px-3 py-2.5 text-sm text-green-400 font-mono font-bold">
                  R$ {(Number(form.salario_bruto || 0) - Number(form.descontos || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="yellow" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Registrar'}</NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden shrink-0">
        {enriched.length === 0 ? <EmptyState message={`Nenhuma folha para ${mesFiltro}.`} /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Funcionário</th>
                <th className="pb-4 font-bold px-4">Mês Ref.</th>
                <th className="pb-4 font-bold px-4 text-right">Bruto</th>
                <th className="pb-4 font-bold px-4 text-right">Descontos</th>
                <th className="pb-4 font-bold px-4 text-right">Líquido</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((f: any) => (
                    <motion.tr key={f.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{f.func?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.mes_ref ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right">R$ {Number(f.salario_bruto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs font-mono text-red-400 text-right">- R$ {Number(f.descontos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-green-400 text-right">R$ {Number(f.salario_liquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-center">
                        <button onClick={() => handleStatusCycle(f)}
                          className={`flex items-center gap-1.5 mx-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase hover:opacity-80 ${statusCls(f.status)}`}>
                          {f.status === 'Paga' ? <CheckCircle size={11} /> : f.status === 'Processada' ? <DollarSign size={11} /> : <Clock size={11} />}
                          {f.status}
                        </button>
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
