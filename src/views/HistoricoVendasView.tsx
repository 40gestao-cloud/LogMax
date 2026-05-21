import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, ChevronDown, X, FileDown, Sheet, Trash2 } from 'lucide-react';
import { useFetchData, dbUpdate, dbInsert, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { supabase } from '../lib/supabase';
import { useAIContext } from '../contexts/AIAssistantContext';

export const HistoricoVendasView = ({ showToast }: any) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  // Realtime activo: vendas concluídas por outros caixas refrescam esta lista (#21).
  const { data: vendas, setData: setVendas, isLoading: loadingV, totalCount, reload: reloadVendas } = useFetchData<any>(
    '/api/vendasview', undefined, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['forma_pagamento', 'status'] }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview');

  // Itens carregados apenas para as vendas da página actual.
  // Antes carregava `itens_venda` inteira — escala mal com vendas diárias acumuladas.
  const [itens, setItens] = useState<any[]>([]);
  const [loadingI, setLoadingI] = useState(false);
  const vendaIdsKey = vendas.map((v: any) => v.id).join(',');
  useEffect(() => {
    if (!supabase || vendas.length === 0) {
      setItens([]);
      return;
    }
    let cancelled = false;
    setLoadingI(true);
    const ids = vendas.map((v: any) => v.id);
    supabase.from('itens_venda').select('*').in('venda_id', ids)
      .then(({ data: rows }) => {
        if (cancelled) return;
        setItens(rows ?? []);
        setLoadingI(false);
      });
    return () => { cancelled = true; };
  }, [vendaIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Search é server-side; cliente/id pesquisa-se manualmente dentro da página.
  // Período hoje/semana mantém-se client-side (operação rápida, conhecida).
  const filtered = enriched
    .filter((v: any) => {
      const d = (v.created_at ?? '').slice(0, 10);
      if (filtro === 'hoje') return d === today;
      if (filtro === 'semana') return d >= weekAgo;
      return true;
    });

  const totalFiltrado = filtered
    .filter((v: any) => v.status !== 'Cancelada')
    .reduce((s: number, v: any) => s + Number(v.total_final ?? 0), 0);

  // ──────────────────────────────────────────────
  // Injeção de contexto pro MaxAI — versão slim das vendas filtradas
  // ──────────────────────────────────────────────
  // O hook `useAIContext` registra esses dados enquanto a view está aberta.
  // Quando o usuário pergunta no MaxAI, o snapshot é enviado junto (invisível
  // na UI). useMemo evita reset a cada render.
  const aiSnapshot = useMemo(() => ({
    label: `Vendas — filtro: ${filtro}`,
    data: {
      filtro_periodo: filtro,
      total_vendas:   filtered.length,
      valor_total:    Number(totalFiltrado.toFixed(2)),
      ticket_medio:   filtered.length ? Number((totalFiltrado / filtered.length).toFixed(2)) : 0,
      vendas: filtered.slice(0, 30).map((v: any) => ({
        data:           v.created_at?.slice(0, 10),
        hora:           v.created_at?.slice(11, 16),
        total:          Number(v.total_final ?? 0),
        forma_pagamento: v.forma_pagamento,
        status:         v.status,
        cliente:        v.cliente?.nome ?? null,
        itens: (v.itens ?? []).map((i: any) => ({
          produto: i.descricao,
          qtd:     i.qtd,
          preco:   i.preco_unitario ?? i.preco,
        })),
      })),
    },
  }), [filtro, filtered.length, totalFiltrado]); // eslint-disable-line react-hooks/exhaustive-deps
  useAIContext(aiSnapshot);

  const handleCancelar = async (venda: any) => {
    // Guard: impede duplo cancelamento (clique duplo, realtime defasado).
    if (venda.status === 'Cancelada') {
      showToast('Esta venda já está cancelada.', 'info', true);
      return;
    }
    if (!confirm('Cancelar esta venda? Os itens serão devolvidos ao estoque automaticamente.')) return;
    setCanceling(venda.id);
    try {
      await dbUpdate('/api/vendasview', venda.id, { status: 'Cancelada' });
      // Estorna os itens: cria uma movimentação de Entrada para cada produto vendido.
      // Itens órfãos (produto deletado/inválido) são pulados silenciosamente — o
      // cancelamento da venda não pode falhar por causa de dados antigos.
      const today = new Date().toISOString().slice(0, 10);
      const itensVenda = venda.itens ?? [];
      let estornados = 0;
      let orfaos = 0;
      for (const item of itensVenda) {
        if (!item.produto_id || !item.qtd) { orfaos++; continue; }
        try {
          await dbInsert('/api/movimentacoesestoqueview', {
            produto_id: item.produto_id,
            tipo: 'Entrada',
            qtd: Number(item.qtd),
            origem: `Estorno — Venda #${venda.id.slice(-6).toUpperCase()} cancelada`,
            destino: 'Almoxarifado',
            data: today,
          });
          estornados++;
        } catch (estornoErr: any) {
          // Falha de FK (produto removido após a venda) ou similar: registra
          // no console mas não interrompe o cancelamento.
          console.warn(`[Estorno] item ${item.id} ignorado:`, estornoErr?.message ?? estornoErr);
          orfaos++;
        }
      }
      setVendas((prev: any[]) => prev.map(v => v.id === venda.id ? { ...v, status: 'Cancelada' } : v));
      if (orfaos > 0 && estornados > 0) {
        showToast(`Venda cancelada. ${estornados} item(ns) estornado(s) ao estoque; ${orfaos} pulado(s) (produto removido).`, 'info', true);
      } else if (orfaos > 0 && estornados === 0) {
        showToast('Venda cancelada. Estoque não foi estornado (produtos removidos do catálogo).', 'info', true);
      } else {
        showToast('Venda cancelada e estoque estornado.', 'success', true);
      }
    } catch (err: any) {
      showToast(`Erro ao cancelar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setCanceling(null);
    }
  };

  const handleExcluir = async (venda: any) => {
    if (!confirm('Inativar esta venda? Ela sairá da listagem mas o histórico fica preservado no banco.')) return;
    try {
      await dbDelete('/api/vendasview', venda.id);
      setVendas((prev: any[]) => prev.filter(v => v.id !== venda.id));
      showToast('Venda inativada.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[HistoricoVendas] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
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
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Histórico de Vendas</h2>
          <p className="text-sm text-gray-400 mt-1">
            {filtro === 'hoje' ? 'Vendas de hoje' : filtro === 'semana' ? 'Últimos 7 dias' : 'Todas as vendas'} —
            Total: <span className="text-accent font-bold">{totalFiltrado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
          </p>
        </div>
        <div className="flex gap-3 items-center flex-wrap w-full sm:w-auto">
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
          <div className="relative flex-1 sm:flex-none">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar venda..." className="neu-input py-2 pl-9 pr-4 rounded-xl text-xs w-full sm:w-44"
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
                  className="neu-flat rounded-2xl border border-white/5">
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
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
                              {Number(v.desconto) > 0 && <span>Desconto: <span className="text-red-500 font-mono">-{Number(v.desconto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {v.status !== 'Cancelada' && (
                                <button onClick={() => handleCancelar(v)} disabled={!!isCanceling}
                                  className="neu-button py-1.5 px-4 rounded-xl text-xs font-bold text-red-500 hover:border-red-500/20 border border-transparent transition-all flex items-center gap-1.5 disabled:opacity-50">
                                  <X size={11} /> Cancelar venda
                                </button>
                              )}
                              <button onClick={() => handleExcluir(v)} title="Inativar venda" disabled={!!isCanceling}
                                className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                <Trash2 size={11} /> Excluir
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
          <Pagination
            page={page}
            totalCount={totalCount}
            isLoading={isLoading}
            onPrev={() => setPage(p => Math.max(0, p - 1))}
            onNext={() => setPage(p => p + 1)}
            onReload={reloadVendas}
          />
        </div>
      )}
    </motion.div>
  );
};
