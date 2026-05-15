import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Trash2, Check, RefreshCw, Loader2 } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';

export const CotacoesView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/cotacoesview');
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesview');
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');
  const { data: pedidos } = useFetchData<any>('/api/pedidosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [recreating, setRecreating] = useState<string | null>(null);
  const [form, setForm] = useState({ requisicao_id: '', fornecedor_id: '' });
  const [extras, setExtras] = useState({ valor_total: '', prazo_entrega: '', validade: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // IDs de cotações que já têm pedido gerado
  const cotacoesComPedido = new Set(pedidos.map((p: any) => p.cotacao_id).filter(Boolean));

  const requisicoesAprovadas = requisicoes.filter((r: any) => r.status === 'Aprovada');

  const enriched = data.map((c: any) => ({
    ...c,
    req: requisicoes.find((r: any) => r.id === c.requisicao_id),
    forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
  }));

  const closeForm = () => {
    setShowForm(false);
    setForm({ requisicao_id: '', fornecedor_id: '' });
    setExtras({ valor_total: '', prazo_entrega: '', validade: '' });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast("Criando cotação...", 'info', false);
    try {
      const saved = await dbInsert('/api/cotacoesview', {
        requisicao_id: form.requisicao_id,
        fornecedor_id: form.fornecedor_id,
        valor_total: parseFloat(extras.valor_total.replace(',', '.')) || 0,
        prazo_entrega: extras.prazo_entrega,
        validade: extras.validade || null,
        status: 'Em Cotação',
      });
      setData((prev: any[]) => [saved ?? { id: Date.now(), ...form, ...extras, status: 'Em Cotação' }, ...prev]);
      closeForm();
      showToast("Cotação criada!", 'success', true);
    } catch {
      showToast("Erro ao salvar.", 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAprovar = async (cotacao: any) => {
    try {
      await dbUpdate('/api/cotacoesview', cotacao.id, { status: 'Aprovado' });
      setData((prev: any[]) => prev.map(c => c.id === cotacao.id ? { ...c, status: 'Aprovado' } : c));
    } catch (err: any) {
      showToast(`Erro ao aprovar cotação: ${err?.message ?? 'verifique o console'}`, 'error', true);
      return;
    }
    // Cancelar as demais cotações da mesma requisição para evitar pedidos duplicados
    if (cotacao.requisicao_id) {
      const concorrentes = data.filter((c: any) =>
        c.id !== cotacao.id &&
        c.requisicao_id === cotacao.requisicao_id &&
        c.status === 'Em Cotação'
      );
      for (const c of concorrentes) {
        try {
          await dbUpdate('/api/cotacoesview', c.id, { status: 'Cancelado' });
        } catch { /* melhor esforço — não bloqueia o fluxo */ }
      }
      if (concorrentes.length > 0) {
        setData((prev: any[]) => prev.map(c =>
          concorrentes.some((cc: any) => cc.id === c.id) ? { ...c, status: 'Cancelado' } : c
        ));
      }
    }
    try {
      const pedido = await dbInsert('/api/pedidosview', {
        cotacao_id: cotacao.id,
        requisicao_id: cotacao.requisicao_id ?? null,
        fornecedor_id: cotacao.fornecedor_id,
        valor_total: cotacao.valor_total,
        prazo_entrega: cotacao.prazo_entrega || null,
        status: 'Pendente',
      });
      showToast(`Cotação aprovada! Pedido #${(pedido as any)?.id?.slice(-6).toUpperCase() ?? 'NOVO'} gerado.`, 'success', true);
    } catch (err: any) {
      showToast(`Cotação aprovada, mas falha ao criar pedido: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const handleRecriarPedido = async (cotacao: any) => {
    setRecreating(cotacao.id);
    try {
      const pedido = await dbInsert('/api/pedidosview', {
        cotacao_id: cotacao.id,
        requisicao_id: cotacao.requisicao_id ?? null,
        fornecedor_id: cotacao.fornecedor_id,
        valor_total: cotacao.valor_total,
        prazo_entrega: cotacao.prazo_entrega || null,
        status: 'Pendente',
      });
      showToast(`Pedido #${(pedido as any)?.id?.slice(-6).toUpperCase() ?? 'NOVO'} gerado com sucesso.`, 'success', true);
    } catch (err: any) {
      showToast(`Falha ao recriar pedido: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setRecreating(null);
    }
  };

  const handleCancelar = async (id: string) => {
    if (!confirm('Cancelar esta cotação?')) return;
    try {
      const updated = await dbUpdate('/api/cotacoesview', id, { status: 'Cancelado' });
      setData((prev: any[]) => prev.map(c => c.id === id ? (updated ?? { ...c, status: 'Cancelado' }) : c));
      showToast("Cotação cancelada.", 'info', true);
    } catch {
      showToast("Erro ao cancelar.", 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Cotações</h2>
          <p className="text-sm text-gray-400 mt-1">Colete propostas de fornecedores para requisições aprovadas.</p>
        </div>
        <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
          <Plus size={16} /> Nova Cotação
        </NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Cotação</h3>
              {requisicoesAprovadas.length === 0 ? (
                <p className="text-sm text-yellow-400/80 text-center py-4">Nenhuma requisição aprovada disponível. Aprove uma requisição primeiro.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField label="Requisição *" error={errors.requisicao_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.requisicao_id ? 'border border-red-500/40' : ''}`}
                        value={form.requisicao_id} onChange={e => { setForm(f => ({ ...f, requisicao_id: e.target.value })); clearError('requisicao_id'); }}>
                        <option value="">Selecione...</option>
                        {requisicoesAprovadas.map((r: any) => (
                          <option key={r.id} value={r.id}>{r.item} (Qtd: {r.qtd})</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Fornecedor *" error={errors.fornecedor_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.fornecedor_id ? 'border border-red-500/40' : ''}`}
                        value={form.fornecedor_id} onChange={e => { setForm(f => ({ ...f, fornecedor_id: e.target.value })); clearError('fornecedor_id'); }}>
                        <option value="">Selecione...</option>
                        {fornecedores.map((f: any) => (
                          <option key={f.id} value={f.id}>{f.nome}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Valor Total (R$)">
                      <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.valor_total} onChange={e => setExtras(x => ({ ...x, valor_total: e.target.value }))}
                        placeholder="Ex: 1.250,00" />
                    </FormField>
                    <FormField label="Prazo de Entrega">
                      <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.prazo_entrega} onChange={e => setExtras(x => ({ ...x, prazo_entrega: e.target.value }))} />
                    </FormField>
                    <FormField label="Validade da Proposta">
                      <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.validade} onChange={e => setExtras(x => ({ ...x, validade: e.target.value }))} />
                    </FormField>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                    <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Salvar Cotação</NeuButtonAccent>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? <EmptyState message="Nenhuma cotação encontrada" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Requisição</th>
                  <th className="pb-4 font-bold px-4">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor Total</th>
                  <th className="pb-4 font-bold px-4">Prazo Entrega</th>
                  <th className="pb-4 font-bold px-4">Validade</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.req?.item ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.forn?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(item.valor_total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.prazo_entrega || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 font-mono">{item.validade || '—'}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        {item.status === 'Em Cotação' && (
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleAprovar(item)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"><Check size={11} /> Aprovar</button>
                            <button onClick={() => handleCancelar(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
                          </div>
                        )}
                        {item.status === 'Aprovado' && !cotacoesComPedido.has(item.id) && (
                          <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleRecriarPedido(item)}
                              disabled={recreating === item.id}
                              className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-yellow-400 hover:bg-yellow-400/10 border border-yellow-400/15 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                              {recreating === item.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                              Recriar Pedido
                            </button>
                          </div>
                        )}
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
