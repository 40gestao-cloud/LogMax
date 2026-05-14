import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, ChevronDown, X, FileDown, Sheet } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

export const HistoricoVendasView = ({ showToast }: any) => {
  const { data: vendas, setData: setVendas, isLoading: loadingV } = useFetchData<any>('/api/vendasview');
  const { data: itens, isLoading: loadingI } = useFetchData<any>('/api/itensvendaview');
  const { data: clientes } = useFetchData<any>('/api/crmview');

  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'hoje' | 'semana'>('todos');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<string | null>(null);

  const isLoading = loadingV || loadingI;

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const enriched = vendas.map((v: any) => ({
    ...v,
    cliente: clientes.find((c: any) => c.id === v.cliente_id),
    itens: itens.filter((i: any) => i.venda_id === v.id),
  }));

  const filtered = enriched
    .filter((v: any) => {
      const d = (v.created_at ?? '').slice(0, 10);
      if (filtro === 'hoje') return d === today;
      if (filtro === 'semana') return d >= weekAgo;
      return true;
    })
    .filter((v: any) => {
      const q = search.toLowerCase();
      return [v.id, v.forma_pagamento, v.status, v.cliente?.nome].some((x: any) => x?.toLowerCase().includes(q));
    });

  const totalFiltrado = filtered
    .filter((v: any) => v.status !== 'Cancelada')
    .reduce((s: number, v: any) => s + Number(v.total_final ?? 0), 0);

  const handleCancelar = async (id: string) => {
    if (!confirm('Cancelar esta venda? O estoque NÃO será revertido automaticamente.')) return;
    setCanceling(id);
    try {
      await dbUpdate('/api/vendasview', id, { status: 'Cancelada' });
      setVendas((prev: any[]) => prev.map(v => v.id === id ? { ...v, status: 'Cancelada' } : v));
      showToast('Venda cancelada.', 'info', true);
    } catch {
      showToast('Erro ao cancelar.', 'error', true);
    } finally {
      setCanceling(null);
    }
  };

  const exportCols = ['Data', 'ID', 'Cliente', 'Forma Pgto', 'Total', 'Status'];
  const exportRows = () => filtered.map((v: any) => [
    (v.created_at ?? '').slice(0, 10),
    `#${v.id.slice(-6).toUpperCase()}`,
    v.cliente?.nome ?? '—',
    v.forma_pagamento,
    `R$ ${Number(v.total_final ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    v.status,
  ]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex justify-between items-start shrink-0 flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Histórico de Vendas</h2>
          <p className="text-sm text-gray-400 mt-1">
            {filtro === 'hoje' ? 'Vendas de hoje' : filtro === 'semana' ? 'Últimos 7 dias' : 'Todas as vendas'} —
            Total: <span className="text-accent font-bold">{totalFiltrado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
          </p>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          {/* Filtro período */}
          <div className="flex gap-1 neu-flat rounded-xl p-1">
            {(['todos', 'hoje', 'semana'] as const).map(f => (
              <button key={f} onClick={() => setFiltro(f)}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${filtro === f ? 'neu-pressed text-accent' : 'text-gray-500 hover:text-gray-300'}`}>
                {f === 'todos' ? 'Todos' : f === 'hoje' ? 'Hoje' : '7 dias'}
              </button>
            ))}
          </div>
          {/* Busca */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar venda..." className="neu-input py-2 pl-9 pr-4 rounded-xl text-xs w-44"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Export */}
          <button onClick={() => exportToPDF('Histórico de Vendas', exportCols, exportRows(), 'logmax-vendas')}
            className="neu-button py-2 px-3 rounded-xl flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <FileDown size={13} /> PDF
          </button>
          <button onClick={() => exportToExcel('Vendas', exportCols, exportRows(), 'logmax-vendas')}
            className="neu-button py-2 px-3 rounded-xl flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <Sheet size={13} /> Excel
          </button>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState message="Nenhuma venda encontrada" /> : (
        <div className="flex flex-col gap-3 overflow-y-auto main-scrollbar pr-1 pb-6">
          <AnimatePresence>
            {filtered.map((v: any) => {
              const isExp = expanded === v.id;
              const isCanceling = canceling === v.id;
              return (
                <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
                  <button onClick={() => setExpanded(isExp ? null : v.id)}
                    className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors text-left">
                    <div className="flex items-center gap-5">
                      <div>
                        <p className="text-xs font-mono text-gray-500">#{v.id.slice(-6).toUpperCase()}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">{(v.created_at ?? '').slice(0, 10)}</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-200">{v.cliente?.nome ?? 'Venda balcão'}</p>
                        <p className="text-xs text-gray-500">{v.forma_pagamento} · {v.itens?.length ?? 0} {v.itens?.length === 1 ? 'item' : 'itens'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-lg font-black text-accent font-mono">
                        {Number(v.total_final ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                      <StatusBadge status={v.status} />
                      <ChevronDown size={14} className={`text-gray-500 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExp && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="px-5 pb-5 border-t border-white/5 pt-4 flex flex-col gap-4">
                          {/* Itens */}
                          <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Itens da venda</p>
                            {v.itens?.length > 0 ? v.itens.map((item: any) => (
                              <div key={item.id} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-0">
                                <span className="text-gray-300">{item.nome_produto}</span>
                                <span className="text-gray-500 font-mono">
                                  {item.qtd} × {Number(item.preco_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} = <span className="text-gray-200 font-bold">{Number(item.subtotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                </span>
                              </div>
                            )) : <p className="text-xs text-gray-600">Sem itens registrados.</p>}
                          </div>
                          {/* Resumo */}
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-gray-500 flex gap-4">
                              {Number(v.desconto) > 0 && <span>Desconto: <span className="text-red-400 font-mono">-{Number(v.desconto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></span>}
                            </div>
                            {v.status !== 'Cancelada' && (
                              <button onClick={() => handleCancelar(v.id)} disabled={!!isCanceling}
                                className="neu-button py-1.5 px-4 rounded-xl text-xs font-bold text-red-400 hover:border-red-500/20 border border-transparent transition-all flex items-center gap-1.5 disabled:opacity-50">
                                <X size={11} /> Cancelar venda
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
};
