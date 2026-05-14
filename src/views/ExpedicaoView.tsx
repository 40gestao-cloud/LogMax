import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const ExpedicaoView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/expedicao');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesestoqueview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ produto_id: '' });
  const [extras, setExtras] = useState({ requisicao_id: '', qtd_expedida: '', data_expedicao: '', status: 'Pendente' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const enriched = data.map((e: any) => ({ ...e, prod: produtos.find((p: any) => p.id === e.produto_id) }));
  const filtered = enriched.filter((e: any) => [e.prod?.nome, e.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())));

  const closeForm = () => { setShowForm(false); setForm({ produto_id: '' }); setExtras({ requisicao_id: '', qtd_expedida: '', data_expedicao: '', status: 'Pendente' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true); showToast("Salvando...", 'info', false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const qtd = Number(extras.qtd_expedida) || 0;
      const payload = { ...form, requisicao_id: extras.requisicao_id || null, qtd_expedida: qtd, data_expedicao: extras.data_expedicao || today, status: extras.status };
      const s = await dbInsert('/api/expedicao', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      // Baixa de estoque: só ocorre quando o status é 'Expedido' e há quantidade
      if (extras.status === 'Expedido' && qtd > 0) {
        const prod = produtos.find((p: any) => p.id === form.produto_id);
        await dbInsert('/api/movimentacoesestoqueview', {
          produto_id: form.produto_id,
          tipo: 'Saída',
          qtd,
          origem: 'Expedição',
          destino: extras.requisicao_id
            ? requisicoes.find((r: any) => r.id === extras.requisicao_id)?.destino || 'Expedido'
            : 'Expedido',
          data: today,
        });
        showToast("Expedição registrada e estoque baixado!", 'success', true);
      } else {
        showToast("Expedição registrada!", 'success', true);
      }
      closeForm();
    } catch { showToast("Erro.", 'error', true); } finally { setIsSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex justify-between items-center shrink-0">
        <div><h2 className="text-3xl font-bold text-gray-100 tracking-tight">Expedição</h2><p className="text-sm text-gray-400 mt-1">Gerencie a saída e expedição de produtos do estoque.</p></div>
        <div className="flex gap-4 items-center">
          <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-56" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova Expedição</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Expedição</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Produto *" error={errors.produto_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`} value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}><option value="">Selecione...</option>{produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></FormField>
                <FormField label="Requisição (opcional)"><select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.requisicao_id} onChange={e => setExtras(x => ({ ...x, requisicao_id: e.target.value }))}><option value="">Nenhuma</option>{requisicoes.filter((r: any) => r.status === 'Aprovada').map((r: any) => <option key={r.id} value={r.id}>{r.solicitante} — {r.destino}</option>)}</select></FormField>
                <FormField label="Qtd Expedida"><input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_expedida} onChange={e => setExtras(x => ({ ...x, qtd_expedida: e.target.value }))} placeholder="0" /></FormField>
                <FormField label="Data Expedição"><input type="date" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.data_expedicao} onChange={e => setExtras(x => ({ ...x, data_expedicao: e.target.value }))} /></FormField>
                <FormField label="Status"><select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.status} onChange={e => setExtras(x => ({ ...x, status: e.target.value }))}>{['Pendente', 'Expedido', 'Cancelado'].map(s => <option key={s} value={s}>{s}</option>)}</select></FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Registrar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4 text-center">Status</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={4}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={4}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd_expedida ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data_expedicao || '—'}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
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
