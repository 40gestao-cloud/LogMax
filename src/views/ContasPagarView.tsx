import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Check, Landmark, X } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL } from '../lib/viewUtils';
import { supabase } from '../lib/supabase';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

export const ContasPagarView = ({ showToast }: any) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  // Realtime: pedidos aprovados / folhas processadas geram contas a pagar — actualiza-se sozinha (#21).
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/contaspagarview', undefined, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['descricao', 'status'] }
  );
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');
  const { data: bancos } = useFetchData<any>('/api/caixabancosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ descricao: '' });
  const [extras, setExtras] = useState({ valor: '', vencimento: '', fornecedor_id: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  // Diálogo inline de pagamento: pede o banco de débito antes de confirmar.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payBankId, setPayBankId] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  const bancosAtivos = bancos.filter((b: any) => b.status === 'Ativo' || !b.status);

  // Total agregado server-side: independente da página actualmente exibida.
  // Recalcula quando a lista local muda (paga/cria/elimina).
  const [totalPendente, setTotalPendente] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('contas_pagar').select('valor').eq('status', 'Pendente')
      .then(({ data: rows }) => {
        if (cancelled) return;
        setTotalPendente((rows ?? []).reduce((s: number, c: any) => s + Number(c.valor || 0), 0));
      });
    return () => { cancelled = true; };
  }, [data]);

  const enriched = data.map((c: any) => ({
    ...c,
    forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
  }));

  const filtered = enriched.filter((c: any) =>
    [c.descricao, c.status, c.forn?.nome].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ descricao: item.descricao ?? '' });
    setExtras({ valor: item.valor != null && item.valor !== '' ? formatBRL(Number(item.valor)) : '', vencimento: item.vencimento ?? '', fornecedor_id: item.fornecedor_id ?? '' });
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
      valor: parseBRL(extras.valor),
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
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[ContasPagar] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const openPay = (id: string) => {
    setPayingId(id);
    setPayBankId('');
  };

  const closePay = () => {
    setPayingId(null);
    setPayBankId('');
  };

  const handleConfirmarPagamento = async (conta: any) => {
    if (!payBankId) { showToast('Selecione a conta bancária de débito.', 'error', true); return; }
    const banco = bancos.find((b: any) => b.id === payBankId);
    if (!banco) { showToast('Conta bancária não encontrada.', 'error', true); return; }
    const valor = Number(conta.valor ?? 0);
    if (!(valor > 0)) { showToast('Valor da conta inválido.', 'error', true); return; }
    setPaySaving(true);
    try {
      // 1) Marca a conta como Paga.
      const updated = await dbUpdate('/api/contaspagarview', conta.id, { status: 'Pago' });
      setData((prev: any[]) => prev.map(d => d.id === conta.id ? (updated ?? { ...d, status: 'Pago' }) : d));

      // 2) Debita do saldo do banco escolhido. Se falhar, registra um aviso —
      // a conta JÁ está paga, mas o saldo bancário ficou desatualizado.
      if (supabase) {
        const novoSaldo = Number(banco.saldo ?? 0) - valor;
        const { error } = await supabase
          .from('caixa_bancos')
          .update({ saldo: novoSaldo })
          .eq('id', payBankId);
        if (error) {
          showToast(`Conta paga, mas falhou ao atualizar o saldo de "${banco.banco ?? banco.conta}". Ajuste manualmente.`, 'error', false);
          closePay();
          return;
        }
      }

      showToast(`Pagamento registado e R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} debitado de ${banco.banco ?? banco.conta}.`, 'success', true);
      closePay();
    } catch {
      showToast('Erro ao registar pagamento.', 'error', true);
    } finally {
      setPaySaving(false);
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

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Contas a Pagar</h2>
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Conta' : 'Nova Conta a Pagar'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <FormField label="Descrição *" error={errors.descricao}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.descricao ? 'border border-red-500/40' : ''}`}
                    value={form.descricao} onChange={e => { setForm(f => ({ ...f, descricao: e.target.value })); clearError('descricao'); }}
                    placeholder="Ex: Fornecimento de material" />
                </FormField>
                <FormField label="Valor (R$)">
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                    value={extras.valor} onChange={e => setExtras(x => ({ ...x, valor: formatBRL(e.target.value) }))} placeholder="0,00" />
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
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor</th>
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Vencimento</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((item: any) => (
                    <React.Fragment key={item.id}>
                      <motion.tr initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          {item.descricao}
                          <span className="md:hidden block text-[10px] text-gray-500 mt-0.5">{item.forn?.nome ?? '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">{item.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(item.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="py-3 px-4 text-xs text-gray-500 font-mono hidden sm:table-cell">{item.vencimento || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {item.status === 'Pendente' && (
                              <button onClick={() => openPay(item.id)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"><Check size={11} /> Pagar</button>
                            )}
                            {item.status !== 'Pago' && (
                              <>
                                <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                                <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                      <AnimatePresence>
                        {payingId === item.id && (
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <td colSpan={6} className="pb-3 px-4">
                              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 p-4 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[220px]">
                                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5"><Landmark size={11} /> Conta bancária de débito *</label>
                                  <select className="neu-input py-2 px-3 rounded-xl text-xs w-full" value={payBankId} onChange={e => setPayBankId(e.target.value)}>
                                    <option value="">Selecione...</option>
                                    {bancosAtivos.map((b: any) => (
                                      <option key={b.id} value={b.id}>
                                        {(b.banco ?? b.conta ?? '—')} — saldo R$ {Number(b.saldo ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                      </option>
                                    ))}
                                  </select>
                                  {bancosAtivos.length === 0 && (
                                    <span className="text-[10px] text-yellow-400 mt-1">Nenhum banco activo. Cadastre em Financeiro → Caixa / Bancos.</span>
                                  )}
                                </div>
                                <div className="flex gap-2 sm:contents">
                                  <button onClick={() => handleConfirmarPagamento(item)} disabled={paySaving || !payBankId}
                                    className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none">
                                    {paySaving ? 'Pagando...' : <><Check size={12} /> Confirmar pagamento</>}
                                  </button>
                                  <button onClick={closePay} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center justify-center gap-1"><X size={11} /> Cancelar</button>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))}
                </AnimatePresence>
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
      )}
    </motion.div>
  );
};
