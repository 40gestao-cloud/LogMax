import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, User, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent } from '../components/ui';
import { useFormValidation, formatPhone } from '../lib/viewUtils';

export const ColaboradoresView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/colaboradoresview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ matricula: '', nome: '' });
  const [extras, setExtras] = useState({ cargo: '', departamento: '', celular: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const filtered = data.filter((item: any) =>
    [item.nome, item.cargo, item.departamento, item.celular].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ matricula: item.matricula ?? '', nome: item.nome ?? '' });
    setExtras({ cargo: item.cargo ?? '', departamento: item.departamento ?? '', celular: item.celular ?? '' });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ matricula: '', nome: '' });
    setExtras({ cargo: '', departamento: '', celular: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      const payload = { ...form, ...extras };
      if (editItem) {
        const updated = await dbUpdate('/api/colaboradoresview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast("Colaborador atualizado!", 'success', true);
      } else {
        const saved = await dbInsert('/api/colaboradoresview', { ...payload, status: 'Ativo' });
        setData([saved ?? { id: Date.now(), ...payload, status: 'Ativo' }, ...data]);
        showToast("Colaborador adicionado!", 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Colaboradores] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este colaborador?')) return;
    try {
      await dbDelete('/api/colaboradoresview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Colaborador excluído.", 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Colaboradores] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gestão de Colaboradores</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie sua equipe, cargos e permissões de acesso.</p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar colaborador..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Colaborador' : 'Novo Colaborador'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Matrícula *" error={errors.matricula}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.matricula ? 'border border-red-500/40' : ''}`} value={form.matricula} onChange={e => { setForm(f => ({ ...f, matricula: e.target.value })); clearError('matricula'); }} placeholder="Ex: MAT-001" />
                </FormField>
                <FormField label="Nome *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`} value={form.nome} onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }} placeholder="Ex: João Silva" />
                </FormField>
                <FormField label="Celular">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.celular} onChange={e => setExtras(x => ({ ...x, celular: formatPhone(e.target.value) }))} placeholder="(11) 99999-9999" inputMode="numeric" />
                </FormField>
                <FormField label="Cargo">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.cargo} onChange={e => setExtras(x => ({ ...x, cargo: e.target.value }))} placeholder="Ex: Analista de Compras" />
                </FormField>
                <FormField label="Departamento">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.departamento} onChange={e => setExtras(x => ({ ...x, departamento: e.target.value }))} placeholder="Ex: Compras" />
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar pr-2 pb-2">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Matrícula</th>
                <th className="pb-4 font-bold px-4 w-1/4">Colaborador</th>
                <th className="pb-4 font-bold px-4">Cargo</th>
                <th className="pb-4 font-bold px-4">Departamento</th>
                <th className="pb-4 font-bold px-4">Celular</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>)
                : filtered.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>)
                : (
                  <AnimatePresence>
                    {filtered.map((item: any) => (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-4 px-4 text-xs font-mono text-gray-400">{item.matricula || '—'}</td>
                        <td className="py-4 px-4 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#111] neu-pressed flex items-center justify-center border border-accent/10"><User size={14} className="text-accent" /></div>
                          <span className="text-sm font-semibold text-gray-200">{item.nome}</span>
                        </td>
                        <td className="py-4 px-4 text-xs text-gray-400">{item.cargo}</td>
                        <td className="py-4 px-4 text-xs text-gray-400">
                          <span className="bg-[#111] px-2.5 py-1 rounded-md neu-pressed text-[10px] uppercase font-bold tracking-wider">{item.departamento || '—'}</span>
                        </td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-400">{item.celular || '—'}</td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                            <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
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
