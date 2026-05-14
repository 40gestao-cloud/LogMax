import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const RecebimentosView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/recebimentosview');
  const { data: pedidos } = useFetchData<any>('/api/pedidosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ pedido_id: '' });
  const [extras, setExtras] = useState({ qtd_recebida: '', observacao: '', status: 'Pendente' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const enriched = data.map((r: any) => ({ ...r, ped: pedidos.find((p: any) => p.id === r.pedido_id) }));
  const filtered = enriched.filter((r: any) => [r.status, String(r.pedido_id)].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())));

  const closeForm = () => { setShowForm(false); setForm({ pedido_id: '' }); setExtras({ qtd_recebida: '', observacao: '', status: 'Pendente' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true); showToast("Salvando...", 'info', false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const payload = { ...form, qtd_recebida: Number(extras.qtd_recebida) || 0, observacao: extras.observacao, status: extras.status, data: today };
      const s = await dbInsert('/api/recebimentosview', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      showToast("Recebimento registrado!", 'success', true); closeForm();
    } catch { showToast("Erro ao salvar.", 'error', true); } finally { setIsSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex justify-between items-center shrink-0">
        <div><h2 className="text-3xl font-bold text-gray-100 tracking-tight">Recebimentos</h2><p className="text-sm text-gray-400 mt-1">Registre o recebimento de mercadorias dos pedidos.</p></div>
        <div className="flex gap-4 items-center">
          <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-56" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Registrar</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Novo Recebimento</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Pedido *" error={errors.pedido_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.pedido_id ? 'border border-red-500/40' : ''}`} value={form.pedido_id} onChange={e => { setForm(f => ({ ...f, pedido_id: e.target.value })); clearError('pedido_id'); }}><option value="">Selecione...</option>{pedidos.map((p: any) => <option key={p.id} value={p.id}>Pedido #{p.id.slice(0, 8)} — {p.status}</option>)}</select></FormField>
                <FormField label="Qtd Recebida"><input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_recebida} onChange={e => setExtras(x => ({ ...x, qtd_recebida: e.target.value }))} placeholder="0" /></FormField>
                <FormField label="Status"><select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.status} onChange={e => setExtras(x => ({ ...x, status: e.target.value }))}>{['Pendente', 'Concluído', 'Parcial'].map(s => <option key={s} value={s}>{s}</option>)}</select></FormField>
                <FormField label="Observação"><input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.observacao} onChange={e => setExtras(x => ({ ...x, observacao: e.target.value }))} placeholder="Opcional..." /></FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Registrar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4">Pedido</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Observação</th><th className="pb-4 font-bold px-4 text-center">Status</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={5}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={5}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-300">#{String(item.pedido_id ?? '').slice(0, 8)}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd_recebida ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.observacao || '—'}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};
