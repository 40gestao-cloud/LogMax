import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, FileText, ShoppingBag, Receipt } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, EmptyState, ExportButton, StatusBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

type TabId = 'orcamentos' | 'pedidos' | 'historico';

const FILIAIS_REL = ['SuperMax', 'MaxLook', 'TechMax'] as const;

// Relatório consolidado de Vendas — modo Matriz. Espelha o padrão de
// RelatoriosComprasView/RelatoriosEstoqueView/RelatoriosFinanceirosView:
// soma as 3 filiais (sem filial selecionada = consolidado), read-only.
// PDVView/OrcamentosView/PedidosVendaView/HistoricoVendasView exigem
// filialAtiva (operação do dia a dia de uma unidade) — esta tela existe
// à parte porque em Matriz não há filial ativa pra alimentar aquelas.
export const RelatoriosVendasView = ({ showToast: _showToast }: any) => {
  const [activeTab, setActiveTab] = useState<TabId>('orcamentos');
  const [search, setSearch] = useState('');
  const [filialFiltro, setFilialFiltro] = useState('');

  const { filialAtiva } = useFilial();
  const ff = filialAtiva ? { filial: filialAtiva } : undefined;
  const { data: orcamentos, isLoading: loadingOrc } = useFetchData<any>('/api/orcamentosview', ff);
  const { data: pedidos, isLoading: loadingPed } = useFetchData<any>('/api/pedidosvendaview', ff);
  const { data: vendas, isLoading: loadingVen } = useFetchData<any>('/api/vendasview', ff);
  const { data: clientes } = useFetchData<any>('/api/crmview', ff);

  const byFilial = (x: any) => !filialFiltro || !x.filial || x.filial === filialFiltro;

  const orcamentosF = orcamentos.filter(byFilial).map((o: any) => ({ ...o, cli: clientes.find((c: any) => c.id === o.cliente_id) }));
  const pedidosF    = pedidos.filter(byFilial).map((p: any) => ({ ...p, cli: clientes.find((c: any) => c.id === p.cliente_id) }));
  const vendasF     = vendas.filter(byFilial).map((v: any) => ({ ...v, cli: clientes.find((c: any) => c.id === v.cliente_id) }));

  const totalOrcamentos  = orcamentosF.length;
  const pedidosAbertos   = pedidosF.filter((p: any) => !['Concluído', 'Cancelado'].includes(p.status)).length;
  const vendasConcluidas = vendasF.filter((v: any) => v.status !== 'Cancelada');
  const valorTotalVendido = vendasConcluidas.reduce((acc: number, v: any) => acc + (Number(v.total_final) || 0), 0);

  const s = search.toLowerCase();
  const filteredOrc = orcamentosF.filter((o: any) => [o.cli?.nome, o.vendedor_nome, o.status].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredPed = pedidosF.filter((p: any) => [p.cli?.nome, p.vendedor_nome, p.status].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredVen = vendasF.filter((v: any) => [v.cli?.nome, v.forma_pagamento, v.status].some((v2: any) => v2?.toLowerCase().includes(s)));

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'orcamentos', label: 'Orçamentos', icon: FileText },
    { id: 'pedidos', label: 'Pedidos de Venda', icon: ShoppingBag },
    { id: 'historico', label: 'Histórico de Vendas', icon: Receipt },
  ];

  const isLoading = activeTab === 'orcamentos' ? loadingOrc
    : activeTab === 'pedidos' ? loadingPed : loadingVen;

  const activeData = activeTab === 'orcamentos' ? filteredOrc
    : activeTab === 'pedidos' ? filteredPed : filteredVen;

  const handleExportPDF = () => {
    if (activeTab === 'orcamentos') {
      exportToPDF('Relatório de Orçamentos', ['Cliente', 'Vendedor', 'Emitido', 'Total', 'Status'],
        filteredOrc.map((o: any) => [o.cli?.nome ?? '—', o.vendedor_nome ?? '—', o.data_emissao ?? '', `R$ ${Number(o.valor_total || 0).toFixed(2)}`, o.status ?? '']),
        'logmax-orcamentos');
    } else if (activeTab === 'pedidos') {
      exportToPDF('Relatório de Pedidos de Venda', ['Cliente', 'Vendedor', 'Total', 'Status'],
        filteredPed.map((p: any) => [p.cli?.nome ?? '—', p.vendedor_nome ?? '—', `R$ ${Number(p.valor_total || 0).toFixed(2)}`, p.status ?? '']),
        'logmax-pedidos-venda');
    } else {
      exportToPDF('Relatório de Histórico de Vendas', ['Cliente', 'Forma Pgto', 'Total', 'Data', 'Status'],
        filteredVen.map((v: any) => [v.cli?.nome ?? '—', v.forma_pagamento ?? '—', `R$ ${Number(v.total_final || 0).toFixed(2)}`, (v.created_at ?? '').slice(0, 10), v.status ?? '']),
        'logmax-historico-vendas');
    }
  };

  const handleExportExcel = () => {
    if (activeTab === 'orcamentos') {
      exportToExcel('Orçamentos', ['Cliente', 'Vendedor', 'Emitido', 'Total', 'Status'],
        filteredOrc.map((o: any) => [o.cli?.nome ?? '—', o.vendedor_nome ?? '—', o.data_emissao ?? '', Number(o.valor_total || 0), o.status ?? '']),
        'logmax-orcamentos');
    } else if (activeTab === 'pedidos') {
      exportToExcel('Pedidos de Venda', ['Cliente', 'Vendedor', 'Total', 'Status'],
        filteredPed.map((p: any) => [p.cli?.nome ?? '—', p.vendedor_nome ?? '—', Number(p.valor_total || 0), p.status ?? '']),
        'logmax-pedidos-venda');
    } else {
      exportToExcel('Histórico de Vendas', ['Cliente', 'Forma Pgto', 'Total', 'Data', 'Status'],
        filteredVen.map((v: any) => [v.cli?.nome ?? '—', v.forma_pagamento ?? '—', Number(v.total_final || 0), (v.created_at ?? '').slice(0, 10), v.status ?? '']),
        'logmax-historico-vendas');
    }
  };

  const kpis = [
    { label: 'Orçamentos Emitidos', value: totalOrcamentos, sub: 'no total', warn: false },
    { label: 'Pedidos em Aberto', value: pedidosAbertos, sub: 'em andamento', warn: pedidosAbertos > 0 },
    { label: 'Vendas Concluídas', value: vendasConcluidas.length, sub: 'no total', warn: false },
    { label: 'Valor Total Vendido', value: `R$ ${valorTotalVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: 'acumulado', warn: false },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatório de Vendas</h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
            <p className="text-xs text-gray-600 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex gap-2 flex-wrap">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => { setActiveTab(t.id); setSearch(''); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === t.id ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
                <Icon size={14} />{t.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
            className="neu-input rounded-xl px-3 py-2 text-sm">
            <option value="">Todas as filiais</option>
            {FILIAIS_REL.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          {activeData.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={handleExportPDF} icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          {isLoading ? <LoadingSpinner /> : activeData.length === 0 ? <EmptyState /> : (
            <table className="w-full text-left border-collapse">
              {activeTab === 'orcamentos' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Cliente</th><th className="pb-4 font-bold px-4">Vendedor</th>
                    <th className="pb-4 font-bold px-4 text-center">Emitido</th><th className="pb-4 font-bold px-4 text-right">Total</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredOrc.map((o: any) => (
                      <motion.tr key={o.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{o.cli?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{o.vendedor_nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-500 text-center">{o.data_emissao ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(o.valor_total || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={o.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'pedidos' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Cliente</th><th className="pb-4 font-bold px-4">Vendedor</th>
                    <th className="pb-4 font-bold px-4 text-right">Total</th><th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredPed.map((p: any) => (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.cli?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{p.vendedor_nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(p.valor_total || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={p.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'historico' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Cliente</th><th className="pb-4 font-bold px-4">Forma Pgto</th>
                    <th className="pb-4 font-bold px-4 text-right">Total</th><th className="pb-4 font-bold px-4">Data</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredVen.map((v: any) => (
                      <motion.tr key={v.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{v.cli?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{v.forma_pagamento ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(v.total_final || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{(v.created_at ?? '').slice(0, 10)}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={v.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
            </table>
          )}
        </div>
      </div>
    </motion.div>
  );
};
