import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, FileDown, Sheet } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation, exportToPDF, exportToExcel } from '../lib/viewUtils';

export const ProdutosView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/produtosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ codigo: '', nome: '', preco: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const filtered = data.filter((item: any) =>
    [item.codigo, item.nome, item.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const exportCols = ['Código', 'Nome', 'Estoque', 'Preço', 'Status'];
  const exportRows = () => filtered.map((d: any) => [d.codigo ?? '', d.nome ?? '', String(d.estoque ?? 0), d.preco ?? '', d.status ?? '']);
  const handleExportPDF = () => exportToPDF('Catálogo de Produtos', exportCols, exportRows(), 'logmax-produtos');
  const handleExportExcel = () => exportToExcel('Produtos', exportCols, exportRows(), 'logmax-produtos');

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ codigo: item.codigo ?? '', nome: item.nome ?? '', preco: item.preco ?? '' });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ codigo: '', nome: '', preco: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast(editItem ? "Atualizando produto..." : "Salvando produto...", 'info', false);
    try {
      if (editItem) {
        const updated = await dbUpdate('/api/produtosview', editItem.id, form);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...form }) : d));
        showToast("Produto atualizado!", 'success', true);
      } else {
        const saved = await dbInsert('/api/produtosview', { ...form, estoque: 0, status: 'Ativo' });
        setData([saved ?? { id: Date.now(), ...form, estoque: 0, status: 'Ativo' }, ...data]);
        showToast("Produto criado com sucesso!", 'success', true);
      }
      closeForm();
    } catch {
      showToast("Erro ao salvar.", 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este produto?')) return;
    try {
      await dbDelete('/api/produtosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Produto excluído.", 'success', true);
    } catch {
      showToast("Erro ao excluir.", 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Catálogo de Produtos</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie o portfólio de itens do estoque e suas informações.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          {data.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={handleExportPDF} icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Produto' : 'Novo Produto'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Código *" error={errors.codigo}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.codigo ? 'border border-red-500/40' : ''}`} value={form.codigo} onChange={e => { setForm(f => ({ ...f, codigo: e.target.value })); clearError('codigo'); }} placeholder="Ex: PRD-001" />
                </FormField>
                <FormField label="Nome do produto *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`} value={form.nome} onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }} placeholder="Ex: Parafuso M6" />
                </FormField>
                <FormField label="Preço unitário *" error={errors.preco}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.preco ? 'border border-red-500/40' : ''}`} value={form.preco} onChange={e => { setForm(f => ({ ...f, preco: e.target.value })); clearError('preco'); }} placeholder="Ex: R$ 12,50" />
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

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Código</th>
                <th className="pb-4 font-bold px-4">Nome</th>
                <th className="pb-4 font-bold px-4 text-right">Estoque</th>
                <th className="pb-4 font-bold px-4 text-right">Preço</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filtered.map((item: any) => (
                  <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                    <td className="py-4 px-4 text-xs font-mono text-gray-400">{item.codigo}</td>
                    <td className="py-4 px-4 text-sm font-semibold text-gray-200">{item.nome}</td>
                    <td className="py-4 px-4 text-xs text-gray-400 text-right">{item.estoque}</td>
                    <td className="py-4 px-4 text-xs font-mono text-gray-200 text-right">{item.preco}</td>
                    <td className="py-4 px-4 text-center"><StatusBadge status={item.status} /></td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                        <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
};
