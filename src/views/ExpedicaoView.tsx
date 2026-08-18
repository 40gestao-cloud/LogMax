import React, { useState, useEffect, useMemo } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, Trash2, Truck, Loader2 } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination } from '../components/ui';
import { useFormValidation, idsDeProdutosPorTermo } from '../lib/viewUtils';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../contexts/ConfirmContext';

const ExpedicaoViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);
  const confirm = useConfirm();
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });

  // Busca por produto resolvida contra o catálogo (já carregado acima) e
  // enviada como `IN (...)`: vale sobre a tabela toda, não só sobre a página.
  const produtoIds = useMemo(
    () => idsDeProdutosPorTermo(produtos, debouncedSearch),
    [produtos, debouncedSearch],
  );
  const extraFilter = debouncedSearch.trim() ? { filial, produto_id: produtoIds } : { filial };
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/expedicao', extraFilter, true, { page },
  );
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesestoqueview', { filial }, true);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ produto_id: '' });
  const [extras, setExtras] = useState({ requisicao_id: '', qtd_expedida: '', data_expedicao: '' });
  const [expedindo, setExpedindo] = useState<string | null>(null);
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Quais requisições já saíram numa expedição. `expedir` (migr. 268) não
  // mexe no status da requisição, e `data` é paginada — sem esta consulta a
  // requisição já atendida voltava ao dropdown idêntica a quem nunca foi
  // atendido, e nada na tela dizia o que ainda faltava expedir.
  const [requisicoesExpedidas, setRequisicoesExpedidas] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('expedicao')
      .select('requisicao_id, status')
      .eq('ativo', true)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const m = new Map<string, number>();
        (rows ?? []).forEach((e: any) => {
          if (!e.requisicao_id || e.status === 'Cancelado') return;
          m.set(e.requisicao_id, (m.get(e.requisicao_id) ?? 0) + 1);
        });
        setRequisicoesExpedidas(m);
      });
    return () => { cancelled = true; };
  }, [data]);

  // Duas listas: o que ainda não saiu e o que já saiu. Não sumimos com as
  // atendidas porque uma requisição pode render mais de uma expedição
  // (entrega parcial) — mas quem já saiu desce e vem com a contagem.
  const requisicoesParaExpedir = useMemo(() => {
    const aprovadas = requisicoes.filter((r: any) => r.status === 'Aprovado');
    return {
      pendentes: aprovadas.filter((r: any) => !requisicoesExpedidas.has(r.id)),
      expedidas: aprovadas.filter((r: any) => requisicoesExpedidas.has(r.id)),
    };
  }, [requisicoes, requisicoesExpedidas]);

  const enriched = data.map((e: any) => ({ ...e, prod: produtos.find((p: any) => p.id === e.produto_id) }));
  // Busca já resolvida no servidor (produto_id IN ...).
  const filtered = enriched;

  const closeForm = () => { setShowForm(false); setForm({ produto_id: '' }); setExtras({ requisicao_id: '', qtd_expedida: '', data_expedicao: '' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true); showToast("Salvando...", 'info', false);
    try {
      const today = todayBR();
      const qtd = Number(extras.qtd_expedida) || 0;
      // Nasce sempre 'Pendente'. A baixa de estoque acontece no botão Expedir,
      // dentro da RPC `expedir` (migr. 268) — antes eram dois inserts soltos:
      // se o segundo falhasse, ficava expedição 'Expedido' sem baixa nenhuma.
      const payload = { ...form, requisicao_id: extras.requisicao_id || null, qtd_expedida: qtd, data_expedicao: extras.data_expedicao || today, status: 'Pendente', filial };
      const s = await dbInsert('/api/expedicao', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      showToast("Expedição registrada. Use o botão Expedir para baixar o estoque.", 'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setIsSaving(false); }
  };

  // Baixa o estoque e marca 'Expedido' na mesma transação. Saldo insuficiente
  // estoura no trigger e desfaz tudo — nada de truncar em zero.
  const handleExpedir = async (item: any) => {
    if (!await confirm(
      `Expedir ${item.qtd_expedida} un. de ${item.prod?.nome ?? 'produto'}?\n\n` +
      `A saída será lançada no estoque agora.`
    )) return;
    setExpedindo(item.id);
    try {
      if (!supabase) throw new Error('Supabase não configurado');
      const { data: atualizada, error } = await supabase.rpc('expedir', { p_expedicao_id: item.id });
      if (error) throw new Error(error.message);
      const nova: any = Array.isArray(atualizada) ? atualizada[0] : atualizada;
      setData((prev: any[]) => prev.map(d => d.id === item.id ? { ...d, ...nova } : d));
      showToast('Expedido — estoque baixado.', 'success', true);
    } catch (err: any) {
      showToast(`Erro ao expedir: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setExpedindo(null); }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Inativar esta expedição?')) return;
    try {
      await dbDelete('/api/expedicao', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Expedição inativada.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Expedicao] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div><h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Expedição — {filial}</h2><p className="text-sm text-gray-400 mt-1">Gerencie a saída e expedição de produtos do estoque.</p></div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova Expedição</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Expedição</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Produto *" error={errors.produto_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`} value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}><option value="">Selecione...</option>{produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></FormField>
                <FormField label="Requisição (opcional)"><select className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.requisicao_id} onChange={e => setExtras(x => ({ ...x, requisicao_id: e.target.value }))}><option value="">Nenhuma</option>
                  {requisicoesParaExpedir.pendentes.length > 0 && (
                    <optgroup label={`Ainda sem expedição (${requisicoesParaExpedir.pendentes.length})`}>
                      {requisicoesParaExpedir.pendentes.map((r: any) => <option key={r.id} value={r.id}>{r.solicitante} — {r.destino}</option>)}
                    </optgroup>
                  )}
                  {requisicoesParaExpedir.expedidas.length > 0 && (
                    <optgroup label={`Já expedidas (${requisicoesParaExpedir.expedidas.length})`}>
                      {requisicoesParaExpedir.expedidas.map((r: any) => {
                        const n = requisicoesExpedidas.get(r.id) ?? 0;
                        return <option key={r.id} value={r.id}>{r.solicitante} — {r.destino} · {n} expediç{n === 1 ? 'ão' : 'ões'}</option>;
                      })}
                    </optgroup>
                  )}
                </select></FormField>
                <FormField label="Qtd Expedida"><input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_expedida} onChange={e => setExtras(x => ({ ...x, qtd_expedida: e.target.value }))} placeholder="0" /></FormField>
                <FormField label="Data Expedição"><input type="date" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.data_expedicao} onChange={e => setExtras(x => ({ ...x, data_expedicao: e.target.value }))} /></FormField>
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
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={5}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={5}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd_expedida ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data_expedicao || '—'}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                          <HistoricoOperacoes entidade="expedicao" entidadeId={item.id} titulo={`Expedição ${String(item.id).slice(-6).toUpperCase()}`} />
                          {item.status === 'Pendente' && (
                            <button
                              onClick={() => handleExpedir(item)}
                              disabled={expedindo === item.id}
                              title="Expedir e baixar o estoque"
                              className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors flex items-center gap-1 disabled:opacity-50">
                              {expedindo === item.id ? <Loader2 size={11} className="animate-spin" /> : <Truck size={11} />}
                              Expedir
                            </button>
                          )}
                          <button onClick={() => handleDelete(item.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </motion.tr>
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

export const ExpedicaoView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <ExpedicaoViewInner showToast={showToast} filial={filialAtiva} />;
};
