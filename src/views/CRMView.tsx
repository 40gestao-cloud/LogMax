import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Mail, Phone as PhoneIcon, Building, Package, Plus, Save, FileDown, Sheet } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent } from '../components/ui';
import { useFormValidation, exportToPDF, exportToExcel } from '../lib/viewUtils';

// ✅ CRMView com validação de campos obrigatórios + exportação
export const CRMView = ({ type, showToast }: { type: 'clientes' | 'fornecedores'; showToast: any }) => {
  const isClientes = type === 'clientes';
  const endpoint = isClientes ? '/api/crmview' : '/api/crmview-fornecedores';
  const { data, setData, isLoading } = useFetchData<any>(endpoint);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ nome: '', tipo: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const filtered = data.filter((item: any) =>
    [item.nome, item.tipo, item.categoria, item.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const title = isClientes ? "Gestão de Clientes" : "Gestão de Fornecedores";
  const desc = isClientes ? "Visualize e gerencie a carteira de clientes ativos." : "Controle seus parceiros comerciais e rede de suprimentos.";

  const exportCols = isClientes ? ['Nome', 'Tipo', 'Última Compra', 'Status'] : ['Nome', 'Categoria', 'Status'];
  const exportRows = () => isClientes
    ? filtered.map((d: any) => [d.nome ?? '', d.tipo ?? '', d.ultimaCompra ?? '', d.status ?? ''])
    : filtered.map((d: any) => [d.nome ?? '', d.categoria ?? '', d.status ?? '']);
  const exportFilename = isClientes ? 'logmax-clientes' : 'logmax-fornecedores';
  const handleExportPDF = () => exportToPDF(title, exportCols, exportRows(), exportFilename);
  const handleExportExcel = () => exportToExcel(isClientes ? 'Clientes' : 'Fornecedores', exportCols, exportRows(), exportFilename);

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ nome: item.nome ?? '', tipo: isClientes ? (item.tipo ?? '') : (item.categoria ?? '') });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ nome: '', tipo: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      if (editItem) {
        const payload = isClientes ? { nome: form.nome, tipo: form.tipo } : { nome: form.nome, categoria: form.tipo };
        const updated = await dbUpdate(endpoint, editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast("Registro atualizado!", 'success', true);
      } else {
        const payload = isClientes
          ? { nome: form.nome, tipo: form.tipo, ultimaCompra: 'Hoje', status: 'Ativo' }
          : { nome: form.nome, categoria: form.tipo, status: 'Homologado' };
        const saved = await dbInsert(endpoint, payload);
        setData([saved ?? { id: Date.now(), ...payload }, ...data]);
        showToast("Registro criado com sucesso!", 'success', true);
      }
      closeForm();
    } catch {
      showToast("Erro ao salvar.", 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const label = isClientes ? 'cliente' : 'fornecedor';
    if (!confirm(`Excluir este ${label}?`)) return;
    try {
      await dbDelete(endpoint, id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Registro excluído.", 'success', true);
    } catch {
      showToast("Erro ao excluir.", 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">{title}</h2>
          <p className="text-sm text-gray-400 mt-1">{desc}</p>
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
            <input type="text" placeholder={`Buscar ${isClientes ? 'cliente' : 'fornecedor'}...`} className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? (isClientes ? 'Editar Cliente' : 'Editar Fornecedor') : (isClientes ? 'Novo Cliente' : 'Novo Fornecedor')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Nome *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`} value={form.nome} onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }} placeholder="Nome da empresa" />
                </FormField>
                <FormField label={isClientes ? 'Tipo *' : 'Categoria *'} error={errors.tipo}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.tipo ? 'border border-red-500/40' : ''}`} value={form.tipo} onChange={e => { setForm(f => ({ ...f, tipo: e.target.value })); clearError('tipo'); }} placeholder={isClientes ? 'Ex: B2B' : 'Ex: Materiais'} />
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto main-scrollbar pb-6 pr-2">
          {filtered.map((item: any, i: number) => (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }} key={item.id} className="neu-flat p-6 rounded-3xl flex flex-col border border-white/5 gap-4 group">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-sm font-bold text-gray-200 mb-2 tracking-wide">{item.nome}</h3>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] uppercase bg-[#111] px-2 py-0.5 rounded text-gray-400 tracking-widest neu-pressed">{isClientes ? item.tipo : item.categoria}</span>
                    <span className="w-1 h-1 rounded-full bg-accent"></span>
                    <span className="text-xs text-accent font-medium">{item.status}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                    <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
                  </div>
                  <div className="w-10 h-10 neu-circle flex items-center justify-center bg-accent/5 shrink-0">
                    {isClientes ? <Building size={16} className="text-accent" /> : <Package size={16} className="text-accent" />}
                  </div>
                </div>
              </div>
              <div className="neu-pressed p-4 rounded-2xl flex flex-col gap-3 mt-2 border border-white/5">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold border-b border-white/5 pb-2">Resumo Contato</span>
                <div className="flex items-center gap-3 text-xs text-gray-300"><Mail size={12} className="text-gray-500" />contato@{item.nome?.toLowerCase().replace(/ /g, '').replace(/\//g, '') ?? 'empresa'}.com</div>
                <div className="flex items-center gap-3 text-xs text-gray-300"><PhoneIcon size={12} className="text-gray-500" />(11) 99999-9999</div>
              </div>
              {isClientes && (
                <div className="text-[11px] text-gray-500 border-t border-white/5 pt-3 mt-auto flex justify-between">
                  <span>Última compra:</span><strong className="text-gray-200">{item.ultimaCompra}</strong>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
