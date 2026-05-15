import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, UrgenciaBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const RequisicoesView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/requisicoesview', undefined, true);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ item: '', solicitante: '' });
  const [extras, setExtras] = useState({ qtd: '1', urgencia: 'Normal', centro_custo: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const today = new Date().toISOString().split('T')[0];

  const filtered = data.filter((r: any) =>
    [r.item, r.solicitante, r.status, r.urgencia, r.centro_custo].some((v: any) =>
      v?.toLowerCase().includes(search.toLowerCase())
    )
  );

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ item: item.item ?? '', solicitante: item.solicitante ?? '' });
    setExtras({ qtd: String(item.qtd ?? 1), urgencia: item.urgencia ?? 'Normal', centro_custo: item.centro_custo ?? '' });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ item: '', solicitante: '' });
    setExtras({ qtd: '1', urgencia: 'Normal', centro_custo: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast(editItem ? "Atualizando..." : "Criando requisição...", 'info', false);
    try {
      const payload = {
        item: form.item,
        solicitante: form.solicitante,
        qtd: parseInt(extras.qtd) || 1,
        urgencia: extras.urgencia,
        centro_custo: extras.centro_custo,
      };
      if (editItem) {
        const updated = await dbUpdate('/api/requisicoesview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast("Requisição atualizada!", 'success', true);
      } else {
        const saved = await dbInsert('/api/requisicoesview', { ...payload, status: 'Pendente', data: today });
        if (saved) {
          await dbInsert('/api/minhasaprovacoesview', { requisicao_id: (saved as any).id, status: 'Pendente' });
          setData((prev: any[]) => [saved, ...prev]);
        }
        showToast("Requisição criada e enviada para aprovação!", 'success', true);
      }
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta requisição?')) return;
    try {
      await dbDelete('/api/requisicoesview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Requisição excluída.", 'success', true);
    } catch {
      showToast("Erro ao excluir.", 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Requisições de Compra</h2>
          <p className="text-sm text-gray-400 mt-1">Solicite itens para compra. Requisições aprovadas seguem para cotação.</p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar requisição..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
            <Plus size={16} /> Nova
          </NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Requisição' : 'Nova Requisição'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Item solicitado *" error={errors.item}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.item ? 'border border-red-500/40' : ''}`}
                    value={form.item} onChange={e => { setForm(f => ({ ...f, item: e.target.value })); clearError('item'); }}
                    placeholder="Ex: Papel A4 resma 500fls" />
                </FormField>
                <FormField label="Solicitante *" error={errors.solicitante}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.solicitante ? 'border border-red-500/40' : ''}`}
                    value={form.solicitante} onChange={e => { setForm(f => ({ ...f, solicitante: e.target.value })); clearError('solicitante'); }}
                    placeholder="Nome do solicitante" />
                </FormField>
                <FormField label="Quantidade">
                  <input type="number" min="1" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.qtd} onChange={e => setExtras(x => ({ ...x, qtd: e.target.value }))} />
                </FormField>
                <FormField label="Urgência">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.urgencia} onChange={e => setExtras(x => ({ ...x, urgencia: e.target.value }))}>
                    <option>Normal</option>
                    <option>Alta</option>
                    <option>Urgente</option>
                  </select>
                </FormField>
                <FormField label="Centro de Custo">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.centro_custo} onChange={e => setExtras(x => ({ ...x, centro_custo: e.target.value }))}
                    placeholder="Ex: TI, Marketing" />
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                  <Save size={14} /> {editItem ? 'Atualizar' : 'Enviar para Aprovação'}
                </NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState message="Nenhuma requisição encontrada" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Item</th>
                  <th className="pb-4 font-bold px-4 text-center">Qtd</th>
                  <th className="pb-4 font-bold px-4 text-center">Urgência</th>
                  <th className="pb-4 font-bold px-4">Centro de Custo</th>
                  <th className="pb-4 font-bold px-4">Solicitante</th>
                  <th className="pb-4 font-bold px-4">Data</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200 max-w-[200px]"><span className="block truncate">{item.item}</span></td>
                      <td className="py-3 px-4 text-xs text-gray-400 text-center font-mono">{item.qtd}</td>
                      <td className="py-3 px-4 text-center"><UrgenciaBadge urgencia={item.urgencia ?? 'Normal'} /></td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.centro_custo || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.solicitante}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 font-mono">{item.data}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        {item.status === 'Pendente' && (
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                            <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
};
