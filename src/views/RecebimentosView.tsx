import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, CheckCircle2, ChevronDown, Trash2 } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

export const RecebimentosView = ({ showToast }: any) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/recebimentosview', undefined, false,
    { page, searchTerm: debouncedSearch, searchColumns: ['status', 'observacao'] }
  );
  // pedidos/produtos: sem paginação — usados em dropdowns globais (todos os ativos).
  const { data: pedidos } = useFetchData<any>('/api/pedidosview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ pedido_id: '' });
  const [extras, setExtras] = useState({ qtd_recebida: '', observacao: '', produto_id: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [confirmProduto, setConfirmProduto] = useState('');
  const [confirmStatus, setConfirmStatus] = useState('Concluído');
  const [confirmSaving, setConfirmSaving] = useState(false);

  const pedidosAtivos = pedidos.filter((p: any) => !['Cancelado', 'Recebido'].includes(p.status));
  // Search agora é server-side; o enriched é só para juntar dados do pedido.
  const enriched = data.map((r: any) => ({ ...r, ped: pedidos.find((p: any) => p.id === r.pedido_id) }));

  const closeForm = () => { setShowForm(false); setForm({ pedido_id: '' }); setExtras({ qtd_recebida: '', observacao: '', produto_id: '' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const qtd = Number(extras.qtd_recebida) || 0;
      if (qtd <= 0) { showToast('Informe uma quantidade válida.', 'error', true); return; }
      const payload = { pedido_id: form.pedido_id, qtd_recebida: qtd, observacao: extras.observacao, status: 'Pendente', data: today };
      const s = await dbInsert('/api/recebimentosview', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      showToast("Recebimento registrado! Use o botão Confirmar para atualizar o estoque.", 'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Inativar este recebimento? Ele sairá da lista mas o histórico fica preservado.')) return;
    try {
      await dbDelete('/api/recebimentosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Recebimento inativado.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Recebimentos] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  const handleConfirmar = async (item: any) => {
    if (!confirmProduto) { showToast('Selecione o produto recebido.', 'error', true); return; }
    if (!(Number(item.qtd_recebida) > 0)) { showToast('Quantidade inválida no recebimento.', 'error', true); return; }
    setConfirmSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      // Movimentação PRIMEIRO — se falhar, status fica Pendente e o botão "Confirmar" reaparesce para retry.
      // Só atualiza o status após a movimentação estar salva no banco.
      if (confirmStatus === 'Concluído' || confirmStatus === 'Parcial') {
        await dbInsert('/api/movimentacoesestoqueview', {
          produto_id: confirmProduto,
          tipo: 'Entrada',
          qtd: Number(item.qtd_recebida) || 0,
          origem: `Pedido #${String(item.pedido_id ?? '').slice(0, 8).toUpperCase()}`,
          destino: 'Almoxarifado',
          data: today,
        });
      }
      await dbUpdate('/api/recebimentosview', item.id, { status: confirmStatus });
      setData((prev: any[]) => prev.map(r => r.id === item.id ? { ...r, status: confirmStatus } : r));

      // Sincronia: recebimento "Concluído" fecha o pedido relacionado.
      // "Parcial" deixa o pedido em "Em Entrega" para permitir entregas adicionais.
      if (confirmStatus === 'Concluído' && item.pedido_id) {
        const ped = pedidos.find((p: any) => p.id === item.pedido_id);
        if (ped && ped.status !== 'Recebido' && ped.status !== 'Cancelado') {
          try { await dbUpdate('/api/pedidosview', item.pedido_id, { status: 'Recebido' }); }
          catch { /* não bloqueia o fluxo — relatórios mostrarão divergência */ }
        }
      }

      setConfirmando(null);
      setConfirmProduto('');
      setConfirmStatus('Concluído');
      showToast(
        confirmStatus === 'Concluído'
          ? 'Recebimento confirmado, estoque atualizado e pedido encerrado!'
          : 'Recebimento parcial confirmado e estoque atualizado.',
        'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setConfirmSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div><h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Recebimentos</h2><p className="text-sm text-gray-400 mt-1">Registre o recebimento de mercadorias dos pedidos.</p></div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Registrar</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Novo Recebimento</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Pedido *" error={errors.pedido_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.pedido_id ? 'border border-red-500/40' : ''}`} value={form.pedido_id} onChange={e => { setForm(f => ({ ...f, pedido_id: e.target.value })); clearError('pedido_id'); }}><option value="">Selecione...</option>{pedidosAtivos.map((p: any) => <option key={p.id} value={p.id}>Pedido #{p.id.slice(0, 8)} — {p.status}</option>)}</select></FormField>
                <FormField label="Produto recebido">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.produto_id} onChange={e => setExtras(x => ({ ...x, produto_id: e.target.value }))}>
                    <option value="">Selecionar para atualizar estoque...</option>
                    {produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome} (saldo atual: {p.estoque ?? 0})</option>)}
                  </select>
                </FormField>
                <FormField label="Qtd Recebida"><input type="number" min="1" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_recebida} onChange={e => setExtras(x => ({ ...x, qtd_recebida: e.target.value }))} placeholder="0" /></FormField>
                <FormField label="Observação"><input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.observacao} onChange={e => setExtras(x => ({ ...x, observacao: e.target.value }))} placeholder="Opcional..." /></FormField>
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
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4">Pedido</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Observação</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>) : enriched.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {enriched.map((item: any) => (
                    <React.Fragment key={item.id}>
                      <motion.tr initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-300">#{String(item.pedido_id ?? '').slice(0, 8)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd_recebida ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.observacao || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {item.status === 'Pendente' && (
                              <button
                                onClick={() => { setConfirmando(confirmando === item.id ? null : item.id); setConfirmProduto(''); setConfirmStatus('Concluído'); }}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"
                              >
                                <CheckCircle2 size={11} /> Confirmar <ChevronDown size={10} className={`transition-transform ${confirmando === item.id ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                            <button onClick={() => handleDelete(item.id)} title="Excluir" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
                      <AnimatePresence>
                        {confirmando === item.id && (
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <td colSpan={6} className="pb-3 px-4">
                              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 p-4 rounded-2xl" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.12)' }}>
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
                                  <label htmlFor={`receb-produto-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Produto recebido *</label>
                                  <select id={`receb-produto-${item.id}`} className="neu-input py-2 px-3 rounded-xl text-xs w-full" value={confirmProduto} onChange={e => setConfirmProduto(e.target.value)}>
                                    <option value="">Selecione o produto...</option>
                                    {produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome} (saldo: {p.estoque ?? 0})</option>)}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label htmlFor={`receb-status-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Status final</label>
                                  <select id={`receb-status-${item.id}`} className="neu-input py-2 px-3 rounded-xl text-xs w-full" value={confirmStatus} onChange={e => setConfirmStatus(e.target.value)}>
                                    {['Concluído', 'Parcial'].map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                                <div className="flex gap-2 sm:contents">
                                  <button onClick={() => handleConfirmar(item)} disabled={confirmSaving}
                                    className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none">
                                    {confirmSaving ? 'Salvando...' : <><Save size={12} /> Confirmar e atualizar estoque</>}
                                  </button>
                                  <button onClick={() => setConfirmando(null)} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center justify-center">Cancelar</button>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalCount={totalCount}
          isLoading={isLoading}
          onPrev={() => setPage(p => Math.max(0, p - 1))}
          onNext={() => setPage(p => p + 1)}
          onReload={reload}
        />
      </div>
    </motion.div>
  );
};
