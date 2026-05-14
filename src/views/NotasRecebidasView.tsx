import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const NotasRecebidasView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/notasrecebidasview');
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ numero_nf: '' });
  const [extras, setExtras] = useState({ fornecedor_id: '', valor_total: '', data_emissao: '', status: 'Não Vinculada' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const enriched = data.map((n: any) => ({ ...n, forn: fornecedores.find((f: any) => f.id === n.fornecedor_id) }));
  const filtered = enriched.filter((n: any) => [n.numero_nf, n.status, n.forn?.nome].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())));

  const closeForm = () => { setShowForm(false); setEditItem(null); setForm({ numero_nf: '' }); setExtras({ fornecedor_id: '', valor_total: '', data_emissao: '', status: 'Não Vinculada' }); setErrors({}); };
  const openEdit = (item: any) => { setEditItem(item); setForm({ numero_nf: item.numero_nf ?? '' }); setExtras({ fornecedor_id: item.fornecedor_id ?? '', valor_total: String(item.valor_total ?? ''), data_emissao: item.data_emissao ?? '', status: item.status ?? 'Não Vinculada' }); setErrors({}); setShowForm(false); };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true); showToast("Salvando...", 'info', false);
    try {
      const payload = { ...form, ...extras, valor_total: Number(extras.valor_total) || 0 };
      if (editItem) {
        const u = await dbUpdate('/api/notasrecebidasview', editItem.id, payload);
        setData((p: any[]) => p.map(d => d.id === editItem.id ? (u ?? { ...d, ...payload }) : d));
        showToast("Nota atualizada!", 'success', true);
      } else {
        const s = await dbInsert('/api/notasrecebidasview', payload);
        setData([s ?? { id: Date.now(), ...payload }, ...data]);
        showToast("Nota adicionada!", 'success', true);
      }
      closeForm();
    } catch { showToast("Erro ao salvar.", 'error', true); } finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir?')) return;
    try { await dbDelete('/api/notasrecebidasview', id); setData((p: any[]) => p.filter(d => d.id !== id)); showToast("Excluído.", 'success', true); }
    catch { showToast("Erro.", 'error', true); }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex justify-between items-center shrink-0">
        <div><h2 className="text-3xl font-bold text-gray-100 tracking-tight">Notas Recebidas</h2><p className="text-sm text-gray-400 mt-1">Gerencie as notas fiscais recebidas de fornecedores.</p></div>
        <div className="flex gap-4 items-center">
          <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-56" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova NF</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar NF' : 'Nova NF'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Número NF *" error={errors.numero_nf}><input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.numero_nf ? 'border border-red-500/40' : ''}`} value={form.numero_nf} onChange={e => { setForm(f => ({ ...f, numero_nf: e.target.value })); clearError('numero_nf'); }} placeholder="Ex: NF-001234" /></FormField>
                <FormField label="Fornecedor"><select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.fornecedor_id} onChange={e => setExtras(x => ({ ...x, fornecedor_id: e.target.value }))}><option value="">Nenhum</option>{fornecedores.map((f: any) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></FormField>
                <FormField label="Valor Total (R$)"><input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.valor_total} onChange={e => setExtras(x => ({ ...x, valor_total: e.target.value }))} placeholder="0,00" /></FormField>
                <FormField label="Data Emissão"><input type="date" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.data_emissao} onChange={e => setExtras(x => ({ ...x, data_emissao: e.target.value }))} /></FormField>
                <FormField label="Status"><select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.status} onChange={e => setExtras(x => ({ ...x, status: e.target.value }))}>{['Não Vinculada', 'Vinculada', 'Cancelada'].map(s => <option key={s} value={s}>{s}</option>)}</select></FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Número NF</th><th className="pb-4 font-bold px-4">Fornecedor</th><th className="pb-4 font-bold px-4 text-right">Valor</th><th className="pb-4 font-bold px-4">Emissão</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.numero_nf}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.forn?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(item.valor_total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data_emissao || '—'}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right"><div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button><button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400"><Trash2 size={12} /></button></div></td>
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
