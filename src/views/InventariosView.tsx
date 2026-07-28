import React, { useState } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, Trash2, CheckCheck, Loader2 } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbInsert, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';

const InventariosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/inventariosestoqueview', { filial });
  const confirm = useConfirm();
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ produto_id: '' });
  // `qtd_sistema` saiu do formulário: era digitado pelo mesmo operador que
  // contava, então dava para "fechar" um inventário com 100 e 100 sem abrir o
  // depósito. Agora o saldo é lido pelo banco no instante do fechamento
  // (RPC fechar_inventario, migr. 268).
  const [extras, setExtras] = useState({ qtd_contada: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  const [fechando, setFechando] = useState<string | null>(null);

  const saldoAtualDoForm = Number(produtos.find((p: any) => p.id === form.produto_id)?.estoque ?? 0);

  const enriched = data.map((i: any) => ({ ...i, prod: produtos.find((p: any) => p.id === i.produto_id) }));
  const filtered = enriched.filter((i: any) => [i.prod?.nome, i.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())));

  const closeForm = () => { setShowForm(false); setForm({ produto_id: '' }); setExtras({ qtd_contada: '' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    const contada = Number(extras.qtd_contada);
    if (!Number.isFinite(contada) || contada < 0) { showToast('Informe a quantidade contada.', 'error', true); return; }
    setIsSaving(true); showToast("Salvando...", 'info', false);
    try {
      const today = todayBR();
      // Nasce 'Em Andamento': a contagem existe, mas só ajusta o estoque quando
      // alguém fecha o inventário conscientemente.
      const payload = { ...form, qtd_sistema: 0, qtd_contada: contada, status: 'Em Andamento', data: today, filial };
      const s = await dbInsert('/api/inventariosestoqueview', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      showToast("Contagem registrada. Feche o inventário para ajustar o estoque.", 'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setIsSaving(false); }
  };

  // Fecha o inventário: o banco lê o saldo do sistema AGORA, compara com a
  // contagem e gera o 'Ajuste +/−' da diferença. Antes o inventário só
  // registrava a divergência e morria ali — era formulário, não inventário.
  const handleFechar = async (item: any) => {
    const contada = Number(item.qtd_contada ?? 0);
    if (!await confirm(
      `Fechar o inventário de ${item.prod?.nome ?? 'produto'}?\n\n` +
      `A contagem registrada é ${contada}. O sistema vai comparar com o saldo atual e ` +
      `lançar o ajuste da diferença no estoque.`
    )) return;
    setFechando(item.id);
    try {
      if (!supabase) throw new Error('Supabase não configurado');
      const { data: res, error } = await supabase.rpc('fechar_inventario', {
        p_inventario_id: item.id,
        p_qtd_contada:   contada,
      });
      if (error) throw new Error(error.message);
      const r = res as any;
      const dif = Number(r?.diferenca ?? 0);
      setData((prev: any[]) => prev.map(d => d.id === item.id
        ? { ...d, qtd_sistema: r?.qtd_sistema, qtd_contada: r?.qtd_contada, diferenca: dif, status: 'Concluído' }
        : d));
      showToast(
        dif === 0
          ? 'Inventário fechado — contagem bateu com o sistema.'
          : `Inventário fechado — ajuste de ${dif > 0 ? '+' : ''}${dif} un. lançado no estoque.`,
        'success', true
      );
    } catch (err: any) {
      showToast(`Erro ao fechar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setFechando(null); }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Inativar este inventário?')) return;
    try {
      await dbDelete('/api/inventariosestoqueview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Inventário inativado.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Inventarios] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div><h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Inventários — {filial}</h2><p className="text-sm text-gray-400 mt-1">Realize contagens de estoque e registre divergências.</p></div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova Contagem</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Contagem</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Produto *" error={errors.produto_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`} value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}><option value="">Selecione...</option>{produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></FormField>
                <FormField label="Qtd Contada *"><input type="number" min="0" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_contada} onChange={e => setExtras(x => ({ ...x, qtd_contada: e.target.value }))} placeholder="0" /></FormField>
                {form.produto_id && (
                  <div className="neu-pressed rounded-xl px-3 py-2 self-end">
                    <div className="text-[9px] text-gray-500 uppercase font-bold tracking-widest">Saldo atual no sistema</div>
                    <div className="text-sm font-black text-gray-200 tabular-nums">{saldoAtualDoForm}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">Só referência — o valor oficial é lido no fechamento.</div>
                  </div>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Salvar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-right">Qtd Sistema</th><th className="pb-4 font-bold px-4 text-right">Qtd Contada</th><th className="pb-4 font-bold px-4 text-right">Diferença</th><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={7}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={7}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => {
                    const dif = Number(item.diferenca ?? ((item.qtd_contada ?? 0) - (item.qtd_sistema ?? 0)));
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">{item.qtd_sistema ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">{item.qtd_contada ?? '—'}</td>
                        <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${dif < 0 ? 'text-red-500' : dif > 0 ? 'text-green-400' : 'text-gray-400'}`}>{dif > 0 ? `+${dif}` : dif}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                            {item.status !== 'Concluído' && (
                              <button
                                onClick={() => handleFechar(item)}
                                disabled={fechando === item.id}
                                title="Fechar inventário e ajustar o estoque"
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors flex items-center gap-1 disabled:opacity-50">
                                {fechando === item.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCheck size={11} />}
                                Fechar
                              </button>
                            )}
                            <button onClick={() => handleDelete(item.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

export const InventariosView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <InventariosViewInner showToast={showToast} filial={filialAtiva} />;
};
