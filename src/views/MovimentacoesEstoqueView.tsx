import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const MovimentacoesEstoqueView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/movimentacoesestoqueview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ produto_id: '', tipo: '' });
  const [extras, setExtras] = useState({ qtd: '', origem: '', destino: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  const [search, setSearch] = useState('');

  const enriched = data.map((m: any) => ({ ...m, prod: produtos.find((p: any) => p.id === m.produto_id) }));
  const filtered = enriched.filter((m: any) =>
    [m.tipo, m.prod?.nome, m.origem, m.destino].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const closeForm = () => { setShowForm(false); setForm({ produto_id: '', tipo: '' }); setExtras({ qtd: '', origem: '', destino: '' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    const qtd = Number(extras.qtd) || 0;
    if (qtd <= 0) { showToast('Informe uma quantidade > 0.', 'error', true); return; }

    // Bloqueia saída que tornaria o saldo negativo (#9).
    if (form.tipo === 'Saída') {
      const prod = produtos.find((p: any) => p.id === form.produto_id);
      const saldo = Number(prod?.estoque ?? 0);
      if (qtd > saldo) {
        showToast(`Saldo insuficiente: estoque atual ${saldo} un. (saída solicitada: ${qtd}).`, 'error', true);
        return;
      }
    }

    setIsSaving(true);
    showToast("Registrando...", 'info', false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const payload = { ...form, qtd, origem: extras.origem, destino: extras.destino, data: today };
      const saved = await dbInsert('/api/movimentacoesestoqueview', payload);
      setData([saved ?? { id: Date.now(), ...payload }, ...data]);
      showToast("Movimentação registrada!", 'success', true);
      closeForm();
    } catch { showToast("Erro ao registrar.", 'error', true); }
    finally { setIsSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Movimentações de Estoque</h2>
          <p className="text-sm text-gray-400 mt-1">Entradas, saídas e ajustes de estoque.</p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova Movimentação</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Movimentação</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Produto *" error={errors.produto_id}>
                  <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`}
                    value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}>
                    <option value="">Selecione...</option>
                    {produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </FormField>
                <FormField label="Tipo *" error={errors.tipo}>
                  <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.tipo ? 'border border-red-500/40' : ''}`}
                    value={form.tipo} onChange={e => { setForm(f => ({ ...f, tipo: e.target.value })); clearError('tipo'); }}>
                    <option value="">Selecione...</option>
                    {['Entrada', 'Saída', 'Ajuste'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FormField>
                <FormField label="Quantidade">
                  <input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd}
                    onChange={e => setExtras(x => ({ ...x, qtd: e.target.value }))} placeholder="0" />
                </FormField>
                <FormField label="Origem">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.origem}
                    onChange={e => setExtras(x => ({ ...x, origem: e.target.value }))} placeholder="Ex: Fornecedor XYZ" />
                </FormField>
                <FormField label="Destino">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.destino}
                    onChange={e => setExtras(x => ({ ...x, destino: e.target.value }))} placeholder="Ex: Almoxarifado A" />
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Registrar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse min-w-[540px]">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Data</th>
                <th className="pb-4 font-bold px-4">Produto</th>
                <th className="pb-4 font-bold px-4">Tipo</th>
                <th className="pb-4 font-bold px-4 text-right">Qtd</th>
                <th className="pb-4 font-bold px-4">Origem</th>
                <th className="pb-4 font-bold px-4">Destino</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>)
                : filtered.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>)
                : (
                  <AnimatePresence>
                    {filtered.map((item: any) => (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${item.tipo === 'Entrada' ? 'bg-green-900/30 text-green-400' : item.tipo === 'Saída' ? 'bg-red-950/50 text-red-500' : 'bg-blue-900/30 text-blue-400'}`}>{item.tipo}</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.origem || '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.destino || '—'}</td>
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
