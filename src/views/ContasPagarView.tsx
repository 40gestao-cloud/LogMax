import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Check } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const ContasPagarView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/contaspagarview');
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ descricao: '' });
  const [extras, setExtras] = useState({ valor: '', vencimento: '', fornecedor_id: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const filtered = data.filter((c: any) =>
    [c.descricao, c.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const enriched = filtered.map((c: any) => ({
    ...c,
    forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
  }));

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ descricao: item.descricao ?? '' });
    setExtras({ valor: String(item.valor ?? ''), vencimento: item.vencimento ?? '', fornecedor_id: item.fornecedor_id ?? '' });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ descricao: '' });
    setExtras({ valor: '', vencimento: '', fornecedor_id: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    const payload = {
      descricao: form.descricao,
      valor: parseFloat(extras.valor.replace(',', '.')) || 0,
      vencimento: extras.vencimento || null,
      fornecedor_id: extras.fornecedor_id || null,
    };
    try {
      if (editItem) {
        const updated = await dbUpdate('/api/contaspagarview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Conta atualizada!', 'success', true);
      } else {
        const saved = await dbInsert('/api/contaspagarview', { ...payload, status: 'Pendente' });
        setData((prev: any[]) => [saved ?? { id: Date.now(), ...payload, status: 'Pendente' }, ...prev]);
        showToast('Conta a Pagar criada!', 'success', true);
      }
      closeForm();
    } catch {
      showToast('Erro ao salvar.', 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePagar = async (id: string) => {
    try {
      const updated = await dbUpdate('/api/contaspagarview', id, { status: 'Pago' });
      setData((prev: any[]) => prev.map(d => d.id === id ? (updated ?? { ...d, status: 'Pago' }) : d));
      showToast('Pagamento registrado!', 'success', true);
    } catch {
      showToast('Erro ao registrar pagamento.', 'error', true);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta conta?')) return;
    try {
      await dbDelete('/api/contaspagarview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Conta excluída.', 'success', true);
    } catch {
      showToast('Erro ao excluir.', 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;
  const totalPendente = data.filter((c: any) => c.status === 'Pendente').reduce((sum: number, c: any) => sum + Number(c.valor ?? 0), 0);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Contas a Pagar</h2>
          <p className="text-sm text-gray-400 mt-1">
            Total pendente: <span className="text-accent font-bold">R$ {totalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar conta..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Conta' : 'Nova Conta a Pagar'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <FormField label="Descrição *" error={errors.descricao}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.descricao ? 'border border-red-500/40' : ''}`}
                    value={form.descricao} onChange={e => { setForm(f => ({ ...f, descricao: e.target.value })); clearError('descricao'); }}
                    placeholder="Ex: Fornecimento de material" />
                </FormField>
                <FormField label="Valor (R$)">
                  <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.valor} onChange={e => setExtras(x => ({ ...x, valor: e.target.value }))} placeholder="0,00" />
                </FormField>
                <FormField label="Vencimento">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.vencimento} onChange={e => setExtras(x => ({ ...x, vencimento: e.target.value }))} />
                </FormField>
                <FormField label="Fornecedor">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.fornecedor_id} onChange={e => setExtras(x => ({ ...x, fornecedor_id: e.target.value }))}>
                    <option value="">Nenhum</option>
                    {fornecedores.map((f: any) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
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

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? <EmptyState message="Nenhuma conta a pagar" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor</th>
                  <th className="pb-4 font-bold px-4">Vencimento</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.descricao}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.forn?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(item.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 font-mono">{item.vencimento || '—'}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {item.status === 'Pendente' && (
                            <button onClick={() => handlePagar(item.id)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"><Check size={11} /> Pagar</button>
                          )}
                          {item.status !== 'Pago' && (
                            <>
                              <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                              <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
                            </>
                          )}
                        </div>
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
