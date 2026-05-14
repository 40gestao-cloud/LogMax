import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Landmark, Plus, Trash2, CheckCircle, AlertTriangle, Clock, Building2 } from 'lucide-react';
import { useFetchData, dbInsert, dbDelete, dbSetStatus } from '../hooks/useSupabaseData';
import { LoadingSpinner, StatusBadge, FormField, NeuButtonAccent } from '../components/ui';

const statusIcon = (s: string) => {
  if (s === 'Processado') return <CheckCircle size={12} className="text-green-400" />;
  if (s === 'Erro') return <AlertTriangle size={12} className="text-red-400" />;
  return <Clock size={12} className="text-yellow-400" />;
};

const EMPTY_FORM = { banco: '', arquivo: '', data_import: '', registros: '', status: 'Pendente' };

export const IntegracaoBancariaView = ({ showToast }: any) => {
  const { data: integracoes, setData: setIntegracoes, isLoading: loadingInt } = useFetchData<any>('/api/integracaobancariaview');
  const { data: contas, isLoading: loadingContas } = useFetchData<any>('/api/caixabancosview');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const isLoading = loadingInt || loadingContas;
  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const contasAtivas = contas.filter((c: any) => c.status === 'Ativo');
  const saldoTotal = contasAtivas.reduce((acc: number, c: any) => acc + Number(c.saldo || 0), 0);
  const processadas = integracoes.filter((i: any) => i.status === 'Processado').length;
  const comErro = integracoes.filter((i: any) => i.status === 'Erro').length;

  const kpis = [
    { label: 'Contas Ativas', value: contasAtivas.length, sub: 'cadastradas', warn: false },
    { label: 'Saldo Total', value: `R$ ${saldoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: 'em todas as contas', warn: false },
    { label: 'Importações Processadas', value: processadas, sub: 'com sucesso', warn: false },
    { label: 'Importações com Erro', value: comErro, sub: 'requerem atenção', warn: comErro > 0 },
  ];

  const handleSave = async () => {
    if (!form.banco || !form.arquivo) { showToast('Banco e arquivo são obrigatórios.', 'error'); return; }
    setSaving(true);
    try {
      const rec = await dbInsert('/api/integracaobancariaview', { ...form, registros: Number(form.registros || 0) });
      setIntegracoes((prev: any[]) => [rec, ...prev]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      showToast('Importação registrada com sucesso.', 'success');
    } catch { showToast('Erro ao registrar importação.', 'error'); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await dbDelete('/api/integracaobancariaview', id);
      setIntegracoes((prev: any[]) => prev.filter((i: any) => i.id !== id));
      showToast('Registro removido.', 'success');
    } catch { showToast('Erro ao remover.', 'error'); }
  };

  const handleStatusCycle = async (item: any) => {
    const next = item.status === 'Pendente' ? 'Processado' : item.status === 'Processado' ? 'Erro' : 'Pendente';
    try {
      await dbSetStatus('/api/integracaobancariaview', item.id, next);
      setIntegracoes((prev: any[]) => prev.map((i: any) => i.id === item.id ? { ...i, status: next } : i));
    } catch { showToast('Erro ao atualizar status.', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Integração Bancária</h2>
        <p className="text-sm text-gray-400 mt-1">Gerencie contas bancárias e o histórico de importações/conciliações.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className={`text-xl font-black leading-tight ${k.warn ? 'text-red-400' : 'text-gray-100'}`}>{k.value}</p>
            <p className="text-xs text-gray-600 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Contas bancárias */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={14} className="text-accent" />
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Contas Bancárias</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contasAtivas.length === 0 ? (
            <p className="text-xs text-gray-600 col-span-3 py-4">Nenhuma conta ativa cadastrada.</p>
          ) : contasAtivas.map((c: any) => (
            <div key={c.id} className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Landmark size={14} className="text-accent" />
                  <span className="text-xs font-bold text-gray-300">{c.banco ?? '—'}</span>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-[10px] text-gray-500">Ag. {c.agencia ?? '—'} · Conta {c.conta ?? '—'}</p>
              <p className="text-[10px] text-gray-500">{c.tipo ?? '—'}</p>
              <p className={`text-lg font-black font-mono mt-1 ${Number(c.saldo) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                R$ {Number(c.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Histórico de importações */}
      <div className="shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Histórico de Importações</h3>
          </div>
          <NeuButtonAccent onClick={() => setShowForm(v => !v)}>
            <Plus size={14} />{showForm ? 'Cancelar' : 'Nova Importação'}
          </NeuButtonAccent>
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="neu-flat rounded-2xl p-5 border border-white/5 mb-4 overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Banco" value={form.banco} onChange={(v: string) => setForm((p: any) => ({ ...p, banco: v }))} placeholder="Ex: Banco do Brasil" required />
                <FormField label="Arquivo" value={form.arquivo} onChange={(v: string) => setForm((p: any) => ({ ...p, arquivo: v }))} placeholder="Ex: extrato_jan.ofx" required />
                <FormField label="Data de Importação" type="date" value={form.data_import} onChange={(v: string) => setForm((p: any) => ({ ...p, data_import: v }))} />
                <FormField label="Nº de Registros" type="number" value={form.registros} onChange={(v: string) => setForm((p: any) => ({ ...p, registros: v }))} placeholder="0" />
                <FormField label="Status" type="select" value={form.status} onChange={(v: string) => setForm((p: any) => ({ ...p, status: v }))} options={['Pendente', 'Processado', 'Erro']} />
              </div>
              <div className="flex justify-end mt-4">
                <NeuButtonAccent onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Registrar Importação'}</NeuButtonAccent>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
          {integracoes.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-8">Nenhuma importação registrada.</p>
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 pt-5 font-bold px-5">Banco</th>
                    <th className="pb-4 pt-5 font-bold px-5">Arquivo</th>
                    <th className="pb-4 pt-5 font-bold px-5">Data</th>
                    <th className="pb-4 pt-5 font-bold px-5 text-right">Registros</th>
                    <th className="pb-4 pt-5 font-bold px-5 text-center">Status</th>
                    <th className="pb-4 pt-5 font-bold px-5" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {integracoes.map((i: any) => (
                      <motion.tr key={i.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-5 text-sm font-semibold text-gray-200">{i.banco ?? '—'}</td>
                        <td className="py-3 px-5 text-xs font-mono text-gray-400">{i.arquivo ?? '—'}</td>
                        <td className="py-3 px-5 text-xs text-gray-400">{i.data_import ?? '—'}</td>
                        <td className="py-3 px-5 text-xs font-mono text-gray-300 text-right">{i.registros ?? 0}</td>
                        <td className="py-3 px-5 text-center">
                          <button onClick={() => handleStatusCycle(i)}
                            className="flex items-center gap-1.5 mx-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase hover:opacity-80 transition-opacity">
                            {statusIcon(i.status)}
                            <span className={i.status === 'Processado' ? 'text-green-400' : i.status === 'Erro' ? 'text-red-400' : 'text-yellow-400'}>{i.status}</span>
                          </button>
                        </td>
                        <td className="py-3 px-5">
                          <button onClick={() => handleDelete(i.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
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
      </div>
    </motion.div>
  );
};
