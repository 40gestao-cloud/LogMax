import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const InventariosView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/inventariosestoqueview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ produto_id: '' });
  const [extras, setExtras] = useState({ qtd_sistema: '', qtd_contada: '', status: 'Em Andamento' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const enriched = data.map((i: any) => ({ ...i, prod: produtos.find((p: any) => p.id === i.produto_id) }));
  const filtered = enriched.filter((i: any) => [i.prod?.nome, i.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())));

  const closeForm = () => { setShowForm(false); setForm({ produto_id: '' }); setExtras({ qtd_sistema: '', qtd_contada: '', status: 'Em Andamento' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true); showToast("Salvando...", 'info', false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const payload = { ...form, qtd_sistema: Number(extras.qtd_sistema) || 0, qtd_contada: Number(extras.qtd_contada) || 0, status: extras.status, data: today };
      const s = await dbInsert('/api/inventariosestoqueview', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      showToast("Inventário registrado!", 'success', true); closeForm();
    } catch { showToast("Erro.", 'error', true); } finally { setIsSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex justify-between items-center shrink-0">
        <div><h2 className="text-3xl font-bold text-gray-100 tracking-tight">Inventários</h2><p className="text-sm text-gray-400 mt-1">Realize contagens de estoque e registre divergências.</p></div>
        <div className="flex gap-4 items-center">
          <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-56" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova Contagem</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Contagem</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Produto *" error={errors.produto_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`} value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}><option value="">Selecione...</option>{produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></FormField>
                <FormField label="Qtd no Sistema"><input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_sistema} onChange={e => setExtras(x => ({ ...x, qtd_sistema: e.target.value }))} placeholder="0" /></FormField>
                <FormField label="Qtd Contada"><input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_contada} onChange={e => setExtras(x => ({ ...x, qtd_contada: e.target.value }))} placeholder="0" /></FormField>
                <FormField label="Status"><select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.status} onChange={e => setExtras(x => ({ ...x, status: e.target.value }))}>{['Em Andamento', 'Concluído', 'Cancelado'].map(s => <option key={s} value={s}>{s}</option>)}</select></FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Salvar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-right">Qtd Sistema</th><th className="pb-4 font-bold px-4 text-right">Qtd Contada</th><th className="pb-4 font-bold px-4 text-right">Diferença</th><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4 text-center">Status</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => {
                    const dif = Number(item.diferenca ?? (item.qtd_contada - item.qtd_sistema) ?? 0);
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">{item.qtd_sistema ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">{item.qtd_contada ?? '—'}</td>
                        <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${dif < 0 ? 'text-red-400' : dif > 0 ? 'text-green-400' : 'text-gray-400'}`}>{dif > 0 ? `+${dif}` : dif}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};
