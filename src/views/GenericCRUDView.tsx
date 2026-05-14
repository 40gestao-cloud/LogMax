import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { GField } from '../lib/viewUtils';

export const GenericCRUDView = ({ title, subtitle, endpoint, fields, defaultStatus = 'Ativo', showToast }: {
  title: string; subtitle: string; endpoint: string; fields: GField[]; defaultStatus?: string; showToast: any;
}) => {
  const { data, setData, isLoading } = useFetchData<any>(endpoint);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const emptyState = () => Object.fromEntries(fields.map(f => [f.key, ''])) as Record<string, string>;
  const [formState, setFormState] = useState<Record<string, string>>(emptyState());
  const [valErrors, setValErrors] = useState<Record<string, string>>({});

  const filtered = data.filter((item: any) =>
    fields.some(f => String(item[f.key] ?? '').toLowerCase().includes(search.toLowerCase()))
  );

  const validateForm = () => {
    const e: Record<string, string> = {};
    fields.filter(f => f.required).forEach(f => { if (!formState[f.key]?.trim()) e[f.key] = 'Obrigatório'; });
    setValErrors(e);
    return Object.keys(e).length === 0;
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setFormState(Object.fromEntries(fields.map(f => [f.key, String(item[f.key] ?? '')])));
    setValErrors({});
    setShowForm(false);
  };

  const closeForm = () => { setShowForm(false); setEditItem(null); setFormState(emptyState()); setValErrors({}); };

  const handleSave = async () => {
    if (!validateForm()) return;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      const payload = editItem ? formState : { ...formState, status: formState.status || defaultStatus };
      if (editItem) {
        const updated = await dbUpdate(endpoint, editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast("Registro atualizado!", 'success', true);
      } else {
        const saved = await dbInsert(endpoint, payload);
        setData([saved ?? { id: Date.now(), ...payload }, ...data]);
        showToast("Registro criado!", 'success', true);
      }
      closeForm();
    } catch { showToast("Erro ao salvar.", 'error', true); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este registro?')) return;
    try {
      await dbDelete(endpoint, id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Excluído.", 'success', true);
    } catch { showToast("Erro ao excluir.", 'error', true); }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold text-gray-100 tracking-tight">{title}</h2>
          <p className="text-sm text-gray-400 mt-1">{subtitle}</p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar' : 'Novo'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {fields.map(f => (
                  <React.Fragment key={f.key}>
                    <FormField label={`${f.label}${f.required ? ' *' : ''}`} error={valErrors[f.key]}>
                      {f.type === 'select' ? (
                        <select className={`neu-input py-2 px-3 rounded-xl text-sm ${valErrors[f.key] ? 'border border-red-500/40' : ''}`}
                          value={formState[f.key]} onChange={e => { setFormState(s => ({ ...s, [f.key]: e.target.value })); setValErrors(ev => { const n = { ...ev }; delete n[f.key]; return n; }); }}>
                          <option value="">Selecione...</option>
                          {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={f.type ?? 'text'} className={`neu-input py-2 px-3 rounded-xl text-sm ${valErrors[f.key] ? 'border border-red-500/40' : ''}`}
                          value={formState[f.key]} onChange={e => { setFormState(s => ({ ...s, [f.key]: e.target.value })); setValErrors(ev => { const n = { ...ev }; delete n[f.key]; return n; }); }}
                          placeholder={f.placeholder} />
                      )}
                    </FormField>
                  </React.Fragment>
                ))}
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
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                {fields.map(f => <th key={f.key} className="pb-4 font-bold px-4">{f.label}</th>)}
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={fields.length + 1}><LoadingSpinner /></td></tr>)
                : filtered.length === 0 ? (<tr><td colSpan={fields.length + 1}><EmptyState /></td></tr>)
                : (
                  <AnimatePresence>
                    {filtered.map((item: any) => (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        {fields.map((f, idx) => (
                          <td key={f.key} className={`py-4 px-4 ${idx === 0 ? 'text-sm font-semibold text-gray-200' : 'text-xs text-gray-400'}`}>
                            {f.key === 'status' ? <StatusBadge status={item[f.key]} /> : String(item[f.key] ?? '—')}
                          </td>
                        ))}
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                            <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
                          </div>
                        </td>
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
