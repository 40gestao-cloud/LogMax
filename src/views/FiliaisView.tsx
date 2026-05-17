import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, MapPin, Building2, Plus, Save, FileDown, Sheet, Phone, User } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation, exportToPDF, exportToExcel, formatCNPJ, formatPhone } from '../lib/viewUtils';

// ✅ FiliaisView com validação de formulário + exportação
export const FiliaisView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/filiaisview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ nome: '', cnpj: '', cidade: '' });
  const [extras, setExtras] = useState({ celular: '', endereco: '', representante: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const filtered = data.filter((item: any) =>
    [item.nome, item.cnpj, item.cidade, item.celular, item.endereco, item.representante]
      .some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const exportCols = ['Nome', 'CNPJ', 'Cidade/UF', 'Celular', 'Representante', 'Status'];
  const exportRows = () => filtered.map((d: any) => [d.nome ?? '', d.cnpj ?? '', d.cidade ?? '', d.celular ?? '', d.representante ?? '', d.status ?? '']);
  const handleExportPDF = () => exportToPDF('Gestão de Filiais', exportCols, exportRows(), 'logmax-filiais');
  const handleExportExcel = () => exportToExcel('Filiais', exportCols, exportRows(), 'logmax-filiais');

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ nome: item.nome ?? '', cnpj: item.cnpj ?? '', cidade: item.cidade ?? '' });
    setExtras({ celular: item.celular ?? '', endereco: item.endereco ?? '', representante: item.representante ?? '' });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ nome: '', cnpj: '', cidade: '' });
    setExtras({ celular: '', endereco: '', representante: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast(editItem ? "Atualizando filial..." : "Salvando filial...", 'info', false);
    try {
      const payload = { ...form, ...extras };
      if (editItem) {
        const updated = await dbUpdate('/api/filiaisview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast("Filial atualizada!", 'success', true);
      } else {
        const saved = await dbInsert('/api/filiaisview', { ...payload, status: 'Ativa' });
        setData([saved ?? { id: Date.now(), ...payload, status: 'Ativa' }, ...data]);
        showToast("Filial criada com sucesso!", 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Filiais] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta filial? Esta ação não pode ser desfeita.')) return;
    try {
      await dbDelete('/api/filiaisview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Filial excluída.", 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Filiais] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gestão de Filiais</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie os locais e unidades físicas da empresa.</p>
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
            <input type="text" placeholder="Buscar filial..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
            <Plus size={16} /> Novo
          </NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Filial' : 'Nova Filial'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Nome da filial *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`} value={form.nome} onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }} placeholder="Ex: Filial Sul" />
                </FormField>
                <FormField label="CNPJ *" error={errors.cnpj}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm font-mono ${errors.cnpj ? 'border border-red-500/40' : ''}`} value={form.cnpj} onChange={e => { setForm(f => ({ ...f, cnpj: formatCNPJ(e.target.value) })); clearError('cnpj'); }} placeholder="00.000.000/0000-00" inputMode="numeric" />
                </FormField>
                <FormField label="Cidade/UF *" error={errors.cidade}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.cidade ? 'border border-red-500/40' : ''}`} value={form.cidade} onChange={e => { setForm(f => ({ ...f, cidade: e.target.value })); clearError('cidade'); }} placeholder="Ex: São Paulo/SP" />
                </FormField>
                <FormField label="Celular">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.celular} onChange={e => setExtras(x => ({ ...x, celular: formatPhone(e.target.value) }))} placeholder="(11) 99999-9999" inputMode="numeric" />
                </FormField>
                <FormField label="Endereço">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.endereco} onChange={e => setExtras(x => ({ ...x, endereco: e.target.value }))} placeholder="Rua, número, bairro" />
                </FormField>
                <FormField label="Representante">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.representante} onChange={e => setExtras(x => ({ ...x, representante: e.target.value }))} placeholder="Ex: João Silva" />
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                  <Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}
                </NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto main-scrollbar pb-6 pr-2">
          {filtered.map((item: any, i: number) => (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }} key={item.id} className="neu-flat p-6 rounded-2xl flex flex-col border border-white/5 group gap-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 neu-circle flex items-center justify-center bg-accent/5 shrink-0"><Building2 size={18} className="text-accent" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-200 tracking-wide">{item.nome}</h3>
                    <span className="text-xs font-mono text-gray-500">{item.cnpj}</span>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest shrink-0 ${item.status === 'Ativa' ? 'bg-accent/10 text-accent' : 'bg-gray-800 text-gray-400'}`}>{item.status}</div>
              </div>

              <div className="neu-pressed p-3.5 rounded-xl flex flex-col gap-2 border border-white/5">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <MapPin size={11} className="text-gray-500 shrink-0" />
                  <span>{item.cidade}{item.endereco ? ` — ${item.endereco}` : ''}</span>
                </div>
                {item.celular && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Phone size={11} className="text-gray-500 shrink-0" />{item.celular}
                  </div>
                )}
                {item.representante && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <User size={11} className="text-gray-500 shrink-0" />{item.representante}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-auto">
                <button onClick={() => openEdit(item)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={11} /></button>
                <button onClick={() => handleDelete(item.id)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={11} /></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
