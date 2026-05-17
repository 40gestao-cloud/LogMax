import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const RequisicoesEstoqueView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/requisicoesestoqueview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ produto_id: '', solicitante: '' });
  const [extras, setExtras] = useState({ qtd: '1', destino: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const enriched = data.map((r: any) => ({ ...r, prod: produtos.find((p: any) => p.id === r.produto_id) }));
  const filtered = enriched.filter((r: any) =>
    [r.solicitante, r.status, r.destino, r.prod?.nome].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const closeForm = () => { setShowForm(false); setEditItem(null); setForm({ produto_id: '', solicitante: '' }); setExtras({ qtd: '1', destino: '' }); setErrors({}); };
  const openEdit = (item: any) => { setEditItem(item); setForm({ produto_id: item.produto_id ?? '', solicitante: item.solicitante ?? '' }); setExtras({ qtd: String(item.qtd ?? 1), destino: item.destino ?? '' }); setErrors({}); setShowForm(false); };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      if (editItem) {
        const payload = { ...form, qtd: Number(extras.qtd) || 1, destino: extras.destino };
        const updated = await dbUpdate('/api/requisicoesestoqueview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast("Requisição atualizada!", 'success', true);
      } else {
        const saved = await dbInsert('/api/requisicoesestoqueview', { ...form, qtd: Number(extras.qtd) || 1, destino: extras.destino, status: 'Pendente' });
        if (saved) await dbInsert('/api/minhasaprovacoesestoqueview', { requisicao_estoque_id: (saved as any).id, status: 'Pendente' });
        setData([saved ?? { id: Date.now(), ...form, status: 'Pendente' }, ...data]);
        showToast("Requisição criada!", 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[RequisicoesEstoque] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta requisição?')) return;
    try {
      await dbDelete('/api/requisicoesestoqueview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Excluído.", 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[RequisicoesEstoque] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div><h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições de Estoque</h2><p className="text-sm text-gray-400 mt-1">Solicitações de retirada e movimentação de produtos.</p></div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova Requisição</NeuButtonAccent>
        </div>
      </div>
      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Requisição' : 'Nova Requisição'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Produto *" error={errors.produto_id}>
                  <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`} value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}>
                    <option value="">Selecione...</option>
                    {produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </FormField>
                <FormField label="Solicitante *" error={errors.solicitante}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.solicitante ? 'border border-red-500/40' : ''}`} value={form.solicitante} onChange={e => { setForm(f => ({ ...f, solicitante: e.target.value })); clearError('solicitante'); }} placeholder="Ex: João Silva" />
                </FormField>
                <FormField label="Quantidade">
                  <input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd} onChange={e => setExtras(x => ({ ...x, qtd: e.target.value }))} placeholder="1" />
                </FormField>
                <FormField label="Destino">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.destino} onChange={e => setExtras(x => ({ ...x, destino: e.target.value }))} placeholder="Ex: Setor de Produção" />
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
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Destino</th><th className="pb-4 font-bold px-4">Solicitante</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.destino || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.solicitante}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {item.status === 'Pendente' && (
                            <button onClick={() => openEdit(item)} title="Editar" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                          )}
                          <button onClick={() => handleDelete(item.id)} title="Excluir" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
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
