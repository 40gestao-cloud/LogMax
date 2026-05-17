import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Check, Landmark, X } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';
import { supabase } from '../lib/supabase';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

export const ContasReceberView = ({ showToast }: any) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  // Realtime: vendas Fiado de outros caixas geram contas a receber — esta view actualiza-se sozinha (#21).
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/contasreceberview', undefined, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['descricao', 'status'] }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview');
  const { data: bancos } = useFetchData<any>('/api/caixabancosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ descricao: '' });
  const [extras, setExtras] = useState({ valor: '', vencimento: '', cliente_id: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  // Diálogo inline de recebimento: pede o banco de crédito antes de confirmar.
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [recBankId, setRecBankId] = useState('');
  const [recSaving, setRecSaving] = useState(false);

  const bancosAtivos = bancos.filter((b: any) => b.status === 'Ativo' || !b.status);

  // Total agregado server-side (independente da página).
  const [totalAberto, setTotalAberto] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('contas_receber').select('valor').eq('status', 'Aberto')
      .then(({ data: rows }) => {
        if (cancelled) return;
        setTotalAberto((rows ?? []).reduce((s: number, c: any) => s + Number(c.valor || 0), 0));
      });
    return () => { cancelled = true; };
  }, [data]);

  const enriched = data.map((c: any) => ({
    ...c,
    cliente: clientes.find((cl: any) => cl.id === c.cliente_id),
  }));

  const filtered = enriched.filter((c: any) =>
    [c.descricao, c.status, c.cliente?.nome].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ descricao: item.descricao ?? '' });
    setExtras({ valor: String(item.valor ?? ''), vencimento: item.vencimento ?? '', cliente_id: item.cliente_id ?? '' });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ descricao: '' });
    setExtras({ valor: '', vencimento: '', cliente_id: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    const payload = {
      descricao: form.descricao,
      valor: parseFloat(extras.valor.replace(',', '.')) || 0,
      vencimento: extras.vencimento || null,
      cliente_id: extras.cliente_id || null,
    };
    try {
      if (editItem) {
        const updated = await dbUpdate('/api/contasreceberview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Conta atualizada!', 'success', true);
      } else {
        const saved = await dbInsert('/api/contasreceberview', { ...payload, status: 'Aberto' });
        setData((prev: any[]) => [saved ?? { id: Date.now(), ...payload, status: 'Aberto' }, ...prev]);
        showToast('Conta a Receber criada!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[ContasReceber] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const openReceber = (id: string) => {
    setReceivingId(id);
    setRecBankId('');
  };

  const closeReceber = () => {
    setReceivingId(null);
    setRecBankId('');
  };

  const handleConfirmarRecebimento = async (conta: any) => {
    if (!recBankId) { showToast('Selecione a conta bancária de crédito.', 'error', true); return; }
    const banco = bancos.find((b: any) => b.id === recBankId);
    if (!banco) { showToast('Conta bancária não encontrada.', 'error', true); return; }
    const valor = Number(conta.valor ?? 0);
    if (!(valor > 0)) { showToast('Valor da conta inválido.', 'error', true); return; }
    setRecSaving(true);
    try {
      // 1) Marca a conta como Paga.
      const updated = await dbUpdate('/api/contasreceberview', conta.id, { status: 'Pago' });
      setData((prev: any[]) => prev.map(d => d.id === conta.id ? (updated ?? { ...d, status: 'Pago' }) : d));

      // 2) Credita no saldo do banco escolhido.
      if (supabase) {
        const novoSaldo = Number(banco.saldo ?? 0) + valor;
        const { error } = await supabase
          .from('caixa_bancos')
          .update({ saldo: novoSaldo })
          .eq('id', recBankId);
        if (error) {
          showToast(`Conta recebida, mas falhou ao atualizar o saldo de "${banco.banco ?? banco.conta}". Ajuste manualmente.`, 'error', false);
          closeReceber();
          return;
        }
      }

      showToast(`Recebimento registado e R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} creditado em ${banco.banco ?? banco.conta}.`, 'success', true);
      closeReceber();
    } catch {
      showToast('Erro ao registar recebimento.', 'error', true);
    } finally {
      setRecSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta conta?')) return;
    try {
      await dbDelete('/api/contasreceberview', id);
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
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Contas a Receber</h2>
          <p className="text-sm text-gray-400 mt-1">
            Total em aberto: <span className="text-accent font-bold">R$ {totalAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
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
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Conta' : 'Nova Conta a Receber'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <FormField label="Descrição *" error={errors.descricao}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.descricao ? 'border border-red-500/40' : ''}`}
                    value={form.descricao} onChange={e => { setForm(f => ({ ...f, descricao: e.target.value })); clearError('descricao'); }}
                    placeholder="Ex: Serviço prestado" />
                </FormField>
                <FormField label="Valor (R$)">
                  <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.valor} onChange={e => setExtras(x => ({ ...x, valor: e.target.value }))} placeholder="0,00" />
                </FormField>
                <FormField label="Vencimento">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.vencimento} onChange={e => setExtras(x => ({ ...x, vencimento: e.target.value }))} />
                </FormField>
                <FormField label="Cliente">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.cliente_id} onChange={e => setExtras(x => ({ ...x, cliente_id: e.target.value }))}>
                    <option value="">Nenhum</option>
                    {clientes.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
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

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? <EmptyState message="Nenhuma conta a receber" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Cliente</th>
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
                          <span className="md:hidden block text-[10px] text-gray-500 mt-0.5">{item.cliente?.nome ?? '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">{item.cliente?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(item.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="py-3 px-4 text-xs text-gray-500 font-mono hidden sm:table-cell">{item.vencimento || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {item.status === 'Aberto' && (
                              <button onClick={() => openReceber(item.id)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"><Check size={11} /> Receber</button>
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
                        {receivingId === item.id && (
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <td colSpan={6} className="pb-3 px-4">
                              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 p-4 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[220px]">
                                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5"><Landmark size={11} /> Conta bancária de crédito *</label>
                                  <select className="neu-input py-2 px-3 rounded-xl text-xs w-full" value={recBankId} onChange={e => setRecBankId(e.target.value)}>
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
                                  <button onClick={() => handleConfirmarRecebimento(item)} disabled={recSaving || !recBankId}
                                    className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none">
                                    {recSaving ? 'Confirmando...' : <><Check size={12} /> Confirmar recebimento</>}
                                  </button>
                                  <button onClick={closeReceber} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center justify-center gap-1"><X size={11} /> Cancelar</button>
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
